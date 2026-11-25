# 修复与重构方案（待确认 · 不含任何代码改动）

> 范围：活动状态口径 · 结果录入页重构 · 全站审美一致性 · 全站动效（Apple 级）
> 工作方式：**先方案 → 你确认 → 分批改 → 我亲手跑一遍 → 二次审查 → 合并**

---

## 0. 先给结论（一页读完）

| # | 你的感受 | 真正的原因（已定位到行） | 归属 |
|---|---|---|---|
| 1 | 卡片「报名中」，点进去「已截止」 | 状态有 **5 套各自实现**，没有人把 `status + reg_deadline + max_slots + 时间` 算成一个「此刻真实状态」 | P0 |
| 2 | 显示「报名截止」的时间已经过去了，状态还没变 | 同上：数据库里 `status` 是**人工维护的静态字段**，而 `reg_deadline` 是时间事实，两者从不联动 | P0 |
| 3 | 结果录入很混乱 | 页面上**同时存在 3 套录入入口**（合并表单 / 新增赛果 / 修改赛果），21 处相互引用；`toast()` 调了 19 次但**这个函数根本不存在** | P1 |
| 4 | 审美不统一 | 组件样式被复制到 13 个页面的 `<style>`（约 2000 行），`admin.html` 里有 86 个 inline style；**27 个 CSS 变量被引用但从未定义**（`--gold-main`、`--val-cyan`…直接失效） | P2 |
| 5 | 动效不够细腻 | 全站 **13 种时长、24 个自造 keyframes、`transition: all` 散落各处**；有一半是「假动效」（元素被 `innerHTML` 重建，transition 根本不会播放） | P3 |
| 6 | — | 「我的报名」里 `waitlistPos` 被误写进 `if (!u)` 块内（strict mode 块级函数），列表渲染会抛 ReferenceError | P0（需跑一遍确认） |

---

## 1. 已定位的 Bug 清单（只查不改，证据到行）

### P0 · 用户能直接撞上的

**B1 状态口径分裂（你报的主问题）**
- `events.html:604-606` 卡片角标 = 数据库 `ev.status` 原文；
- `events.html:813-814` 详情页才临时算 `deadlinePassed`；
  → 同一场活动，卡片说「报名中」、详情说「报名已于 … 截止」。
- `index.html:446` 更狠：`e.status === 'registration' ? '报名中' : '进行中'`，只认两个值，过期的、满员的、已结束的都靠猜。
- `js/layout.js:911`、`admin.html:586,601`、`register.html:164` 各自又有一份 `EV_STATUS_ZH`。
- **共 5 份状态映射 + 2 套「能不能报名」判断**，这就是「同一件事，处处不一样」的根源。

**B2 报名截止后状态不自动变**
数据库里没有任何触发器/定时任务把 `registration → ongoing`；`admin.html` 靠人手下拉。所以「过了截止时间还在招人」是必然结果。
（注：`install.sql` 有 `deleted_at`、`result_status` 等列，但没有事件状态机。）

**B3 `manage.html` 里 19 处 `toast(...)` 调用指向不存在的函数**
该文件只定义了 `showToast()`；`toast` 不在全局（`layout.js` 只导出 `HWLayout.toast`，`shop/lottery` 各自包了一层，`manage` 漏了）。
后果：保存失败、校验不通过、建对阵失败……**全部静默**，有的还 `return toast(...)` 直接抛 TypeError 中断流程。
行号：782, 783, 798, 799, 805, 807, 823, 824, 853, 861, 862, 863, 891, 895, 896, 901, 902, 910, 928, 947。

**B4「我的报名」渲染会抛错**
`events.html:628-636`：`waitlistPos()` 被写进了 `if (!u) {` 的花括号里；`'use strict'` 下块级函数声明不对外可见，`renderMine()` 第 666 行调用它 → ReferenceError，整块列表不出来。

**B5 候补用户能重复报名**
`register.html:794-797` 找 `mine` 时只认 `pending/approved`，不含 `waitlist`；而 `events.html:myRegOf` 认 `waitlist`。
→ 候补中的人再进报名页，看到的是空表单，「提交报名」会插入第二条记录。

**B6 名额进度条数字口径不一致**
卡片/详情用 `pending + approved`，候补 `waitlist` 不计入（这本身是对的），但界面上**没有任何地方告诉用户「候补 N 人」**，于是「已满」和「我排第几」全靠猜。

### P1 · 影响信任感/效率

