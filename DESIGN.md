# HWVCTS 赛事网站 · 重构设计文档（Phase 2 · 布局完全重构）

> Phase 1（已上线）：账号中心化信息架构、活动/报名分离、统一登录 `js/auth.js`、
> `supabase/schema.sql` 数据模型。
> Phase 2（本阶段）：以 Raycast「Midnight command center」风格**从头重构全站布局**——
> 一个共享玻璃壳 + 清晰页面地图 + 功能合并，消灭逐页堆链接的混乱跳转逻辑。

## 1. 设计语言（css/theme.css）

**Midnight command center · coral neon — 深浅双主题**

| 项 | 规格 |
|---|---|
| 画布 | 深色 `#040506`（默认）／浅色 `#f3f3f4`，导航栏按钮一键切换（localStorage `hw_theme`，首屏同步引导无闪烁） |
| 层次 | 深：卡片 `#07080a`、抬升 `#111214`、边框 `#363739`；浅：卡片 `#fff`、抬升 `#f7f7f8`、边框 `#dcdcde`；key-ring 深 `rgba(255,255,255,.25)` / 浅 `rgba(0,0,0,.14)` |
| 文字 | 深：主文 `#e6e6e6`／纯白 `#fff`／次级 `#9c9c9d`；浅：主文 `#1b1c1e`／纯白位 `#101113`／次级 `#5e6065` |
| 强调 | **coral**（深 `#ff6363` / 浅 `#e04545`）克制使用：logo 钻石、hero 氛围、关键高亮；大面积永远无彩色 |
| 主按钮 | Mist 实底：深色 `#e6e6e6`+深字，浅色 `#1b1c1e`+浅字（自动随主题翻转） |
| 阴影 | `key-shadow` / `panel-shadow`（弹窗上浮），深浅两套令牌 |
| 字体 | Inter（正文）+ JetBrains Mono（ID/数字/Eyebrow），Google Fonts CDN |
| 圆角 | 小 8px / 卡片 16px / 弹窗与大卡 20px / 胶囊 9999px |
| 组件 | `.btn` 家族、`.card`、`.seg`、`.chip`、`.eyebrow`、`.modal-*`（含 `.modal-eyebrow` 统一弹窗题眉）、`.event-bar`、`.locked-state`、`.theme-toggle` |

**弹窗统一规范**：所有对话框（登录、下注、口令、设置、解说、比赛详情、确认…）同一套排版——
mono Eyebrow 题眉 + 左对齐标题 + 分隔线 + 16px 内距输入 + Mist 按钮 + 20px 圆角 panel-shadow；
不保留任何旧的居中大字/红边框/6px 直角风格。粒子、旧 light-theme class 切换全部废弃。

## 2. 共享壳（js/layout.js）

每页：`css/theme.css` → `js/auth.js` → `js/layout.js` → 页面脚本，`<body data-page="…" data-crumb="…">`。

- **一级导航三项：主页 / 活动 / 管理后台**（比赛、数据、竞猜、赛程、分队是**活动下级**，见 §3；
  管理后台是**双角色中枢**：普通成员进去改个人信息，管理员进去举办/管理活动与数据工具）；
- **页脚只剩剧情模式**（管理后台/分队/赛程不再作为一级入口平铺在页面底部）；
- 悬浮玻璃胶囊 + 品牌钻 + **浅/深色切换按钮** + 鉴权 chip（头像描 coral 环 = 管理员）；
- 活动上下文 API：
  - `HWLayout.resolveEvent()` — 解析 `?event=<id>` → events 行（无参数返回 null 并提示从活动大厅进入）；
  - `HWLayout.access(seasonKey)` — 权限：`{isAdmin, isCaptain, captainTeams}`（见 §6）；
  - `HWLayout.eventBar({event, perms})` — 渲染活动栏：← 活动 + 标题/赛季/状态 + 标签页
    概况｜赛程｜比赛｜数据｜竞猜｜[分队]*｜[管理]*（*按权限显示），当前页高亮。

## 3. 页面地图（Phase 3 · 活动中心化）

