# HWVCTS 赛事网站 · 重构设计文档

> 目标：从"功能页堆叠"重构为 **以个人账户维度管理** 的赛事网站 ——
> 登录进入**个人主页**，赛事作为一个个**活动**供报名，**赛事数据**与**报名信息**完全分离。
> 现有功能（比赛中心 / 赛程 / 数据 / 竞猜 / 分队 / 管理后台 / 选手主页）全部保留。

---

## 1. 现状诊断（为什么"感觉很混乱"）

| 问题 | 具体表现 |
|---|---|
| 身份不统一 | 竞猜页有独立的 `s6_bet_users` 登录；选手主页有自己的"资料密码"；管理后台再加一个口令。同一个人在站内有多套身份 |
| 没有"我的"维度 | 登录后停留在功能页本身，看不到"我报了什么、我的状态、我的数据" |
| 赛事与报名耦合 | 没有独立的"活动"实体，报名/参与信息没有统一归属，无法按人聚合 |
| 入口发散 | 各页面互相跳转，没有一个统一的登录后落地页 |

## 2. 目标架构

```
                       ┌─────────────────────────────┐
                       │   统一账号 site_users        │
                       │  （竞猜 / 报名 / 资料 共用）  │
                       └──────┬──────────┬───────────┘
                              │          │
              登录后落地       │          │ user_id
                              ▼          │
                     ┌────────────────┐  │   ┌──────────────────────┐
                     │  home.html     │◄─┼───│ events.html 活动大厅  │
                     │  个人主页       │  │   │  浏览 / 报名 / 审核    │
                     └───┬────┬───┬───┘  │   └──────────┬───────────┘
                         │    │   │      │              │
        功能入口 ────────┘    │   │      │      ┌───────┴────────┐
                             │   │      │      │ events 赛事数据   │ ← 只存赛事本身
                             │   │      │      │ event_registra- │ ← 只存"谁报了什么"
                             ▼   ▼      │      │ tions 报名信息   │   （分表，仅 event_id 关联）
                    index / schedule /  │      └────────────────┘
                    summary / betting / │
                    draft / admin / …   │
                        （现有功能全部保留，统一从导航进出）
```

### 三条核心原则

1. **一个账号贯穿全站**：`site_users` 是唯一身份源；竞猜、报名、个人资料都挂同一个 `user_id`。
2. **登录 → 个人主页**：`home.html` 是登录后的落地页，聚合"我的报名、我的状态、我的积分、功能入口"。
3. **赛事数据 ≠ 报名信息**：
   - `events`：只存赛事元数据（标题、赛制、时间、名额…），**不含任何报名者信息**；
   - `event_registrations`：只存"谁报了什么"（user_id、战队名、队员、状态），**不重复赛事详情**；
   - 两表仅通过 `event_id` 关联，查询时 JOIN，修改互不影响。

## 3. 页面地图

| 页面 | 角色 | 变化 |
|---|---|---|
| `home.html` | **个人主页（新）** | 登录/注册、个人资料编辑、我的报名、竞猜积分、功能入口矩阵 |
| `events.html` | **活动大厅（新）** | 活动列表/筛选、详情、报名/撤回、管理员创建活动与审核报名 |
| `index.html` | 比赛中心 | 仅新增导航入口 |
| `schedule.html` | 赛程中心 | 仅新增导航入口 |
| `summary.html` / `compare.html` / `player.html` | 选手数据 | 仅新增导航入口 |
| `betting.html` | 赛事竞猜 | **登录改为统一账号**（功能逻辑不变），新增导航入口 |
| `draft.html` / `s5draft.html` | 分队系统 | 仅新增导航入口 |
| `admin.html` | 管理后台 | 仅新增导航入口 |
| `game.html` | 剧情小游戏 | 不变（独立娱乐页） |

共享模块：

- `js/auth.js` —— 全站唯一认证模块：登录/注册/会话/改密/资料维护 + 注入式登录弹窗。
- `supabase/schema.sql` —— 建表 + 旧账号迁移 + 种子数据（在 Supabase SQL Editor 执行一次）。

## 4. 数据模型