**B7 结果录入是 3 套并存**
`merged-tab` 里同时有：合并表单 `#merge-form`（比分 + 大比分自动算）、`#matches-form-container`（新增赛果，10 人 × 每图）、`#edit-match-form-container`（按对阵修改赛果）。
`mf-save` 保存后还会偷偷调 `submitMatches()`（`manage.html:1323-1331`）——两个表单之间有隐式耦合。
这套结构源自「SQL 表只有 `team_a_player1..5_data` 这种十列扁平结构」，所以重构成 UI 容易、但要**先接受"一张图一条记录、10 名选手挂在同一条记录上"的数据形态**。

**B8 录入进度会丢**
全站 `beforeunload` 出现 0 次，`DESIGN.md 14.8.3` 承诺的「草稿可续填」未实现。填了 10 个人 × 3 张图，误触刷新全没。

**B9 `result_status` 只在录入页写、在选手页读**
`schedule.html` / `matches.html` **完全不显示**「待确认 / 已确认 / 已锁定」——录完的人不知道生效没有，看的人不知道数据算不算数。

**B10 严重的一致性事故：27 个未定义 CSS 变量**
`player.html`（`--gold-main`、`--star-color`、`--cool-main`、`--shadow-color`、`--control-height`、`--dur-1`）、`game.html`（`--val-*` 共 11 处）、`register.html`（`--amber`）。
机制上：`color: var(--gold-main)` 不生效 → 回落到继承色；`border-radius: var(--r-input)` 若在页面上下文缺失 → 圆角消失。这是「同一件事，处处一样」的硬伤。

### P2 · 可访问性 / 细节

- 弹窗无 ESC 关闭、无焦点陷阱、`modal-backdrop` 未设 `aria-hidden`/`inert`（`events.html:1127` 注释明确「不点空白关闭」，但 ESC 该有）。
- 详情页签用 `hidden` 切换，无 `role="tab"/aria-selected`、无方向键。
- `html { scroll-behavior: smooth }` 在 `prefers-reduced-motion: reduce` 下**仍然平滑**（只有 `theme.css:1373` 那条规则，管不到它）。
- `:focus-visible` 只有 `.seg button` / `.ev-tab` 有，其余按钮/输入框没有统一焦点环（coss 体系里这是硬性项）。

---

## 2. 方案一 · 活动状态：一个函数说了算（P0，改动最小、收益最大）

### 2.1 核心：新增「派生状态」唯一入口

在 `js/layout.js` 新增 `HWLayout.evState(ev)`，返回**结构化状态**而不是字符串：

```
{ key, label, badge, tone,           // 展示
  joinable, blockedReason,           // 能不能报名 + 一句话原因（"报名已于 11-20 23:59 截止"）
  phase,                             // draft | upcoming | open | closing-soon | full | closed | live | ended | cancelled | deleted
  hint }                             // 界面自我说明用的一句话
```

推导顺序（**系统能判断的，绝不问用户**）：

| 序 | 条件 | 结论 |
|---|---|---|
| 1 | `status='draft'` | 草稿（仅组织者/管理员可见） |
| 2 | `status='cancelled'` | 已取消 |
| 3 | `status='deleted'` | 已删除（仅超管回收站） |
| 4 | `now > end_time`（有值） | **已结束** ← 即使 status 还是 registration |
| 5 | `now` 在 `[start_time, end_time]` | **进行中** ← 同上 |
| 6 | `status='registration'` 且 `reg_deadline` 已过 | **报名已截止**（label 文案直接带截止时间） |
| 7 | 名额满（approved+pending ≥ max_slots） | **名额已满 · 可候补** |
| 8 | 距截止 < 24h | **即将截止**（补一句「还剩 3 小时」） |
| 9 | 其余 registration | 报名中 |
| 10 | `status='ongoing'/'finished'` 且时间对不上 | 以**人工状态为准**，但页面注明"以管理员设置为准" |

> 关键设计：**时间事实优先于人工字段，人工字段是兜底**。这样「过了截止时间还显示报名中」在物理上不可能再出现。

### 2.2 调用点收敛（5 处 → 1 处）

| 位置 | 改成 |
|---|---|
| `events.html` 卡片 + 详情 + 筛选器 | 全部读 `evState()`，筛选按 `phase` 分桶 |
| `index.html` 首页今明简报 | 读 `evState()`，删掉硬编码三元 |
| `js/layout.js` `eventOverview` / `eventBar` | 读 `evState()` |
| `admin.html` 活动列表 | 徽章读 `evState()`；**下拉框改为「仅覆盖」**，默认选项显示「自动（当前：报名已截止）」，管理员改了就存 `status_override` |
| `register.html` | `canReg` 读 `evState().joinable`，`mine` 判定补 `waitlist`（修 B5） |

