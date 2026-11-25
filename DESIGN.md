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

**Phase 13 新增（schema 第 13 节）**：

```sql
site_users  += balance_synced_at, banned, banned_reason, banned_until   -- 全局封禁
events      += stream_url                                               -- 直播链接
s5/s6_matches += event_id（DO 保护回填该赛季主活动）                     -- 赛事两级筛选
points_ledger      -- 积分流：delta / balance_after / reason / operator_id / source
event_bans         -- 活动封禁：event_id + user_id + reason + until（组织者限自己活动）
goods              -- 商品：title / image_url / stock / cost / conditions(jsonb) / status
goods_redemptions  -- 兑换记录
RPC redeem_goods(goods_id, user_id) -- 原子：库存+余额校验 → 扣减 → 流水+记录
存储桶 avatars / goods（public）
```

**积分权威模型**：`site_users.balance` 为权威列（默认 100）；任何余额变化都由
`HWLayout.recalcBalance(userId)` 从事实重算：`100 - 投注 + 赛果派彩 + 每日签到×5 + points_ledger 净额`，
禁止撤销式回滚。写点：下注/签到/调分/赛果录入（manage 三处 → `recalcAfterScoreChange` 重算所有有投注用户）。

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

**Phase 13 角色秩（`HWLayout.roleRank`）**：`guest 0 < member 1 < organizer 2 < admin 3 < superadmin 4`；
`isAdminNow = 秩≥admin`（临时口令会话按 admin 计，永不升 superadmin）。

| 规则 | 实现 |
|---|---|
| 仅 superadmin 可设 admin/superadmin | admin.html 权限卡下拉按**操作者秩截断**（admin 最高设 organizer；目标高于操作者 → 只读 chip） |
| 首个 superadmin | 手动 SQL：`update site_users set role='superadmin' where username='…';`（见 PR 说明） |
| organizer 后台裁剪视图 | 路由 `atLeast('organizer')` 进入；隐藏举办申请/权限卡/广播；活动列表仅自己；新增「我的报名用户」（调分 + 活动封禁） |
| 调分 | `points_ledger` 插入 ±N + `recalcBalance` + 通知「X（身份）为你调整积分 +N，原因：…，当前余额 M」 |
| 封禁 = A 方案 | 全局（admin+，`site_users.banned*`）与活动（组织者限自己活动，`event_bans`）：可登录，禁报名/下注/抽奖池；头像角标 + 数据中心/审核/报名页「已禁赛」徽章 |
| 全员广播 | admin → `HWLayout.broadcastNotifications(scope)`（全员/仅成员/组织者及以上）→ 通知中心 |

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
  node .scratch/test.js           # 31 项：壳/导航/事件栏/赛季锁/页面功能/设计·密钥·SQL/本轮新特性…
  ```
  - 全部内联脚本 `node --check` 通过；
  - `python3 -m http.server 8000` 起本地后逐页 curl 200；
  - 被换壳页面不再包含 `theme-toggle` / `createParticles` / 旧红色 `#ff4655`。
- **Phase 5（本轮 · 视觉与信息流）**：
  - 活动大厅改小红书式错位信息流：CSS columns 瀑布流（3/2/1 列断点）+ 封面比例
    3:4 / 1:1 / 4:3 按 `id % 3` 轮换；徽章浮在封面左上，无图回退渐变 + emoji。
  - 封面图管线：`events.cover_image` 列 + Storage 公开桶 `event-covers` + 策略
    `event_covers_all`（schema.sql 幂等）；创建表单 `cf-cover` 上传（≤2MB，预览），
    管理员详情内「更换封面图 / 移除封面」；卡片 / 详情横幅 / 活动栏 / 管理列表均 `<img>`
    显示并回退 emoji。
  - schedule / betting 旧页头（title-badge + h1 + 旧工具条）统一为 theme `.page-header`；
    **解说统计** 移入工具条、betting 用户信息（登录/余额/历史/低保）全部保留；
    schedule 赛季滑块（S5/S6）删除 —— 赛季由所选活动决定（`currentSeason = key`）。
  - 概况 tab 不再跳回活动大厅：`openEventOverview()` 当前页浮层（theme modal，
    内联 opacity/visibility 以兼容各页局部 backdrop CSS），「完整详情」才深链 `?open=`。
  - 字号整体 +1px（10–14 → 11–15），body 17px / weight 500 / line-height 1.6，
    nav-link / btn / ev-tab 字重 600。
  - **样式合规巡检（第二轮）**：S5/S6 赛季滑块全站清除（matches/admin/player/summary
    最后四处，`currentSeason` 与 `?season=` 链接参数保留）；admin/betting/schedule/player
    的 legacy `:root` 变量改为 theme token 别名（深浅色自动跟随主题）；旧组件
    （title-badge / nav-button / main-header-block / filter-group / 局部 modal CSS /
    粒子与主题切换死代码）全部移除，控件统一 theme `.btn/.seg/.input/.modal-panel`；
    旧红 `#e53935/229,57,53` → theme coral；player 补 page-header；game（剧情模式）
    保持沉浸式独立视觉并加「返回网站」入口；schema 种子 S5 行 14 列对齐修复
    （`BO5 两场，赛后复盘` + `BO5`）。测试 34 项全过。
- **Phase 6（管理后台拆分 + 队长绑定活动 + 赛果赛程合并录入）**：
  - **admin.html 瘦身**（1206 → ~427 行）：只保留活动发布/状态/封面 + 账号中枢 +
    活动队长设置入口；`#admin-panel`（赛果/赛程/成员 tabs）、tools JS、校验弹窗、
    队伍 datalist 全部移出，活动行新增「数据台」直达按钮。
  - **manage.html（赛事数据台，新建）**：`?event={id}` 绑定活动；权限 = 管理员 OR
    **该活动的**队长（新表 `event_captains(event_id, player_name, game_id, …)`，
    RLS `for all using(true)`，活动详情页「管理」区设置/移除）；分组切换 + 三 tab：
    **合并录入 / 赛果明细 / 成员维护**（校验弹窗与 datalist 随迁）；无权限显示门禁文案。
  - **合并录入**：选对阵（或新建）→ 逐图录比分 → **大比分 = 图胜计数自动识别**
    （无图时可手动）→ 一次保存同时写 `s{N}_match_schedule`（大比分/时间/回放）与
    `s{N}_matches`（逐图行，已有图更新不重复插）；逐图选手数据仍在「赛果明细」编辑。
  - **接线**：`layout.js access(seasonKey, ev)` 合并 event_captains（game_id/昵称/用户名
    命中，缓存键含 ev.id）；EV_TABS 管理 → `manage.html?event={id}` `need:'manage'`
    （管理员||活动队长可见，CAPTAIN 徽章同判）；全站 8 处 `access()` 调用点传 `ev`；
    events 工作台「管理」tile 同条件指向数据台。
  - 测试重建为零依赖版 `.scratch/test.js`：**58 项全过**（语法/样式合规/Phase 6 拆分与接线）。
  - **热修（2026-11-19）**：PR#10 的 access() 重写误引未定义符号 `auth.user()/auth.client()/isAdmin()`
    （真实来源为 `HWAuth.getSession()/supa()/isAdminNow()`）且错查 player_stats 不存在的 `user_id` 列
    → access() 同步 ReferenceError → 活动空间等所有权限渲染卡「加载中」。已按原逻辑重写
    （赛季队长 game_id/昵称匹配 + event_captains 扩展），manage 补缺失的 showToast 实现，
    工作台改为「先渲染基础四块再升级权限」。测试增至 **71 项**（新增 vm 运行时冒烟 8 场 +
    未定义符号静态哨兵）。