```sql
site_users            -- ① 统一账号（从 s6_bet_users 迁移，id 不变）
  id, username(unique), password(SHA-256), nickname, game_id, bio,
  role, balance, created_at, last_login_at

events                -- ② 赛事/活动数据（与报名完全分离）
  id, code, title, event_type(tournament|scrim|showmatch|activity),
  season, status(draft|registration|ongoing|finished|cancelled),
  description, rules, format, start_time, end_time, reg_deadline,
  max_slots, venue, cover_emoji, created_by, timestamps

event_registrations   -- ③ 报名信息（只通过 event_id 关联赛事）
  id, event_id → events, user_id → site_users,
  team_name, members(jsonb[]), contact, note,
  status(pending|approved|rejected|cancelled), timestamps
  UNIQUE(event_id, user_id)   -- 一人一活动一条，撤回后可重报
```

**账号迁移要点**（`schema.sql` 已自动处理）：

- 旧 `s6_bet_users` 整表复制进 `site_users`，**保留原 id** → `s6_bet_bets` /
  `s6_bet_welfare_claims` 的 `user_id` 引用全部不断；
- 迁移后修正自增序列，避免新用户 id 冲突；
- 历史明文密码统一转成 SHA-256（pgcrypto 不可用时自动跳过，前端两种格式都能校验）；
- 旧表 `s6_bet_users` **保留不动**，作为回退与历史备份。

**兼容策略**：执行 SQL 之前，`auth.js` 探测到 `site_users` 不存在时自动回退旧账号表
——所以可以先部署前端、后执行 SQL，任何顺序都不会坏。

## 5. 关键流程

### 5.1 登录
任意页面点「登录/注册」→ `HWAuth.openModal()`（或旧竞猜页弹窗）→
`HWAuth.login()`（用户名不存在则自动注册，初始 100 竞猜分）→
写入会话 `localStorage.hw_session` → 默认跳转 `home.html`（竞猜页内登录留在原页，便于继续下注）。

### 5.2 报名一个活动
活动大厅 → 打开详情 → 登录态校验 → 填战队名/队员/联系方式 →
插入 `event_registrations(status=pending)` → 管理员在详情内「通过/拒绝」→
个人主页与"我的报名"实时显示状态。

### 5.3 管理员创建活动
活动大厅 → 「＋创建活动」→ 复用现有 `check_admin_password` RPC 验证口令（15 分钟内免重验）→
只写 `events` 表；可随时更新活动状态（草稿/报名中/进行中/已结束）。

## 6. 权限与安全（现状与升级路径）

**现状（与站点既有模型一致）**：使用 publishable/anon key + 宽松 RLS，管理动作靠
`check_admin_password` RPC 在前端把关；这是原站点（竞猜、赛程、后台）的既有做法。

**已做的改进**：
- 密码不再明文存储：前端 SHA-256 后入库，历史明文迁移时自动摘要；
- 会话只存本地，密码不回传。

**后续加固建议（可选，需要你操作 Supabase）**：
1. 迁移到 **Supabase Auth**（邮箱登录），`site_users` 只保留业务资料，用 `auth.uid()` 关联；
2. RLS 收紧：`event_registrations` 写策略 `using (auth.uid() = user_id)`，
   `events` 写操作只允许 service role / 管理员角色；
3. 管理口令改为服务端 RPC 校验后签发短期 token。

## 7. 实施步骤（上线清单）

1. ✅ 部署本仓库前端（新增 `home.html`、`events.html`、`js/auth.js`、`supabase/schema.sql`）；
2. ⬜ 在 **Supabase Dashboard → SQL Editor** 整段执行 `supabase/schema.sql`
   （幂等，可重复执行；执行完自动出现 4 个示例活动）；
3. ⬜ 打开 `home.html` 注册一个账号试试 → 活动大厅报名 → 管理员口令审核；
4. ⬜ （可选）按第 6 节做安全加固。

> 不执行第 2 步也能用：比赛中心/赛程/竞猜/数据等旧功能完全正常，
> 个人主页与活动大厅会提示"数据库尚未升级"。

## 8. 现有功能保留清单

| 功能 | 状态 |
|---|---|
| 比赛中心（积分榜/赛果/赛季与分组筛选） | ✅ 原样 |
| 赛程中心（瑞士轮/淘汰赛、随机抽签、解说统计、管理员改赛程） | ✅ 原样 |
| 选手数据汇总 / 多维对比 / 选手主页（数据+评论） | ✅ 原样 |
| 赛事竞猜（下注、赔率、撤销、低保、排行榜、组锁定） | ✅ 保留，登录改走统一账号 |
| 分队系统 draft / s5draft、管理后台 admin、剧情 game | ✅ 原样 |
| 主题切换（亮/暗）、粒子背景等视觉风格 | ✅ 新页面沿用同一套视觉 |