### 2.3 要不要写回数据库（**需要你确认，见 §7 问题 2**）

- **方案 A（纯前端派生，零 DB 改动）**：任何页面打开时都显示正确状态；数据库 `status` 仍可能是 `registration`。优点：零风险、可立即上线；缺点：导出/通知/第三方读库仍看到旧值。
- **方案 B（前端派生 + 后台自动落库）**：在 `install.sql` 增加一个幂等函数 `sync_event_status()`，由前端在进入活动大厅时**低频调用一次**（或 Supabase Cron 每天 1 次）。优点：数据也一致；缺点：要动数据库。
- 我的建议：**先 A，B 作为同一个 PR 里的可选第二步**（有 Cron 就挂 Cron，没有就前端触发 + 12 小时节流）。

### 2.4 顺带修掉

- B4（`waitlistPos` 位置）、B5（候补重复报名）、B6（卡片上补「候补 3 人 · 我排第 2」）、
- 卡片角标从 3 个（类型/状态/我的报名）压成 **1 个主状态 + 1 个我的状态**，其余信息移到详情：对应「此刻没用的，就不出现」。

---

## 3. 方案二 · 结果录入页重构（P1，整页重写，不保留现结构）

你说「不用保留现在的结构」，那就推倒重来。**唯一保留的约束**是数据形态（`s6_matches` 一张图一条记录、`s6_match_schedule` 一场对阵一条记录），因为选手页/数据中心都依赖它。

### 3.1 产品形态：从「表单堆」改成「一场比赛的工作台」

```
┌ 赛事数据台 ────────────────────────────────────────────────┐
│ [传奇组 ▾]  [结果录入]  [成员维护]        ← 只有两项，删掉"新增/修改赛果" │
├────────────────────────────────────────────────────────────┤
│  待你处理 3 场 · 今日 1 场                     ← 系统算的，不是用户数的  │
│  ┌ 今天 20:00  A队 vs B队   未录入        [开始录入 →] ┐  ← 自动定位到  │
│  ┌ 昨天 21:00  C队 vs D队   待确认(对方)  [查看]      ┐  ← 首条即展开    │
│  ┌ —           E队 vs F队   已生效        [修改]      ┐                 │
│  [+ 新建对阵]（仅管理员/组织者）                                        │
├────────────────────────────────────────────────────────────┤
│  ▶ 已展开：A队 vs B队                                       │
│    阶段 小组赛 · 开赛 2025-11-25 20:00 · 回放 [____]   ← 预填，可改     │
│    ── 图 1  ──────────────────────────  13 : 9   A 胜                  │
│      地图 [源工重镇 ▾]                                                 │
│      ┌ A队（首发 5 人，来自花名册，可下拉换替补）──┐ ┌ B队 ──┐         │
│      │ 姓名 角色  ACS  K  D  A  │ …              │ │ …     │         │
│      └────────────────────────┘                    └───────┘         │
│    [+ 加一图]                                                          │
│    ── 系列赛 2:0（自动）· BO3 已结束 ──                                 │
│  ┌ 吸底操作条 ────────────────────────────────────────┐                │
│  │ 保存并生效 · 自动保存于 12:03        [取消]        │                │
│  └────────────────────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────┘
```

### 3.2 按你的 8 条原则逐条落地