| 页面 | 层级 | 说明 |
|---|---|---|
| `index.html` | 一级 · 个人主页 | 登录落地；近期活动深链 `events.html?open=<id>`；功能入口只有 活动大厅 / 我的报名 / 剧情模式 |
| `events.html` | 一级 · 活动大厅 | 大厅/我的报名；详情内「活动空间」= 赛程/比赛/数据/竞猜入口 + 分队/管理（按权限）；`?open=<id>` 深链；缺表时提供旧版入口 |
| `schedule / matches / summary / betting` | **二级 · 活动内** | 入口只在活动栏；`?event=` 绑定赛季（赛季选择器锁定）；无参数时显示「未绑定活动」提示条 |
| `draft.html` 分队 | **二级 · 活动内 · 权限** | 队长/管理员可见标签页；直接打开时非授权者见锁定屏（`.locked-state`） |
| `admin.html` 管理后台 | **一级 · 双角色中枢** | 游客 → 登录 CTA + 口令入口；成员 → 编辑昵称/游戏 ID/简介/密码 + 退出 + 快捷入口；管理员 → 活动管理列表（状态修改、深链详情、创建活动 `?create=1`）+ 分队/赛程/数据快捷 + 下方赛果/赛程/成员三 Tab 工具；`?event=` 时锁季并挂活动栏 |
| `player.html` | 二级 · 数据下钻 | 从数据表进入，crumb 归活动 |
| `game.html` | 一级（独立于赛事） | 剧情模式，页脚唯一链接 |
| `home / compare / s5draft` | ↳ 重定向桩 | `index` / `summary#compare` / `draft#draw` |

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

## 6. 权限模型与安全

**角色两级（界面随身份变化）**：

| 身份 | 判定 | 界面差异 |
|---|---|---|
| **管理员 admin** | `site_users.role='admin'`（数据库）或浏览器口令会话（`hw_admin_until`，15 分钟，由任一 `check_admin_password` 验证成功写入，并**尽力回写 role='admin'** 持久化） | 活动栏出「管理」标签；活动空间出「管理 + 分队」；管理后台出活动管理列表与数据工具（免口令直入）；活动审核/创建；导航头像 coral 描环 |
| **队长 captain** | 登录账号的 `game_id / 昵称 / 用户名` 命中对应赛季 `{season}_player_stats.role='队长'`（分队结果自动识别，S5/S6 互为回退） | 活动栏出「分队」标签；活动空间出「分队」；draft 页放行 |
| **成员 member**（默认） | 登录普通账号 | 顶部「管理后台」= 个人信息编辑（资料/密码/退出/快捷入口）；无分队/管理工具入口；draft 直开显示锁定屏 |

口令验证入口统一：活动创建/审核、赛程提交、管理后台 —— 任一处验证成功即全站生效 15 分钟。

**现状安全模型**（与站点既有模型一致）：publishable/anon key + 宽松 RLS，管理动作靠
`check_admin_password` RPC 前端把关。已做改进：密码 SHA-256 存储（历史明文迁移时摘要）、
会话只存本地。**后续加固建议（可选）**：迁移到 Supabase Auth；`event_registrations`
写策略 `using (auth.uid() = user_id)`；管理口令改服务端短期 token。

## 7. 实施与验证

- **Phase 1 已上线**：PR #3 合并 → Vercel Production。
- **新库迁移（Phase 4）**：全站 Supabase 客户端已切换到新项目 `odjmanvkhwiirswscrht`（9 个文件的
  URL + publishable key 同步替换）。新项目初始化顺序（SQL Editor 依次运行）：
  ① `supabase/schema.sql`（账号/活动/报名 + 示例活动）→ ② `supabase/bootstrap.sql`
  （历史业务表 DDL + RLS + GRANT + 测试数据，分段异常保护，注意看 NOTICE）。
  测试账号：`tester/test1234`（成员+队长）、`testadmin/admin1234`（管理员）；竞猜锁定口令 `admin1234`。
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
| 管理后台三 Tab + 口令门 | ✅ 保留（admin.html 换双角色中枢：成员个人信息 / 管理员活动管理） |
| 剧情模式 game.html | ✅ 原样 |
| 旧地址 home/compare/s5draft | ↳ 重定向到新页面 |