- **Phase 7（三页风格重构 + 创建活动赛制选择）**：
  - **竞猜 / 赛程 / 管理后台 / 数据台 全部换装为统一壳语言**（matches/events 同款）：
    删尽 legacy `:root` 别名、左侧渐变装饰条（`::before` accent）、900 字重/2px 字距、
    全局 `button/input/table` 元素选择器、`[data-theme=light]` 页面级补丁；
    新版只用 theme token（`var(--ink/--obsidian/--border/--smoke…)`，深浅色自动翻转）
    + 组件（page-header / card / filter-bar / seg / btn / table-wrap / modal-*）。
  - betting：`main.page` 壳、账户芯片头部、分组卡+预测卡扁平化、排名榜进 card+mono 表头；
  - schedule：event-bar 居顶、对阵区 `main.card` + stage-head、括号图（match-card/round-title）
    全新扁平视觉、比赛详情弹窗 md-box/md-edit 组件化、解说统计与横幅换 token；
  - admin：孤儿样式清除（data-section/tab-content/warning-text/…），活动行新卡片语言；
  - manage：Phase 6 沿拷的旧式 data-section 装饰条同批换新（tab/表格/模板按钮重写）。
  - **创建活动新增赛制选择**：赛制下拉（单循环/双败/单败 × BO1/3/5 → 存 `format`）、
    分组数量（1/2/3 → 新列 `group_count`）、参赛队伍（按赛季花名册勾选 → 新列 `teams` 逗号分隔）；
    详情 meta 与概况浮层同步展示；花名册无队伍时给出引导文案。
  - 测试 **107 项 + E2E 3 场全过**（含三页重构哨兵、赛制字段、access 运行时）。
- **Phase 7.1（数据台排版与录入修正）**：
  - manage.html 补上 `main.page > container` 壳（修复元素通栏顶到左右两边）；
    `page-eyebrow` → theme `eyebrow`；theme 键名修正为 `hw_theme`；去掉未导出的 `buildNav()` 调用。
  - tabs 由「合并录入/赛果明细/成员维护」改为 **「结果录入 / 成员维护」**：
    赛果明细整块（新增/修改选手数据）并入结果录入同一 tab（双 active 清除）。
  - **队长默认录入本队**：非管理员进入时解析本队（赛季队长用 captainTeams；
    活动队长用 event_captains 反查花名册拿 team+group），范围段默认「我的比赛」
    （可切「全部比赛」），并自动切到本队所在分组；管理员默认全部。
  - 测试 94 项 + E2E 3 场（新增 manage 队长场景）全过。
- **Phase 7.2（数据中心 + 活动栏恢复）**：
  - manage.html 补回 `#event-bar` host（此前缺 host 导致整行活动栏不渲染）。
  - 顶部导航新增 **数据中心**（`players.html`）：全赛季选手数据库 ——
    赛事届次筛选（events 去重赛季 + 活动名标签，URL `?season=` 同步）、
    搜索、可排序列（场次/K/D/KDA/ACS）、三表联查
    （`{season}_matches` 战斗数据 + `{season}_player_ids` 花名册 + `{season}_player_stats` 角色）。
  - 选手行点击 → **个人主页 `player.html`**（既有早期版本能力雷达图：
    ACS/每回合击杀/助攻/存活率/KDA 百分位 + 生涯平均 + 角色数据 + 评论）。
  - 测试 141 项 + E2E 4 场（events×2、manage 含活动栏 7 页签、players 数据中心）全过。
- **Phase 8（报名组队 + 审批队长 + 站内通知）**：
  - 创建活动**不再选择队伍**（cf-teams 整块移除；`events.teams` 创建时留空）。
  - 报名表单改为 **加入已有队伍**（下拉：本活动已通过报名的战队 ∪ 活动登记队伍）
    / **新建队伍**（输入队名 → `new_team=true`）；字段缺列时自动回退保证报名可用。
  - 管理员在活动详情审核报名；**新建队伍的报名通过 → 自动写 `event_captains`**
    （该活动队长，解锁分队/管理页签与数据台队长范围）并把队伍追加进 `events.teams` 展示。
  - **右上角通知中心**：layout 导航新增铃铛 + 未读角标 + 面板（全部已读/点击已读/跳转）；
    新通知：报名提交（给本人+全体管理员）、审核通过/拒绝（给本人，新队伍通过附带队长文案）。
    `HWLayout.notifyUser / notifyAdmins / toast` 供各页调用。
  - **全站交互反馈**：events/admin/draft/betting/schedule/summary/index 的 `alert()`
    全部改为 `HWLayout.toast()`（自动按文案判定 ok/err/info，右上角 3s 消失）。
  - **文案清理**：删除各页介绍中的需求/用法描述（活动大厅副标题、创建表单架构提示、
    数据中心副标题、赛程/分队用法说明、首页功能罗列等）。
  - 新表 `notifications` + `event_registrations.new_team`（见 schema.sql 第 8 节）。
- **Phase 9（独立报名/审核 + 资料档案 + 头像）**：
  - 活动栏 host 移入 `main.page > container`（manage 宽度与各页一致）；EV_TABS 增至 9 个：
    …竞猜 → **报名**（register.html?event=）→ 分队/管理 → **审核**（need admin，review.html?event=）。
  - **register.html**：独立报名页。登录门禁 → 活动摘要 → 队伍二选一 →
    **新选手两段式资料**（第一部分当前赛季：真名/游戏ID/工号/常玩位置多选/段位+ACS/KDA/KAST/回合伤害+当前赛季截图；
    第二部分历史巅峰与生涯：历史段位+四项/总时长/其他FPS+最高段位+生涯截图）。
    **老选手**（有 reg_profiles 或花名册命中）→ 仅当前赛季必填，资料自动带入、第二段选填。
    已报名 → 状态卡（撤回）+ 资料更新。提交 = upsert reg_profiles + insert 报名 + 双端通知。
  - **review.html**：管理员审核独立页（口令门禁）。**逐人卡片信息流**（头像/真名/战队/新队伍/状态），
    点开详情弹层 = 报名信息 + 基本/当前/历史分组 + 两张截图预览 + 通过/拒绝；
    通过新建队伍 → event_captains 自动队长 + events.teams 追加 + 通知。
    **通知跳转**：管理员 → review.html?event=，本人 → register.html?event=（不再进活动详情）。
  - events.html：内联报名表与详情内审核按钮移除，改为「填写并报名 →」「审核报名」入口（详情保留状态与撤回）。
  - **头像**：site_users.avatar 新列；导航右上角头像图（回退首字母）；管理后台成员资料可设 +
    管理员视图新增「选手账号（头像管理）」卡片；player.html 存档时尽力同步站点头像。
  - schema 第 9 节：site_users.avatar + reg_profiles（两段式资料）+ reg-docs 存储桶（截图上传）。
  - 测试：静态 + E2E（见 .scratch）覆盖报名/审核/头像/活动栏。
- **Phase 10（五项改进 + 图标去 emoji）**：
  1. **绑定游戏 ID**：register.html 顶部绑定条（未绑定时显示）→ 校验未被其他账号占用后写
     `site_users.game_id`；老/新判定升级为**已绑定只按 ID 确定性匹配花名册（当前+上赛季回退）**，
     未绑定才走昵称启发式 —— 防重名误判与冒用。
  2. **截图人工核对**：`reg_profiles.shots_verified / shots_verified_at`；review 详情「标记截图已核对」
     切换 + 卡片与详情显示已核对徽标。
  3. **审核批量 + 筛选**：卡片勾选（pending）、全选待审核、按状态/队伍筛选、「批量通过 (n)」
     逐条 applyStatus（通知/自动队长同单条）；**名额守卫**：单条与批量均受 `max_slots` 限制
     （批量自动按余量截断并提示）。
  4. **历史段位软校验**：`rankScore()` 档位序（辐能…金）比较，历史 < 当前 → 黄字提示
     「请确认是否填写有误」，**不阻断提交**。
  5. **截止/满员硬禁**：register 提交瞬间复检 status/deadline/满员（打开表单期间活动关闭也会被拦），
     满员按 pending+approved 占位；events/register 的 CTA 均已有截止态文案。
  - **图标系统**：`HWLayout.ico(name, size)` 内联 **Lucide**（coss.com/ui 粒子所用图标库，
    来源 cosscom/ui 注册表确认 lucide-react）30 枚；全站 UI emoji 清零
    （活动空间/首页功能卡/分队锁/自动写入横幅/解说席/皇冠/封面兜底等 → SVG）。
    **保留**：game.html 剧情聊天表情（内容）、`cover_emoji` 数据列（渲染已改用封面图或图标）、
    ★ 评分与 → 箭头字形。
  - schema 第 10 节：`reg_profiles.shots_verified` + `shots_verified_at`。