| 原则 | 具体做法 |
|---|---|
| 系统能判断的，不留给用户 | 自动定位到「你该录的那一场」；大比分自动算（**删掉手填框**，管理员纠错改为「点数字直接改 + 必填原因」的隐藏通道）；BO3 打满 2 胜后自动收起后续图；用花名册自动填 10 人姓名+游戏 ID；赛段从对阵继承 |
| 此刻没用的，就不出现 | 无权限的 tab 不渲染；没有花名册的队伍不出现「预填」按钮；非管理员看不到「新建对阵」；未开赛的对阵不出现比分输入 |
| 能替人做的，就直接做 | 保存后自动算系列赛、自动写 `result_status`、自动通知对方队长、自动刷新列表并保持展开状态；重复对阵自动去重提示 |
| 同一件事，处处一样 | 「未录入/待确认/已生效/已锁定」四个徽章在 manage / schedule / matches 三页共用同一个组件与配色 |
| 按下去有回应，再按能收回 | 保存按钮四态：idle → saving（转圈+禁用）→ 成功（✓ 保持 1.2s）→ idle；展开/收起同一个按钮切换（再按即收起）；加一图可删 |
| 不打断人手上的事 | 单人单图填写时不校验、不弹窗；只在**保存前**用底部提示条列问题（不阻塞）；切换对阵时若有未保存内容 → 底部提示条「保留 / 放弃」，**不弹模态** |
| 常用的好做，会丢东西的难误碰 | 保存按钮右侧吸底、始终可达；「删除这一图」「清空本场」放次要位置 + 二次确认；离开页面有未保存内容时 `beforeunload` 拦截 |
| 界面自己说明自己 | 每个输入框下方一行灰字说明来源（「来自花名册」「自动计算」「可留空」）；空状态写「本组还没有对阵，先建一个」而不是「暂无数据」 |

### 3.3 技术上怎么做（不引入框架）

- 一个 `renderResultConsole()`（约 500~600 行）替换现有 3 块；数据仍走现有 Supabase 表，不改 schema。
- 状态机统一走一个小函数 `resultState(fixture, maps)` → `unrecorded | pending | confirmed | locked`，写库时用 `result_status` 现有列（`install.sql` 已有）。
- 自动保存：`localStorage["hw_draft_" + eventId + "_" + fixtureId]`，输入停 800ms 落盘；页面加载时若发现草稿 → 顶部黄条「上次有未提交的内容，恢复 / 丢弃」。
- 删除 `#matches-form-container` / `#edit-match-form-container` / `#submit-matches` / `#update-match` 及其 21 处引用。CSV 导入保留（它是批量工具，不是重复入口），挪到「更多」折叠区。
- 全部 19 处 `toast()` → 统一 `HWLayout.toast()`（B3）。

### 3.4 需要你先确认的一个取舍（§7 问题 1）

- **A 单场工作台**（上图）：一次专注一场，流程最短，和 `DESIGN.md 14.8.2` 一致。
- **B 赛程看板**：以「轮次/小组」为纲，一屏看到所有对阵状态，点开才进单场。适合每周集中录入的人，但单场录入动作更深。

我倾向 **A**（A 同时可以做 B 的一半：顶部就是状态分组的对阵队列）。**默认按 A 做**，你否掉我再改。

---

## 4. 方案三 · 审美与一致性（P2）

### 4.1 从 coss.com/ui 借什么（它是 React + Base UI + Tailwind，我们不能直接装）

只借**设计结论**，用现有 vanilla CSS/JS 实现：

| coss 的做法 | 我们落地 |
|---|---|
| 单一语义色阶（neutral/success/warning/danger/info）+ Badge 变体收敛 | `badge-quiet / badge-coral / badge-green / badge-gold` **4 个就是全部**，禁止页面自造；新增 `.badge-danger` 一处定义 |
| `:focus-visible` 2px ring + 2px offset 全组件统一 | 加一条全局规则，覆盖 button/a/input/select/textarea/[tabindex] |
| Progress / Meter 有确定值时带 `aria-valuenow` | 名额条改成 `<div role="progressbar">`，加 `aria-valuenow/max` |
| Tabs 有 `aria-selected` + 指示条 | 详情页签、数据台 tab 统一成一套 `.tabs`，指示条用 transform 滑动 |
| Empty / Skeleton / Spinner 三件套 | 所有「加载中…」文字 → skeleton；所有「暂无数据」→ `stateHtml()` 扩展成 icon+标题+说明+可选按钮 |
| Alert / Toast 分级 + 可从底部收 | toast 四类（info/ok/warn/err）+ 同一进出曲线 + 可点掉 |
| 密度与圆角统一（4/6/8/12/16） | 只保留 `--r-btn 8 / --r-input 8 / --r-badge 6 / --r-card 16 / --r-card-lg 20`，清掉页面里的 9px/10px/12px 一次性圆角 |

### 4.2 组件收敛路线（不搞大爆炸重写）

