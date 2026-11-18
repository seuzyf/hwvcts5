# HWVCTS 赛事网站 · 重构设计文档（Phase 2 · 布局完全重构）

> Phase 1（已上线）：账号中心化信息架构、活动/报名分离、统一登录 `js/auth.js`、
> `supabase/schema.sql` 数据模型。
> Phase 2（本阶段）：以 Raycast「Midnight command center」风格**从头重构全站布局**——
> 一个共享玻璃壳 + 清晰页面地图 + 功能合并，消灭逐页堆链接的混乱跳转逻辑。

## 1. 设计语言（css/theme.css）

**Midnight command center · coral neon**

| 项 | 规格 |
|---|---|
| 画布 | `#040506` 深空黑（纯暗色，全站无主题切换） |
| 层次 | 卡片 `#07080a`、内层 `#040506`、抬升 `#151619`；边框 `#363739` / key-ring `rgba(255,255,255,.25)` |
| 文字 | 主文 `#e6e6e6`（Mist）、纯白 `#fff`、次级 `#9c9c9d`、弱化 `#5b5b5c`、占位 `#8a8b8d` |
| 强调 | **coral `#ff6363` 克制使用**：logo 钻石、hero 氛围光、关键高亮、头像底色；大面积永远是无彩色 |
| 主按钮 | **Mist 实底** `#e6e6e6` + 黑字（不是彩色按钮！）；次级 ghost、危险面透明红字 |
| 阴影 | `key-shadow`（key-ring 上浮），传统黑色阴影基本不用 |
| 字体 | Inter（正文/UI）+ JetBrains Mono（ID、数字、Eyebrow），Google Fonts CDN |
| 圆角 | 小 8px / 卡片 16px / 胶囊 9999px；组件间 8px，模块间 16–32px，区块间 96px+ |
| 组件 | `.btn/.btn-primary/.btn-ghost/.btn-danger`、`.card/.glass`、`.seg` 分段器、`.chip`、`.eyebrow`、`.modal`、`.banner`、`.field`、`.toast` |

粒子背景、light/dark 主题切换、红黑渐变大标题——全部移除。

## 2. 共享壳（js/layout.js）

每个页面只需：`css/theme.css` → `js/auth.js` → `js/layout.js` → 页面脚本，并标记
`<body data-page="…">`（子页可加 `data-crumb="…"`）。壳自动渲染：

- **L1 悬浮玻璃胶囊导航**（左上）：◆ HWVCTS 品牌钻 + 主页/活动/比赛/数据/竞猜
  + 右侧鉴权 chip（未登录：登录/注册；已登录：● + 昵称 → index，下拉退出）；
  当前页高亮；页面内部不再各自堆一排跳转链接。
- **L2 极简页脚**：赛程中心 · 分队系统 · 管理后台 · 剧情模式。
- 登录态由 `HWAuth` 事件驱动刷新（`hw:login` / `hw:logout` 也会触发）。

## 3. 页面地图（Phase 2 终态）

| 页面 | 职责 | 说明 |
|---|---|---|
| `index.html` | **个人主页** | 登录落地页。游客 hero（功能一览 + 登录 CTA）／登录后仪表盘（资料编辑、我的报名、积分、功能入口） |
| `events.html` | 活动大厅 | 大厅/我的报名双 Tab、状态筛选、活动卡片、详情弹窗（报名/撤回/审核 通过·拒绝）、创建活动（口令门）、缺表升级提示 |
| `matches.html` | 比赛中心 | 赛季/组别/阶段筛选、赛程卡、积分榜、数据弹窗、合并统计开关 |
| `summary.html` | **数据中心**（合并 `compare.html`） | Tab① 数据汇总（排序/筛选/勾选 2–6 人）→ Tab② 多维对比（同组百分位雷达图 + 生涯详情表）；赛季随汇总页筛选 |
| `schedule.html` | 赛程中心 | 组别/阶段筛选、瑞士轮+淘汰赛对阵、编辑/口令提交、随机生成对战、解说统计 |
| `draft.html` | **分队系统**（合并 `s5draft.html`） | Tab① 表格分队（XLSX 导入→点选→导出）、Tab② 随机抽取（传奇/中坚/挑战池、三卡抽人、换候选人、提交/撤销）；`#draw` 直达抽取 |
| `player.html` | 选手详情 | 雷达图、角色数据、荣誉、评分；从数据/赛程表点击进入 |
| `betting.html` | 赛事预测 | 登录/注册、下注、排名、历史、低保；Phase 1 功能全保留 |
| `admin.html` | 管理后台 | 赛果/赛程/成员荣誉三 Tab + 口令门 |
| `game.html` | 剧情模式 | 未动（页脚入口） |
| `home.html` | ↳ 重定向 `index.html` | 旧书签兼容 |
| `compare.html` | ↳ 重定向 `summary.html#compare` | 旧书签/外链兼容 |
| `s5draft.html` | ↳ 重定向 `draft.html#draw` | 旧书签/外链兼容 |