- **Phase 11（身份体系 + 数据中心口径 + 交互修缮）**：
  - **数据中心口径**：players.html 默认「全部赛事（合并）」且**只展示报过名的选手**
    （event_registrations → site_users/reg_profiles → game_id/昵称/真名匹配）；
    活动页内导航「数据中心」自动携带 `?event=`（layout buildNav 动态 href）→ 直接筛选该活动赛季。
  - **报名可不填队伍**：第三种模式「暂不填（等待分队）」→ `team_name=''`，
    各处显示回退为「待分队」（状态卡/我的报名/审核卡片与详情）。
  - **赛程去口令**：schedule.html 密码弹框整体移除，抽签与提交更改改为**按 admin 身份**放行
    （`requireAdminAuth` → 角色校验）。
  - **全站鉴权标记**：layout renderAuth 给所有页面写 `body[data-role]=guest|member|organizer|admin`，
    导出 `HWLayout.getRole()`，登录/登出/提权自动刷新 —— 供后续按身份区分功能。
  - **活动组织者（organizer）**：
    - 申请：events.html「申请举办活动」→ `organizer_requests` → 通知管理员；
    - 审核：admin.html「举办活动申请」卡片 同意/拒绝 → 同意即 `site_users.role='organizer'` + 通知；
    - 权限：`access()` 判定 `ev.organizer_id === user.id` → **该活动下 isAdmin/isEventCaptain 等同管理员**
      （活动栏 管理/审核 页签、详情管理块、review 门禁、创建活动、草稿可见），**不授予全局 admin**；
      组织者创建活动时写入 `events.organizer_id`。
  - **权限管理**：admin.html 新增「权限管理」卡片（个人主页 admin 入口 → `admin.html#perm-card`）：
    编辑任意用户身份（成员/活动组织者/管理员）+ **重置密码为 123456**（sha256 同 auth 口径）。
  - **弹框交互**：全部弹框取消「点空白关闭」（betting/matches/player/review/schedule/auth 登录框），
    仅手动 × 关闭。
  - **视觉修缮**：主页横幅渐变背景左右各外扩 48px（文字位置不变，背景比文字宽）；
    报名页功能块之间 `margin-top:16px` 留空。
  - schema 第 11 节：`events.organizer_id` + `organizer_requests` 表（RLS）。
- **Phase 12（头像菜单 + 消息面板 + 活动抽奖）**：
  - **数据中心修复**：players.html 漏引 Supabase CDN（根因：`getClient()` 抛错 → 永远「加载中」）；
    补 CDN + boot 加 15s 超时与错误提示（console + 表内错误行），查询全部失败安全。
  - **主页问候缩进**：`h1/.lead` 的内联 margin 简写会清掉 atmosphere 的 margin-left，
    theme.css 用 `.hero.hero-atmosphere > h1/.lead`（更高特异性）收回 48px，与渐变错开。
  - **主页改版**：hero 不再放「权限管理」按钮 → 移入功能入口磁贴（管理员可见，`admin.html#perm-card`）；
    「个人资料」整栏替换为 **消息（通知列表）**：展示全部通知（未读高亮）、点击标记已读并跳转、「全部已读」。
  - **头像菜单（layout 全局）**：右上角头像由跳转链接改为按钮，弹出下拉：
    **头像 / 账号 / 编辑资料 / 重置密码 / 退出登录**（顺序固定，不再跳个人主页）。
    四个弹框（`hw-av/hw-acct/hw-prof/hw-pwd-modal`）注入 layout，仅手动 × 关闭；
    头像=URL 设置（updateProfile 允许 avatar 字段）、账号=只读信息、编辑资料保存后派发 `hw:profile`（index 重渲染）、
    重置密码=原密码+新密码（`HWAuth.changePassword`）。
  - **页首渐变**：theme.css 给所有 `.page-header` 加同款 radial 渐变（`width+96/margin-left-48` 比内容更宽），
    活动/数据中心/报名/审核/赛程/竞猜/比赛/后台等页首自动获得。
  - **管理后台**：移除「选手账号（头像管理）」整卡（`loadSiteUsers` 一并删除；改身份走权限管理卡）。
  - **活动抽奖（lottery.html?event=）**：活动空间新增「抽奖」入口（所有人可见）。
    - 名单来源：**勾选活动赛季下的比赛记录 → 自动统计出场名单**（权重=场次），或 **导入名单**（每行一个、自动去重）/ **导出名单**（TXT 下载）；
    - 抽取方式：**随机抽取 / 按场次加权随机**；执行方式：**自动停止 / 手动停止**；
    - 种子：**默认当前时间**，可手动输入（同种子同结果，xmur3+mulberry32）；
    - 滚筒动画：炉石式名单滚筒，快转→缓停→轻微回弹落定；手动模式点「停止」后仍**惯性多滚约 1.2 圈再落定**（防指定）；
    - 中奖名单展示在右侧，**本次名单内不重复抽取**；「提交结果」→ 写 `event_lottery_results` → 清轮次并刷新历史；
    - **历史中奖记录**卡：时间/方式/种子/中奖者。
  - schema 第 12 节：`event_lottery_results` 表（event_id/mode/exec_mode/seed/winners jsonb/drawn_by，RLS）。
- **Phase 13（积分商店 + 超级管理员 + 动态赛制 + 全站数据/封禁体系）**：
  - **头像改上传**：账号菜单「头像」弹框由 URL 输入改为**文件上传**（`avatars` 桶，≤5MB，预览 + 清除）。
  - **页首渐变对齐主页**：`.page-header::before/after` 完全复制 `.hero-atmosphere` 的 radial+linear+光束公式（含浅色主题覆盖）。
  - **活动导航条统一**： betting/matches/register/review/schedule/summary 全部改为 **页首 → event-bar → 内容**（与 draft 一致）。
  - **超级管理员**：见 §6；管理后台 organizer+ 裁剪视图、我的报名用户、全员广播、调分/封禁弹框（×-only）。
  - **数据中心**：赛季→赛事两级筛选（`?season=`/`?event=` 深链 + `event_id` 过滤）、全量名册 ∪ 报名未上场 0 场行、
    计数「N 名选手（已报名 X）」、报名列、封禁徽章、CSV 导出（`HWLayout.exportCsv`）、队伍列 → `team.html` 互链。
  - **赛程动态化**：分组按钮按活动 `group_count/format` 生成（3 组沿用 传奇/中坚/挑战 兼容旧数据）；
    首版 5 赛制生成器（单循环/双循环/分组循环/单败/分组+淘汰，双败走旧逻辑）；有赛果的组不可重生成；
    通用对阵图渲染器（`B-R*` 单败树 + `RR-*` 动态循环布局）；随机生成仍 admin-only；导出 .ics。
  - **积分商店**：导航「管理后台」旁；卡片流 → ×-only 详情（大图/介绍/库存/条件）；组织者+ 新增/编辑/下架
    （`goods` 桶图片 + 4 类条件 参与过活动/报名≥N/比赛≥N/余额≥N 且/或）；`redeem_goods` 原子兑换；兑换记录 + CSV。
  - **每日签到**：并入低保（同 `s6_bet_welfare_claims`，每日一次，文案「每日签到 +5」）。
  - **候补**：名额满 → `status='waitlist'`；撤回/取消 → `HWLayout.promoteWaitlist` 递补 pending 并双向通知。
  - **今明提醒卡**（主页：今明活动/赛程/下注锁定）、**竞猜支持比% + 预计赢利**（卡片与下注弹窗）。
  - **数据中心互链**：summary 增「排行榜（积分/胜场/胜率）」「交手记录 H2H」页签；player 近 N 场 ACS sparkline；
    `team.html?name=&season=` 战队页（阵容/战绩/近期）；`events.stream_url` 创建表单 + 详情展示 + 后台编辑。
  - schema 第 13 节：上表全部 + `redeem_goods` grant + `avatars/goods` 桶。