1. **第 1 步**：`css/theme.css` 末尾追加「统一层」（约 250 行）：tabs、meter、empty、skeleton、button 四态、focus ring、badge 4 变体、`--dur/--ease` 新 token。
2. **第 2 步**：`js/ui.js`（新文件，约 200 行）：`UI.badge() / UI.meter() / UI.tabs() / UI.empty() / UI.skeleton() / UI.confirm()` 六个工厂，只被**重构过的页面**用。
3. **第 3 步**：逐页删掉与统一层重复的 `<style>` 规则（顺序：events → manage → index → admin → schedule → matches → register → review → shop → lottery → betting → player → draft → game）。每删一页跑 `npm run check` + 我手动点一遍。
4. **第 4 步**：`game.html`（474 行样式、34 个硬编码颜色）和 `draft.html`（294 行）属于「独立玩法页」，**只做配色对齐、不动结构**——避免把彩蛋玩坏。

### 4.3 深浅色

现在 `[data-theme="light"]` 覆盖只有 12 条规则，`player.html`/`game.html` 的硬编码色在浅色下必然出问题。方案：把这些页面的颜色全部换成 token（`--pure-white` 在浅色下已经是 `#101113` 的黑），并给 `:root` 加 `color-scheme`。

---

## 5. 方案四 · 动效：一套语言，只解释、不装饰（P3）

### 5.1 先明确「按状态变化去找」的清单

我把全站会变的东西列了出来（这是审查方法，不是按部件）：

| 状态变化 | 现状 | 目标 |
|---|---|---|
| 页面切换 | `page-fade` 单一淡入 | 保持（跨页无法共享元素，淡入 120ms 足够） |
| 列表整体重绘（`innerHTML`） | 直接替换，**卡片闪烁/滚动跳变** | 局部 patch + 滚动位置保持 + 新增项 60ms 错峰淡入 |
| 卡片 → 详情 | 硬弹 | `document.startViewTransition` 渐进增强：卡片封面 morph 到详情头图，其余 fade（不支持则退化为原样） |
| 弹窗 开/关 | 已有 `opacity+transform`，但 `layout.js` 的活动概览 inline 强制 `opacity:1` **跳过动画** | 统一 `.modal` 语言：面板 320ms `--ease-out` + 背景 200ms；关闭沿原路返回；**可打断**（用 transition 不用 animation） |
| Toast 出/入 | 有，但 `manage` 自己一套 | 一套：底部居中，进 240ms 上浮 8px，出 160ms 淡出；最多 3 条堆叠 |
| 页签切换 | `hidden` 硬切 | 指示条 transform 滑动 220ms + 内容 12px 上浮淡入，方向感（左右） |
| 数字变化（名额/比分/统计） | `num-bump` 只有 2 处在用 | tabular-nums + 数字滚动（仅 stats 卡片，300ms）；名额条 width 用 **CSS 变量差值 + 只在值变化时 transition** |
| 按下 / 悬停 | 部分有 `scale(.97)`，部分 `transition: all` | 全站统一：hover 背景 140ms；active `scale(.98)` 90ms；focus ring 无动画 |
| 加载 / 完成 | 文字「加载中…」 | skeleton 呼吸（1.4s）+ 完成后 120ms 淡出；按钮 saving 态转圈 |
| 出错 | toast 或静默 | 字段级红边 + 下方一行说明（不打断输入） |
| 展开 / 收起（折叠区、加一图） | 无动画 | `grid-template-rows: 0fr → 1fr`（内容高度自适应、纯 CSS、不掉帧）+ 180ms |
| 拖动 / 调整（滚筒、拖拽） | draft 滚筒已有、部分 `transition: all` 会在拖拽中掉帧 | 拖拽期间强制 `transition: none`，松手再用 260ms 弹回 |

### 5.2 令牌（一套曲线，全站只用这些）

```
时长：--t-1 90ms(按压) --t-2 140ms(悬停) --t-3 220ms(展开/页签) --t-4 320ms(弹窗/视图) --t-5 420ms(仅页面级)
曲线：--ease-out      cubic-bezier(0.22, 1, 0.36, 1)    出场/进入（保留现有，已成体系）
      --ease-standard cubic-bezier(0.32, 0.72, 0, 1)    iOS 式，位移/形变
      --ease-in       cubic-bezier(0.4, 0, 1, 1)        退场
      --ease-settle   cubic-bezier(0.34, 1.3, 0.64, 1)  仅「落定/确认」两处用（滚筒、保存成功）
距离：进入 8px / 退场 6px / sheet 24px / 缩放 0.98
```
硬规则：**只动 `transform` 和 `opacity`**（唯一例外是 `width` 的名额条，且它只在值变化时动）；`transition` 优先于 `animation`（天然可打断）；`will-change` 只在 hover/拖拽期间临时加。