跳转原则：**L1 导航管跨区漫游，L2 页脚管工具箱，页面内只留与内容相关的动作**；
URL 锚点（`#compare` / `#draw` / `#mine`）保留深链能力。

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
- 迁移后修正自增序列；历史明文密码统一转 SHA-256（pgcrypto 不可用自动跳过，
  前端两种格式都能校验）；旧表保留不动作备份。

**兼容策略**：SQL 执行前 `auth.js` 探测 `site_users` 不存在时自动回退旧账号表
——先部署前端、后执行 SQL，任何顺序都不会坏。

其余业务表沿用既有：`manage / player_ids / player_stats / s5_player_ids /
s6_comments / s6_match_schedule / s5_matches / s6_matches / s6_bet_* /
s6_betting_groups` + RPC `check_admin_password`。

## 5. 关键流程

### 5.1 登录
任意页点「登录/注册」→ `HWAuth.openModal()` → `HWAuth.login()`（用户名不存在自动注册，
初始 100 竞猜分）→ 会话写 `localStorage.hw_session` → 落地 **`index.html` 个人主页**
（竞猜页内登录留在原页便于继续下注）。

### 5.2 报名一个活动
活动大厅 → 打开详情 → 登录态校验 → 填战队名/队员/联系方式 →
插入 `event_registrations(status=pending)` → 管理员在详情内「通过/拒绝」→
个人主页与「我的报名」实时显示状态。

### 5.3 数据对比（原 compare.html）
数据汇总 Tab 勾选 2–6 名选手 → 「生成对比」→ 同页切到多维对比 Tab →
雷达图（ACS/每回合击杀/每回合助攻/存活率/KDA 的同组百分位）+ 最优值标星明细表。

### 5.4 管理员创建活动
活动大厅 → 「＋创建活动」→ `check_admin_password` RPC 验证口令（15 分钟内免重验）→
只写 `events` 表；可随时更新活动状态。

## 6. 权限与安全（现状与升级路径）

**现状（与站点既有模型一致）**：publishable/anon key + 宽松 RLS，管理动作靠
`check_admin_password` RPC 前端把关（竞猜、赛程、后台、活动创建同一套做法）。

**已做的改进**：
- 密码不再明文存储：前端 SHA-256 入库，历史明文迁移时自动摘要；
- 会话只存本地，密码不回传。

**后续加固建议（可选，需要你操作 Supabase）**：
1. 迁移到 **Supabase Auth**（邮箱登录），`site_users` 只留业务资料，`auth.uid()` 关联；
2. RLS 收紧：`event_registrations` 写策略 `using (auth.uid() = user_id)`；
3. 管理口令改服务端 RPC 校验后签发短期 token。

## 7. 实施与验证

- **Phase 1 已上线**：PR #3 合并 → Vercel Production。
- **Phase 2 验证**（提交前必须全过）：
  ```bash
  cd .scratch && node test.js     # 13 项：壳/双 Tab 合并/重定向/换壳四页/脚本语法…
  ```
  - 全部内联脚本 `node --check` 通过；
  - `python3 -m http.server 8000` 起本地后逐页 curl 200；
  - 被换壳页面不再包含 `theme-toggle` / `createParticles` / 旧红色 `#ff4655`。
- **待你操作**：若尚未执行，请把 `supabase/schema.sql` 在 Supabase SQL Editor 跑一次
  （活动功能依赖 `events` / `event_registrations` / `site_users`）。

## 8. 功能保留清单

| 模块 | 状态 |
|---|---|
| 统一登录/注册/资料编辑（`js/auth.js`） | ✅ 保留，index 与壳共用 |
| 活动报名/撤回/审核、创建活动 | ✅ 保留（events.html 重构版） |
| 竞猜：下注/排名/历史/低保/福利 | ✅ 保留（betting.html 换壳） |
| 比赛中心：赛程+积分榜+数据弹窗 | ✅ 保留（matches.html） |
| 数据汇总排序筛选 + 多维对比雷达 | ✅ 保留并合并进 summary.html 双 Tab |
| 赛程中心：编辑/随机生成/解说统计/口令提交 | ✅ 保留（schedule.html 换壳） |
| 分队：XLSX 表格分队 + 随机抽取 | ✅ 保留并合并进 draft.html 双 Tab（`#draw` 深链） |
| 选手详情页（雷达/角色/荣誉/评分） | ✅ 保留（player.html 换壳） |
| 管理后台三 Tab + 口令门 | ✅ 保留（admin.html 换壳） |
| 剧情模式 game.html | ✅ 原样 |
| 旧地址 home/compare/s5draft | ↳ 重定向到新页面 |