- **待你操作**：请把 `supabase/schema.sql` 在 Supabase SQL Editor **重跑一次**
  （幂等）：已建过的 cover/event_captains 若在则跳过；
  **Phase 7 新增** `events.teams` / `events.group_count` 两列（赛制存既有 `format` 列）；
  **Phase 8 新增** `notifications` 表 + `event_registrations.new_team` 列；
  **Phase 9 新增** `site_users.avatar` + `reg_profiles` 表 + `reg-docs` 存储桶 ——
  不建则通知/自动队长、报名页截图上传与头像功能不生效（老报名流程有回退）；
  **Phase 10 新增** `reg_profiles.shots_verified` + `shots_verified_at`（截图人工核对标记）；
  **Phase 11 新增** `events.organizer_id` + `organizer_requests` 表（活动组织者申请/审核）；
  **Phase 12 新增** `event_lottery_results` 表（活动抽奖中奖记录）—— 不建则抽奖页历史/提交不生效；
  **Phase 13 新增** `points_ledger` / `event_bans` / `goods` / `goods_redemptions` 四表 + `site_users.banned*`、
  `events.stream_url`、`s5/s6_matches.event_id`（回填）+ RPC `redeem_goods` + `avatars`/`goods` 桶 ——
  不建则积分存库/封禁/商店不生效。首个超级管理员（执行一次）：
  `update public.site_users set role = 'superadmin' where username = '你的用户名';`

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
| 管理后台 | ✅ Phase 6 拆分：admin.html = 活动发布/状态/封面/队长设置（口令门保留）；赛果赛程成员工具迁至 **manage.html 数据台**（活动绑定，管理员||活动队长） |
| 赛果/赛程/成员工具 + 合并录入 | ✅ 数据台三 tab：合并录入（大比分自动识别）/ 赛果明细 / 成员维护 |
| 剧情模式 game.html | ✅ 原样 |
| 旧地址 home/compare/s5draft | ↳ 重定向到新页面 |

---

# Phase 14（V3 整合方案 · 本轮实现阶段 0–8，阶段 9–11 下轮）

> 本章是当前唯一有效的修改计划全文。之前口头方案（V2）与本章冲突处以本章为准。
> 工作方式：先方案、确认后写代码；每阶段一个 PR；数据库只新增迁移文件，不改已执行的 SQL。

## 14.0 总原则

1. 复杂留给系统：系统能判断的不问用户，能预填的不手填，能自动算的不手算；
2. 同一件事全站一个口径：权限、公开赛事范围、弹窗、错误提示各收敛到一处；
3. 前端按权限隐藏只是体验，服务端（RPC/校验）必须再查一遍；
4. 历史数据是事实快照：不回写历史比赛里的游戏 ID 等当时信息，靠别名/映射解析。

## 14.1 阶段 0 · seed 修复与字段契约（本轮）

- 修复 `supabase/seed.sql` 第 116 行：`s5_player_stats` 插入误用不存在的 `name` 列
  （源表 `s6_player_stats` 的姓名列是 `player_name`），导致整份 seed 在 Supabase 报错中断。
- 新增字段契约检查 `scripts/check-sql-fields.js`（`npm run check:fields`）：从
  `schema.sql + bootstrap.sql + migration_v3.sql` 提取每张表真实列名，核对
  `seed.sql / hardening.sql / migration_v3.sql` 中 `insert into T (cols)` 与已知表的列引用，
  防止再次出现「语法过但字段不存在」。
- seed 幂等：空库按 `schema → bootstrap → hardening → migration_v3 → seed` 一次跑通；
  已部分执行的库整份重跑即可（原报错点之前已写的数据由 on conflict / where not exists 吸收）。

## 14.2 阶段 1 · 五层权限地基（本轮）

### 14.2.1 现状问题（核对代码后确认）

1. 账号角色（member/organizer/admin/superadmin）之外，还叠了三套机制：
   管理口令 15 分钟临时会话 + `promoteRole` 永久回写 admin；活动组织者在
   `HWLayout.access()` 里被直接等同 `isAdmin`；队长靠赛季表 role + game_id/昵称/用户名字符串匹配推导。
2. 审核页只认 `role === 'admin'`，超级管理员反而被挡；在角色管理 RPC 与前端直改两条路并存。

### 14.2.2 五层模型（访客为第 0 层，只读公开内容）

| 层 | 身份 | 获得 | 核心边界 |
|---|---|---|---|
| 1 | 普通用户 member | 注册 | 浏览/报名/竞猜/评论；提交本队比赛结果（待确认）；改本人资料；发起改游戏 ID |
| 2 | 队长（活动内职务） | 组织者/管理员在活动内任命 | 仅本活动本队：分队、结果录入直接生效、确认对方提交的结果、锁前改本队数据 |
| 3 | 组织者 organizer | 申请→管理员审批 | 创建活动；自己活动内全权（设置/审核/赛程/队长/结果）；**可发放本活动荣誉**；可删自己创建的草稿 |
| 4 | 管理员 admin | 超管授予 | 全部活动管理、荣誉发放、审批组织者、授予组织者、限额调分、封禁/重置下级、**可删除活动** |
| 5 | 超级管理员 superadmin | 超管授予/改库（1–2 人） | 授予管理员/超管、赛季与站点设置、管理口令、强制解锁、身份合并、彻底清除已删活动 |

能力矩阵（唯一口径，页面与服务端共用）：

| 能力 | 普通 | 队长 | 组织者 | 管理员 | 超管 |
|---|---|---|---|---|---|
| 浏览/报名/竞猜/兑换/评论 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 提交本队结果（待确认） | ✅ | ✅ | ✅ | ✅ | ✅ |
| 结果直接生效 / 确认驳回 | ❌ | ✅本队 | ✅本活动 | ✅全部 | ✅ |
| 分队管理 | ❌ | ✅本队 | ✅本活动 | ✅全部 | ✅ |
| 创建活动 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 活动设置/报名审核/任命队长 | ❌ | ❌ | ✅自己的 | ✅全部 | ✅ |
| 发放/撤销荣誉 | ❌ | ❌ | ✅本活动 | ✅全部 | ✅ |
| 删除活动 | ❌ | ❌ | ⚠️仅自己草稿 | ✅全部（软删） | ✅含彻底清除 |
| 审批组织者 / 授予组织者 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 授予管理员 / 超管 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 调分 | ❌ | ❌ | ❌ | ✅限额+理由 | ✅不限额 |
| 封禁 / 重置密码 | ❌ | ❌ | ❌ | ✅仅下级 | ✅全部 |
| 赛季/站点设置/管理口令 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 审计日志 | ❌ | ❌ | ❌ | ✅查看 | ✅查看 |

### 14.2.3 删除活动的分级

默认**软删除**：`events.status='deleted'` + `deleted_at/deleted_by/delete_reason`，
全站不可见、数据保留，超管可在 30 天内恢复（改回原状态需人工确认）；彻底清除（硬删）仅超管。
删有报名/比赛数据的活动必须填原因 + 输入活动名二次确认，并通知其组织者与队长，全程审计。
组织者只能删自己创建的、且无有效报名的草稿。

