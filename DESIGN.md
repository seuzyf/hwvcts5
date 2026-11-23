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
- **待你操作**：请把 `supabase/schema.sql` 在 Supabase SQL Editor **重跑一次**
  （幂等）：已建过的 cover/event_captains 若在则跳过；
  **Phase 7 新增** `events.teams` / `events.group_count` 两列（赛制存既有 `format` 列）；
  **Phase 8 新增** `notifications` 表 + `event_registrations.new_team` 列；
  **Phase 9 新增** `site_users.avatar` + `reg_profiles` 表 + `reg-docs` 存储桶 ——
  不建则通知/自动队长、报名页截图上传与头像功能不生效（老报名流程有回退）；
  **Phase 10 新增** `reg_profiles.shots_verified` + `shots_verified_at`（截图人工核对标记）。

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