### 5.3 统一收编现有 24 个 keyframes

保留 4 个签名动画：`page-fade`、`hw-toast-in`、`skeleton-sweep`、`draw-roll`（滚筒）。
其余（`fadeIn`×2、`targetPulse`、`subtle-bob`、`resultSlam`、`pulse-bg`、`pulse`、`mgFlash`、`ltPop`、`gradient-flow`、`glow-text`、`float-particle`、`diamond-gradient`、`crown-shimmer`、`blink`、`banner-in-out`、`notifIn`、`nav-menu-in`…）
→ 能映射到统一语义类的就映射（`.m-enter / .m-exit / .m-swap / .m-count / .m-stagger`），装饰性无限循环的（`glow-text`/`gradient-flow`/`float-particle`/`blink`）**全部删除或改为一次性**，因为持续动画会持续耗电、也违反「克制」。

### 5.4 无障碍 / 性能红线（交付前我逐条量）

- `@media (prefers-reduced-motion: reduce)` 改成**全局**：`*, ::before, ::after { animation-duration: .01ms !important; transition-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; }`（现在只管 theme 里的类）。
- 长列表（活动大厅、数据表、比赛列表）用 `content-visibility: auto` + `contain-intrinsic-size`，并在 200/1000 行两档实测滚动帧率。
- 手机 375px / 平板 768px / 桌面 1440px + 深浅色 + `reduce` 六种组合各点一遍。
- 用 DevTools Performance 录一段「滚动 + 开弹窗 + 页签切换」，确认无长任务 > 50ms、无 layout thrash。

---

## 6. 执行顺序（4 个 PR，每步都能独立上线）

| PR | 内容 | 风险 | 验收 |
|---|---|---|---|
| **PR1 · 状态口径** | `HWLayout.evState()` + 5 处调用点收敛 + B4/B5/B6 + (可选)自动落库 | 低 | 造 6 种活动（未到截止/已过截止/满员/已结束/进行中/草稿）逐一对比卡片↔详情↔首页↔后台↔报名页 |
| **PR2 · 结果录入重写** | 整块替换 + 自动保存 + 离开保护 + 19 处 toast + 状态徽章三页共用 | 中 | 队长/组织者/管理员/普通选手 4 个身份各录一场；断网保存失败；半途刷新恢复 |
| **PR3 · 设计系统 & 动效基础层** | 新 token + 统一层 + `js/ui.js` + 全局 reduced-motion + focus ring + 修 27 个未定义变量 | 低 | 全站 21 页在 6 种环境下目检 + 键盘走查 |
| **PR4 · 逐页清理 & 动效落地** | 按 §4.2 顺序删重复样式、动效语义类接入、24→4 keyframes | 中 | 帧率实测 + 视觉回归截图对比 |

合并策略：每 PR 我自测通过后 → 二次审查 → `gh pr merge`（你说「直接合并上线」，我按这个执行，但**PR2 我会等你点过一次再合**，因为它改的是数据入口）。

---

## 7. 需要你拍板的 4 件事

1. **结果录入形态**：A 单场工作台（推荐，一次一场，最快）／ B 赛程看板（一屏多场）。
2. **状态自动化的落库策略**：A 纯前端派生（零风险，立即可上）／ B 派生 + 数据库自动同步（需动 `install.sql`，要你在 Supabase 里执行一次）。
3. **动效强度**：克制（仅状态变化，最接近 iOS 系统手感）／ 中等（+ 卡片 morph、数字滚动）／ 明显（+ 视差、粒子）。**推荐中等**。
4. **「上线」的定义**：这个仓库没有 CI 配置，静态站直连生产 Supabase —— 合并到 `main` 是否就等于发布？还是要我额外做什么？

### 关于「让 Gemini / GPT 当顾问、做审查」

我这边**不能直接调用 Gemini 或 GPT 的接口**（除非你在连接器里授权）。我的替代做法，效果等价：
- **方案阶段**：按你给的 8 条原则 + 动效 7 条标准，逐条做成 checklist，对每个改动项打分（这是 Gemini 那套「方案/文案/交互顾问」的视角）。
- **交付前**：跑一轮独立的「第二双眼睛」审查——不看我的实现思路，只按 checklist 反向挑刺（文案是否有歧义、状态是否可达、有没有更懒的路径），产出问题清单我再逐条修。

如果你确实要接真·第三方模型评审，告诉我用哪个连接器，我在 PR 描述里预留评审结果一栏。