### 14.2.4 现有机制处置

- 管理口令：**不再永久授予 admin**。`promoteRole` 改为空操作（保留函数名兼容调用方），
  口令只作 15 分钟敏感操作二次确认（`markAdmin`），且仅超管可修改口令；
- 组织者不再等于全站 `isAdmin`：`access()` 返回 `isOrganizer` 与能力集 `caps`，
  组织者在本活动获得 `event.manage / result.* / honor.award` 等本活动能力；
- 队长统一到活动队长口径：`event_captains` 为主、赛季队长表为兼容回退，绑定键逐步迁 player_key（阶段 2）；
- `HWLayout.access()` 新增返回 `caps`（能力对象），页面优先查 `caps.xxx`，
  旧字段（isAdmin/isCaptain/isEventCaptain/isOrganizer/captainTeams）保留兼容；
- 改角色只留服务端 RPC 一条路；审核页门禁改为「管理员及以上」。

## 14.3 阶段 2 · 注册表单与游戏 ID 更换（本轮）

### 14.3.1 注册表单

注册模式字段：账户名（一行，实时查重）/ 真实姓名（一行，公开显示）/ 工号（选填）/
密码 + 确认密码（同行并排，窄屏上下，明文开关同时控制两个）。登录模式只显示账户名 + 密码。
数据落点：`site_users.username` = 账户名；`site_users.nickname` 初始 = 真实姓名（展示名）；
`reg_profiles.real_name` = 真实姓名。输错用户名自动切注册并保留输入（已上线行为保留）。

### 14.3.2 标识分工（定死）

```
username   —— 只管登录，不参与任何数据关联，不公开
player_key —— 系统生成的不可变身份（player_identities 表），所有选手数据认它
游戏 ID    —— 公开展示 + 选手页地址，可改；旧 ID 进 player_id_aliases 跳转
user_id    —— 账号与选手档案的绑定键，管归属与权限
```

选手页地址：`player.html?id=<游戏ID>&season=<赛季>` 为 canonical；`?name=<真名>` 为兼容入口。
用户名不作 key 的理由：唯一性之外主键还要满足「人人都有（花名册/历史选手无账号）、
永不变（用户名会想改/会被改）、生命周期够长（账号注销重注册）、可公开（用户名是登录凭证一半）」。

### 14.3.3 改游戏 ID 流程

「编辑资料」中游戏 ID 改为独立「更换游戏 ID」入口（不随昵称/简介一起保存）：
输入新 ID → 实时校验（格式、与旧相同、被账号/花名册/别名占用）→ 影响预览
（历史场次 N 场，改名后自动跟随）→ 确认 → 原子更新账号 + 报名档案 + 当季花名册/档案引用，
并写别名与审计。历史 `*_matches` 里的 ID 快照**不回写**，选手页/数据中心聚合时经别名解析归一。
无比赛记录者简化为直接更换；自助改名 30 天限一次（前端提示，管理员不受限，服务端审计兜底）。

## 14.4 阶段 3 · 活动可见性、详情重构、删除活动（本轮）

可见性：访客/普通用户只见 registration/ongoing/finished；组织者另见自己创建的 draft/cancelled；
管理员/超管见全部（含 draft/cancelled）；deleted 除超管回收站外任何人不可见。
列表筛选的「草稿/已取消」选项仅组织者（自己的）与管理员出现；卡片对 draft/cancelled 视觉降级。

详情弹窗重构（一场比赛的信息层级）：
- 顶部：封面（有则横幅）+ 类型/赛季 eyebrow + 标题 + 状态角标；
- 信息条（短字段合并，永不独占整行）：开始/截止一行；赛制·组数·名额（含进度条，满员变珊瑚）一行；
  队伍 chips 换行；地点/直播有才出现；
- 页签：概览 / 报名名单（按队分组、可搜索）/ 活动空间 / 数据录入 / 管理（组织者本活动、管理员）；
- 底部固定操作区：我的状态 + 主按钮（报名/已报名/撤回按状态自动切换）；
- 管理页签含：状态、直播、封面、队长设置、荣誉管理入口、删除活动（管理员：软删流程）。

## 14.5 阶段 4 · 数据中心口径（本轮）

- 赛事下拉只含已发布未取消未删除赛事（registration/ongoing/finished）；赛季由其反推；
  深链带入不可见赛事时回退全部并轻提示；
- **仅删除**导出 CSV 旁的「数据汇总 →」按钮，`summary.html` 本体与功能保留；
- 已报名未上场选手行：统计列显示 `—` 不显示 0，状态「已报名」，默认排序沉底；
- 公开赛事范围口径收敛一处共用（本页 fetchEvents 已过滤，本轮补 deleted 并与选手页一致）。

## 14.6 阶段 5 · 选手页重构（本轮）

结构：面包屑（右上角无标志）→ 页首（头像 + 真名主标题 + 游戏 ID；**无队伍/分组/队长等赛事信息**）
→ 成就墙 → 生涯概览条 → 雷达 + 生涯明细 → 赛事数据（表格/折线图）→ 角色表 → 评论。

- 页首不放任何赛事相关标志：一人多赛事、每赛事队伍不同；队伍信息下放到赛事表「所在队伍」列；
- 身份三层解析：花名册 → 比赛记录 → 报名档案，命中任一层即正常渲染，未上场数据全空（`—`），
  永不整页报错；三层皆无才显示页内软 404；接口失败显示可重试错误条；
- 赛事数据：只展示**每赛事平均**（删逐场记录），列含所在队伍，按时间从早到晚（可倒序），
  未关联赛事一行置尾，已取消/已删除赛事不计入生涯与单赛事统计；
- 折线图：与表格同源同序，指标 chips 多选（ACS/K/D/KDA/每局击杀/每局助攻/胜率，默认 ACS，≤3），
  ACS 与其余双轴；1 个赛事单点提示、0 个空状态；遵从 reduced-motion，深浅 token 配色；
- 雷达图：五维（ACS/每回合击杀/每回合助攻/每回合存活率/KDA）同组同赛季百分位，标注样本量，
  样本 <3 或无数据时空心占位 + 说明，不消失；主题从 `data-theme` 读；
- 成就墙：荣誉 = 赛事封面缩略图 + 名称 + 赛事名 + 获得时间，时间倒序，前 6 + 查看全部；
  点开详情弹窗（大图、详细介绍、获得时间、[查看该活动 →] 深链打开活动详情）；
  桌面在姓名区右侧、移动端下移；无荣誉整块不出现；
- 保留：生涯平均与同组 TOP 排名、角色平均表与排名、评分评论（含回复/删除/10 星）；
  近 10 场 ACS 火花线由赛事折线图取代。

## 14.7 阶段 6 · 荣誉管理（本轮）

- 表 `player_honors`（见 migration_v3）：player_key/user_id、player_name、game_id、event_id、
  title、description、awarded_at、awarded_by；旧 `*_player_ids.honor` 文本由前端读取时兼容展示，
  新发放一律走结构化表；
- 入口在活动管理区「荣誉管理」：组织者（本活动）/管理员/超管可见可用，队长与普通用户不可见；
- 发放：选选手（本活动花名册 ∪ 报名名单，真名/游戏 ID 搜索）→ 名称（预设：总冠军/亚军/季军/
  MVP/FMVP/最佳进步/最佳新人 + 自定义）→ 详细介绍 → 获得时间（默认今天）→ 发放；
  同人同活动同名拦截重复；发放即站内通知本人（已绑定账号），未绑定者档案先行、绑定后补发；
- 列表可编辑介绍、可撤销（统一确认弹窗 + 审计），选手页成就墙实时同步；
- 封面：荣誉详情用所属活动封面图，无封面用带活动名的占位。

## 14.8 阶段 7 · 结果录入重构（本轮）

### 14.8.1 开放范围与导航

活动详情与数据台（manage）按能力开放：普通用户（本队比赛）、队长（本队）、
组织者（本活动全部）、管理员（全部）。无能力部分不渲染；未绑定队伍的普通用户进录入页
看到的是引导（去绑定游戏 ID/等分队）而非空白或报错。原数据台整页门禁改为分层进入：
结果录入对参赛者开放，成员维护仍限队长（本队）/组织者/管理员。

### 14.8.2 单场单表单一次保存

动线：数据录入 → 我的比赛（系统按「今日本队未录 → 下一场未开赛 → 最近可改」自动定位）。
表单自上而下：对阵头（**双方队名锁定不可改**，来自赛程；组别/阶段/时间预填，时间可改）
→ 逐图卡（地图、比分、双方 10 人数据）→ 底部固定汇总条。

预填：双方首发 5+5 的真名 + 游戏 ID 来自花名册；换人用下拉选替补，姓名↔ID 联动填充；
不在册的手输选手标记「临时选手」。用户只填：地图、每图比分、角色、ACS/K/D/A。

大比分全自动：每图比分判定胜方实时汇总（例：13:1、15:13 → 2:0），**手动大比分输入框删除**；
平图不计胜场并标注；按 BO1/BO3/BO5 提示系列赛是否结束；合法性只软提示不硬拦截。
管理员保留大比分纠错通道（必填原因 + 审计），普通入口不可见。

### 14.8.3 保存与状态机

一次提交原子写：赛程大比分 + 逐图 `*_matches` 行（含选手数据），失败整体回滚（前端串行写、
任一步失败提示并保留表单不清空）；草稿（本地 + 状态位）可续填。

状态机（以赛程行为载体，新列见 migration_v3）：
`unrecorded → pending（普通用户提交）→ confirmed（对方队长/组织者/管理员确认，或队长以上提交直达）
→ locked（赛后 24 小时自动或管理员手动；超管可解锁）`。
**只有 confirmed/locked 计入选手页与数据中心**；状态以徽章呈现在赛程与比赛列表，
选手数据页读取时按状态过滤（无状态列的旧数据视为 confirmed 兼容）。
提交/确认/驳回/修改通知相关队长，全部写审计。

## 14.9 阶段 8 · 选手页自动生成流水线（本轮）

报名审核通过 → 进待分队池 → draft 分队确认提交 → 系统自动 upsert 当季花名册（player_ids）
与选手档案（player_stats：player_name/game_id/team/group/role，含 player_key 与 user_id 绑定）
→ 选手页即时可达（未开赛：花名册信息 + 全空数据）→ confirmed 赛果自动填充。
分队重提交幂等：只更新 team/group/role/game_id，不覆盖已录赛果派生字段；
被拒/撤回的报名不生成；管理员在数据台成员维护有「重新同步选手页」动作兜底并写日志。
无「认领」概念：个人主页「我的选手页」按 user_id 绑定自动出现。

## 14.10 本轮修改（定稿并实现：SQL 两份制 + 一次性口令 + 阶段 9–11 + 连接收敛）

> 本节为本轮唯一有效的执行口径，全部改动合并在一个 PR 中一次提交。

### 数据库：两份制（install.sql + seed.sql）

- 删除 `schema.sql / bootstrap.sql / hardening.sql / migration_v3.sql`，合并为
  `supabase/install.sql`（约 1430 行：核心表 → 赛季表 → 既有增量 → 安全函数 →
  本轮新增 → 旧静态口令退役清理）。全新库跑 `install.sql`，已有库改版后重跑它即可。
- `supabase/seed.sql` 只放测试数据（含弱口令测试号，文件头有正式库禁用警告），
  正式环境只跑 install.sql。
- 【教训写死】给老表加列必须写在 install 的「结构补齐段」用
  `add column if not exists`，只改建表语句对已存在的表无效（matches.event_id 事故）。
- 新增表：admin_access_codes、login_attempts、seasons、registration_revisions、
  event_templates、import_batches、comment_reports、team_transfer_requests、
  bet_odds_snapshots；新函数：generate/redeem/revoke/list_admin_code(s)、
  create_season_tables、refund_redemption、place_bet（adjust_points 覆盖为带上限版）。
- 旧静态口令退役：install 末尾删除 site_settings 默认口令行并 drop
  check_admin_password / promote_self_admin（默认口令已知，留着即后门）。

### 一次性临时管理员口令

- 超管在管理后台生成：有效期预设 15/30（默认）/60/240 分钟或自定义输入分钟数
  （服务端硬校验 5–1440），带备注；生成前重输自己密码二次确认（HWAuth.verifyOwnPassword）。
- 口令 `HW-XXXX-XXXX-XXXX` 服务端生成、只存 SHA-256 哈希，明文仅返回一次；
  兑换为单条原子更新（防并发重复兑换），以 DB 时间判过期；兑换须登录绑人，
  成功给 15 分钟管理员会话（最高 admin，不升超管）；失败统一提示并按账号限速；
  未用口令可撤销；生成/兑换/撤销全写审计。events/review 两处口令门已切换。

### 测试超级管理员（仅 seed）

`00588771 / 123456`（昵称「测试超级管理员」，游戏 ID `HW-0005`，superadmin）。
弱口令测试号，正式环境禁止执行 seed；账号清单见 seed.sql 文件头。

### 阶段 9 · 加固（已实现）

- 登录限流：login_attempts 记录，同账号 10 分钟失败 ≥5 次锁定 10 分钟，成功清零；
  表未部署时静默跳过。定位为门槛级防护（前端登录模型），不夸大。
- 会话：localStorage 只存必要字段（不再存密码哈希）；meta 记录签发/活跃时间，
  7 天滑动续期、30 天强制重登，过期原地提示重登不丢页面；停用账号登录给明确原因。
- 审计日志页（管理后台）：按人/动作/时间筛选，50 条/页；ACTION_ZH 集中映射。
- 统一错误边界：HWLayout.stateHtml 三态（暂无数据/加载失败/无权限），已接入后台新区块与选手列表。

### 阶段 10 · 运营闭环（已实现；评论禁言按用户决定本轮不做）

1. 赛季管理：seasons 表 + create_season_tables 受控建表函数（key 白名单）。
   新建/设为当前/归档互不连带，多赛季可并行，归档纯手动、可恢复、二次确认+审计；
   当前赛季仅为新建活动默认值。归档后 manage/schedule/draft 显示只读横幅并禁用写操作。
2. 报名可修改：registration_revisions 存修改前快照；改队伍/真名/游戏 ID 等关键字段
   在已通过状态下自动回待审核并通知组织者，非关键字段直接生效；可查修改历史。
3. 候补可视化：我的报名/审核列表显示「候补第 N 位」，审核页一键递补（promoteWaitlist）+通知。
4. 活动复制（为草稿、不带报名赛程）与 event_templates 模板（套用/保存/删除）。
5. 批量审核补齐：批量拒绝（原因通知报名者、逐条反馈）与既有批量通过并存。
6. 赛果 CSV 导入：模板下载 → 逐行预检报错（格式/花名册匹配/队长仅本队范围/500 行上限）
   → 整批入库（import_batches + import_batch_id 标记）→ 可整批撤销（已确认赛程保留并提示）。
7. 队伍管理：改名（同步花名册与未开赛赛程、已结算保留快照）、队长转让
   （team_transfer_requests，对方确认后生效），写审计。
8. 评论审核（不含禁言）：选手页举报 → comment_reports 队列 → 管理员隐藏/恢复，处置留痕；
   已隐藏评论对访客不可见。
9. 商城退款：refund_redemption 原子退款（状态防重、库存+1、积分走流水、原因必填）；
   adjust_points 服务端硬上限：admin 单次 ±500，superadmin 不限。

### 阶段 11 · 收尾（已实现）

- 分页：审计 50/页、选手列表 20/页渲染分页、商店商品服务端 range 分页（20/页）。
  说明：选手生涯聚合口径不变且仍在前端计算（数据量小），服务端聚合 RPC 列下轮候选。
- 赔率走势：下注后写 bet_odds_snapshots 快照（失败不挡下注），对阵详情 canvas 小图。
- 竞猜自动锁定：状态 = 已结算 > 组别手动锁 > 到时锁（当前时间 ≥ 赛程对战时间）> 可竞猜；
  未排时间显示「时间待定」不开放；下注走 place_bet 服务端以 DB 时间裁决
  （未部署时回退前端复查）；锁定后禁撤注；时间统一北京时间（HWLayout.fmtBJ）；
  组别手动锁为管理员紧急兜底，后台开关 + 审计。
- 导出与打印：HWLayout.downloadCsv 统一入口（列定义一处），theme.css 补 @media print。

### Supabase 连接配置收敛（已实现）

URL/KEY 只保留 js/layout.js 一处（HWLayout.supa），auth.js 与 8 个页面
（admin/betting/draft/manage/matches/player/schedule/summary）全部改为取统一客户端。
summary.html 本体功能维持现状（仅连接一行收敛）；评论禁言、Supabase Auth 迁移本轮不做。

## 14.11 本轮数据库结构（install.sql，只增不改、幂等）

- 既有增量（原 migration_v3）：events 软删列、player_identities/aliases、player_honors、
  *_match_schedule 结果状态列、audit_log；
- 本轮新增表与函数见 14.10；seasons 初始行：s5 已归档、s6 当前（归档可随时恢复）；
- 空库演练顺序只有一份：install.sql →（测试环境可选）seed.sql。

## 14.12 本轮验证清单

1. `npm run check`（脚本语法 + CSS 配对）、`npm run check:sql`（四文件 PostgreSQL 解析）、
   `npm run check:fields`（字段契约）全绿；
2. JSDOM 冒烟 21 页全 OK；专项：权限 caps、注册表单、选手页空状态/成就墙/折线图数据、
   结果录入大比分自动算、draft 同步选手档案、seed 字段契约能抓出旧 bug（回退验证）；
3. 欧阳可淇用例：已报名未上场，从数据中心点入选手页正常打开、数据全空、无整页报错。

## 14.13 总验收（阶段 0–8 完成后逐项核对）

见 14.12 与各节验收点；未执行 migration_v3 的环境下新功能均应优雅降级
（荣誉/别名/状态列缺失时提示先执行迁移，不白屏、不影响既有功能）。

## 15. 设计系统与动效契约（Phase 3 · 本轮）

> 原则：**复杂留给我们，不留给用户。** 系统能判断的不留给用户；此刻没用的不出现；
> 能替人做的直接做；同一件事处处一样；按下去有回应、再按能收回。

### 15.1 状态只有一个出处

| 状态 | 唯一判定 | 用途 |
|---|---|---|
| 活动阶段 | `HWLayout.evState(ev, cnt, now)` | 卡片徽章、详情徽章、按钮、倒计时 |
| 比赛结果 | `HWLayout.resultStateOf(m, hasMaps)` | 赛程/比分卡徽章、结果录入待办 |

页面**禁止**再写 `if (ev.status === 'registration')` 之类的判定。页面只允许保留一份
「人工设定」的中文数据字典（管理员下拉用），那不是状态计算。

> 上一轮的 bug（卡片写「报名中」、点进去写「已截止」、截止时间已过）根因就是两处各自计算。
> 现在两者都调同一个函数，并用 `scripts/test-events.js` 六个时间场景锁死。

### 15.2 时间驱动 = 自动更新

`HWLayout.syncEventStatuses()` 每 30 秒重算一次，并在页面回到前台（`visibilitychange`）
和窗口聚焦时立即重算；跨过截止/开始/结束的那一秒，徽章与按钮自动切换，无需刷新。

### 15.2bis 全站共用的四件「手感」

| 能力 | 入口 | 为什么 |
|---|---|---|
| 时钟总线 | `HWLayout.clock(fn)` | 每 30 秒 + 回到前台 + 窗口聚焦各对齐一次；页面不许自建 `setInterval`（会忘关、会各跑各的）。单个回调抛错不影响其它页面。 |
| 提示 | `HWLayout.toast(msg, type, opts)` | 同类合并计数（连点五次只有一条声音）；错误不自动消失、点一下才走；`opts.action` 给一条可撤回的路；悬停/聚焦暂停倒计时。 |
| 加载 | `HWLayout.loader({rows, inline, label})` | 骨架条预告内容的形状，不再写「加载中…」四个字；带 `role=status` + `aria-live`。 |
| 内容入场 | `HWLayout.stagger` / `reveal` / `viewSwap` | 同一套错峰节奏，页面不各写动画。 |

「可撤回」只在真的会丢东西的地方出现，且窗口很短：
解封（8 秒，撤销即恢复封禁）、撤销口令（8 秒，`restore_admin_code`）。
超过窗口即视为确认——反悔期过长等于没有保护。

### 15.3 动效按「状态变化」而非「组件」设计

| 变化 | 手段 | token |
|---|---|---|
| 出现 | 淡入 + 8px 上移；列表用 `HWLayout.stagger` 错峰 28ms | `--t-swap` / `--ease-out` |
| 消失 | 淡出 + 轻微下移，**不可以用 display 立即消失** | `--t-hover` |
| 移动 / 换位 | `transform` 位移（页签指示条 `.dt-ink`、槽位条 `scaleX`） | `--t-swap` / `--ease-standard` |
| 尺寸变化 | `grid-template-rows: 0fr → 1fr` 展开，不做 `height` 动画 | `--t-panel` |
| 内容替换 | 方向感：向右切从右侧进 10px（`.pane-in-r`），向左反之 | `--t-swap` |
| 卡片 → 详情 | `document.startViewTransition` 形变（降级为淡入） | `--t-page` |
| 数字跳动 | `HWLayout.setNum` 只改文本，避免布局抖动 | — |
| 按下 | `scale(.97)`，90ms 内必须有回应 | `--t-press` |
| 悬停 | 边框/底色变化 ≤140ms | `--t-hover` |
| 加载 | `.sk-loader` 骨架条（形状预告内容），不再显示「加载中…」四个字 | `--t-amb-*` |
| 完成 / 出错 | 徽章色调 + 一次性 `reveal`，不做循环闪烁 | `--t-panel` |

全站只用 5 个时长和 4 条曲线（`--ease-standard/out/in/settle`）；`transition: all` 与
自造 `cubic-bezier` 由 `npm run audit:design` 拦截。

### 15.4 性能与可访问性约束

- 只动 `transform` / `opacity` / `grid-template-rows`；不动 `width`/`height`/`top`/`left`。
- 长列表用 `content-visibility: auto` + `contain-intrinsic-size`，屏幕外不参与绘制。
- `prefers-reduced-motion: reduce` 下：所有动画/过渡/滚动行为/延迟降为 0，无限循环动画关闭，
  骨架屏静止。这不是「额外照顾」，是默认路径之一。
- 键盘焦点环全站统一（`:focus-visible`）；页签 `role=tab` + `aria-selected`；
  加载与结果区 `role=status` / `aria-live=polite`。

### 15.5 验收命令

```
npm test
# = check + 状态口径(19) + 前后端口径 + 自动校验 + 活动大厅 + UI 原语
#   + 结果录入(24) + 17 页冒烟 + 设计审计
npm run audit:design
```

`npm test` 的七段各自守一类回归：

| 套件 | 守什么 |
|---|---|
| `check` | 语法、CSS 括号配平、脚本引用完整性 |
| `test:evstate` | 活动状态口径（含注入时钟的边界用例） |
| `test:events` | **「卡片说的 = 详情说的」**；过了截止时间界面自己翻面；页签无障碍 |
| `test:ui` | toast 合并/撤回/粘性、loader 无「加载中」字样、clock 抛错隔离 |
| `test:manage` | 结果录入：权限、预填、自动算分、写入形状 |
| `test:turn5` | 商店活动下拉、选手页赛事表+雷达图、待办审批、已结束筛选与详情无障碍名 |
| `test:parity` | 服务端 `sync_event_status` 与前端 `evState` 在 12 个时间场景下结果完全一致 |
| `test:autosync` | 落库只走 RPC、不直写；10 分钟节流；RPC 报错静默；聚焦才落库 |
| `test:pages` | 17 页在 Supabase 桩下不白屏、无控制台错误 |
| `audit:design` | 令牌、动效 token、徽章白名单、状态唯一口径、时钟总线、骨架屏、输入可访问名 |

全部通过才允许合并。

### 15.6 数据侧自动校验（`sync_event_status`）

**上一轮这里写错了**：文档说「`events.status` 到期后自动推进」，但代码里写回取的是
`evState().coarse`，而「报名截止但还没开赛」这一支根本没有 `coarse` 值 → 永远不会落库。
更糟的是写回是前端直写，RLS 又是 `for all using(true)`，等于任何登录用户都能改正别人的活动状态。
（这一段保留在这里，是因为它正好说明「文档承诺 ≠ 实现」是怎么发生的。）

现在的做法：

| 层 | 职责 |
|---|---|
| 前端 `HWLayout.evState` | 唯一状态判定；**立刻**正确显示，不等数据库 |
| `HWLayout.clock` | 30 秒 + 回前台刷新界面；只有「窗口聚焦 / 初次对齐」才允许落库 |
| `HWLayout.syncEventStatuses` | 只调 RPC `sync_event_status()`，10 分钟节流，失败静默；**不再直写 events** |
| `sync_event_status()` | 判定逻辑的唯一服务端出处（`security definer`），四条规则：结束 → 开赛 → 截止 → 满员 |
| `guard_event_registration()` | 数据库侧报名闸门：状态不可报 / 过期 / 满员（非候补）直接拒绝，绕过前端也拦得住 |

`events.status` 新增取值 **`closed`**（报名已截止、尚未开赛）。
这不是多此一举：没有它，"报名关闭"这件事在库里无处存放，只能靠前端每次重算。

**约定：两份规则必须一致。** `npm run test:parity` 把 SQL 的 where 条件还原成 JS，
用 12 个真实时间场景对拍服务端与前端，任何一边改了另一边没跟上就红。

**仍需人工做一次**：在 Supabase 执行 `supabase/install.sql`。pg_cron 若已启用，
函数会自己排上每 15 分钟一次；没启用就只能靠「有人打开页面 / 聚焦窗口」这个前提高频触发。
两者叠加才是「无人操作时也会推进」。

### 15.7 四个真实报障的根因（本轮）

| 报障 | 根因 | 修法 |
|---|---|---|
| 过了截止仍显示「报名中」 | 首页「近期活动」用 `EV_STATUS[ev.status]` 静态字典渲染，**完全绕过 `evState`**。上一轮只改了活动大厅，漏了这里 | 改用 `HWLayout.evBadge`；删除静态字典；`audit:design` 新增规则：用字典渲染当前状态即失败 |
| 竞猜名单「加载失败」 | `select('id, name, team, "group"')` 里 `group` 是保留字（已加引号，这没问题）；真问题是**聚合键用 `p.id`，而比赛行 `team_x_playerN_id` 存的是游戏 ID（`p.name`）**，永远对不上；且战绩表读取失败会让整块名单挂掉 | 聚合键统一为游戏 ID；战绩读取失败降级（指标显示「—」）；花名册为空时说明"还没配花名册"而不是"加载失败" |
| 商店门槛用「报名人数」 | 报名 N 次就能换奖励，可刷 | `reg_min` 移除并降级为 `event_any`；新增「参与过指定活动」（多选）、「实际出战 ≥ N 场」 |
| 所有账号密码错误 | `install.sql` §1.2 用 `password !~ '^[a-f0-9]{64}$'` 判断明文，**PBKDF2（`pbkdf2$…`）不匹配该正则**，于是每重跑一次脚本就把已升级的账号再哈希一次 → 永久锁死 | 判定改为跳过所有已知哈希格式（含 `!~*` 大小写不敏感）；新增 `must_reset` 标记与 `supabase/fix-passwords.sql` 一键恢复 |

**教训**：前三个都是「同一件事有两处实现」的变体——状态两处算、字段名两处认、门槛两处定。
审计规则据此增加：静态字典渲染状态、前端直写 events.status、共享方法名拼错。

### 15.8 又四个报障的根因（本轮）

| 报障 | 根因 | 修法 |
|---|---|---|
| 商店「参与过活动」不能选活动 | 上一轮做成了多选复选框墙，用户要的是**下拉选一个活动**；且切到别的条件类型再切回来，已选活动丢失（`syncCondsFromDom` 重建条件对象时不带 `events`） | 改为原生 `<select>`，选项来自真实活动列表；切类型前先把 `events` 存下来，切回来再写回 |
| 选手页风格与全站不一致、赛事数据不像表格 | 页面自带一套 legacy 卡片体系（`.data-section` 左侧珊瑚色渐变条、900 字重、字母间距 2px），表格也是自建的 `.ev-avg-table`；全站标准是 `.card` + `.data-table` | 骨架换成 `page-shell / page-head / card`，两张表统一 `.data-table`（数值列右对齐 + 等宽数字），删除 22 行死样式 |
| **雷达图不显示** | `processAllPlayerData` 用 `match['score']` 算回合数，但**比赛表根本没有 `score` 字段**，比分是 `score_a` / `score_b` → `totalRounds` 恒为 0 → 每回合击杀/助攻/存活率全是 0 → `calculateGroupRanks` 跳过回合数为 0 的选手 → 雷达图那段代码根本没执行，页面上只剩一个空 `<canvas>`（看起来像页面坏了） | 新增 `roundsOfMatch()` 统一取 `score_a + score_b`（兼容旧的 `"13:9"` 字符串）；趋势图胜负也改用同一口径；回合数为 0 时**明确说明缺少比分**，而不是画一张五边形都在 50 百分位的假图 |
| 「我的报名用户」没作用 | 它把所有报名平铺一遍，没有通过/拒绝按钮——只是换个地方看数据，帮不上忙 | 改为**报名待审批**：只列 `pending` + `waitlist`，按活动分组并显示座位占用，每条可一键通过/拒绝（写库 + 通知报名者 + 可撤销），处理完自动移出 |
| S6 正赛设为结束后，「已结束」页签还是空 | 静态筛选按钮的 `data-status` 写的是**库内状态值**（`registration/ongoing/finished`），而 `renderHall` 比较的是 `evState().phase`（`open/live/ended`）→ `ph === currentFilter` 永远不成立。`syncFilterOptions()` 会重写按钮，但它依赖角色/登录态，可能被跳过 | 按钮统一为 phase 值，并加 `FILTER_ALIAS` 兜住历史链接里的库内状态值；空状态说明「为什么空」并给出「查看全部」 |

顺带修掉的：已结束/进行中的卡片不再显示「报名截止」（对已结束的活动这是误导）；
详情对话框补上 `aria-labelledby`（此前只有 `aria-modal=true` 却没有可访问名称）；标题层级从 `h3` 提到 `h2`。

**教训（延续 §15.7）**：这一轮五个里有三个还是同一个病——**字段名两处认**（`score` vs `score_a`）、
**同一件事两处表示**（phase vs status）、**视图只搬数据不做决定**（待办审批）。
判断一个页面区块是否有用，标准是「它是否替用户做了决定」，而不是「它显示了数据」。
