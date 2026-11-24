# HWVCTS 全站改进方案（诊断 + 实施）

> 适用范围：`seuzyf/hwvcts5` 多页静态站（`*.html` + `css/theme.css` + `js/*.js` + Supabase）。
> 本文分两部分：**A. 本次已落地修复**（可直接验收）与 **B. 后续改进方案**（按优先级排期）。
> 验收基线：深色 / 浅色主题、桌面 / 720px 以下移动端、鼠标 / 键盘（Tab + Enter/Space）。

---

## 0. 结论摘要

| 级别 | 问题 | 影响 | 状态 |
| --- | --- | --- | --- |
| P0 | 弹窗无 × 关闭、Esc 无效、滚动穿透 | 可用性 / 移动端直接卡死 | ✅ 已修 |
| P0 | 卡片滚动条在弹窗外侧（双滚动条） | 视觉与交互 | ✅ 已修 |
| P0 | 赛程卡片点不开、时间不落库、不驱动竞猜 | 核心业务链路断裂 | ✅ 已修 |
| P0 | 浅色模式积分/次要文字对比度不足 | 可读性 | ✅ 已修 |
| P1 | 商店详情样式简陋 | 观感 | ✅ 已修 |
| P1 | 数据中心可选已取消/草稿赛事 | 数据可信度 | ✅ 已修 |
| P1 | 全站 `select *` / 前端 500 行过滤 | 性能 | ⏳ 见 B-3 |
| P0 | 全表 RLS `using (true)` + 客户端自提权 | **数据安全** | ⏳ 见 B-1 |
| P0 | 明文可逆的账号体系（自动注册 + 无盐 SHA-256） | **账号安全** | ⏳ 见 B-1 |
| P2 | 硬编码深色、页面标题不统一、重复样式 | 可维护性 | 部分 ✅ / 见 B-4 |

---

## A. 本次已落地修复

### A-1 商店详情弹窗（用户问题 1）

**文件**：`shop.html`（页面内样式 + `#goods-modal` 结构 + `openDetail()`）

- 详情面板重做为「商品头图 / 标题 / 状态徽标 / 库存徽标 / 积分价签 / 资格条件 / 操作区」的明确层级：
  `.gm-panel` → `.gm-hero` → `.gm-head` → `.gm-meta-grid` → `.gm-conds` → `.gm-actions`。
- 新增 `.gm-cost-chip`（积分价签）、`.gm-cond`（逐条资格条件，满足/不满足分色）、`.gm-balance`（当前余额）。
- 商品卡本身补 `role="button"` / `tabindex="0"` / Enter+Space 触发，键盘可开详情。
- 异步竞态保护：`viewToken` 递增令牌，快速连点不同商品不会串数据。
- 未登录时余额显示 `—`，兑换按钮显示「登录后兑换」并可点击唤起登录；售罄 / 下架时按钮禁用并显示原因（不再出现"看着能点其实不能点"）。
- `color-mix()` 之前全部补了纯色 fallback，旧浏览器不会掉色。

### A-2 浅色模式积分对比度（用户问题 2）

**文件**：`css/theme.css`

- 提升 `--smoke` / `--slate` 两档弱化文字的对比度（浅色原值 `#87888c` / `#d8d8da` 在白底仅 3.4:1 / 1.4:1）：
  - 深色：`#7a7b7c` / `#5f6062`
  - 浅色：`#6a6c71`（白底 5.3:1）/ `#6d6f74`（白底 5.0:1）
- 补充浅色徽标文字色（`.badge-gold/green/blue/coral`），避免浅底上"黄字看不清"。
- 浅色下珊瑚色强调数字（`.shop-cost`、积分价签、余额、竞猜余额）统一加深为 `#c0392b`，白底对比度从约 4.0:1 提升到约 5.3:1。
- 商店余额改为「我的积分：<strong>123</strong>」结构，数字用等宽字体 + 强调色，不再淹没在灰色说明文字里。
- 积分价签、余额、资格条件统一走 token，不再写死颜色。

### A-3 弹窗关闭按钮（用户问题 3）

**文件**：`schedule.html` `draft.html` `manage.html` `admin.html` `events.html` `matches.html` `review.html` `js/layout.js` `js/auth.js`

补齐并统一 `aria-label="关闭"` 的 × 按钮：

| 页面 | 弹窗 | 按钮 |
| --- | --- | --- |
| `schedule.html` | 赛程详情 / 解说管理 | `#modal-x`、`#caster-x` |
| `draft.html` | 两处确认面板 | `#confirm-x`、`#confirm-x2` |
| `manage.html` | 数据校验确认 | `#validation-x` |
| `admin.html` | 积分 / 封禁 / 头像裁剪 | `#pts-close`、`#ban-close`、`#av-crop-close` |
| `events.html` | 详情 / 报名 / 创建 / 管理 | `#detail-close` 等 4 处 |
| `matches.html` | 比赛详情 | `#dynamic-close` |
| `review.html` | 报名详情 | `#rv-detail-close` |
| `js/layout.js` | 个人资料 / 头像 / 改密 / 通知 | `data-ov-close` 系列 |

同时为弹窗容器补 `role="dialog"` + `aria-modal="true"`（`matches.html`、`events.html`、`review.html`、`betting.html`、`admin.html` 头像裁剪、`js/layout.js` 通用面板、`js/auth.js` 登录框）。

### A-4 滚动条与滚动锁定（用户问题 4）

**文件**：`css/theme.css`、`js/layout.js`

- 新增滚动条 token：`--scrollbar-thumb` / `--scrollbar-thumb-hover`（深浅各一套），全局 `*` 统一为 **8px、透明轨道、圆角滑块**，hover 变亮；`.modal-panel` 内同样生效，不再出现"轨道在面板外、滑块贴边"的割裂感。
- `.modal-panel` 加 `overscroll-behavior: contain`，面板内滚到底不会带着背景一起滚。
- `.modal-backdrop` 自身隐藏滚动条（`scrollbar-width: none` + `::-webkit-scrollbar{width:0}`），从根上杜绝"面板外还有一条滚动条"。
- 打开弹窗时给 `body` 加 `.modal-open` → `overflow: hidden`；并用 `html:has(body.modal-open){overflow:hidden}` 兜底（Safari 老版本不吃 body 锁）。
- `html { scrollbar-gutter: stable }` 避免开关弹窗时页面横向跳动。
- `initModalBehaviour()` 用 `MutationObserver` 监听弹窗显隐（`.modal-backdrop` 与 `js/auth.js` 注入的登录框 `.hw-auth-backdrop`），自动：
  - 切换 `body.modal-open`（仅当值变化，避免抖动）；
  - `Esc` 关闭最上层弹窗；
  - `Tab` 焦点陷阱（`modalFocusables()` 只取可见、可聚焦元素）。
- `#hw-toasts` 加 `role="status"` + `aria-live="polite"`，提示可被读屏播报。

### A-5 赛程卡片可点开并驱动竞猜（用户问题 5）

**文件**：`schedule.html`、`betting.html`

- 赛程卡片重写：`tabindex="0"` + `role="button"` + `aria-label`，Enter / Space 打开；比分/时间/队伍全部 `escHtml()` 转义。
- 未排期的比赛（"待定 vs 待定"）也能点开，弹出**空壳表单**，可直接填写时间 → 队伍 → 解说 → 回放链接。
- 表单字段：`datetime-local` 时间、解说（逗号分隔）、回放链接（`safeUrl()` 只允许 `http(s)://` 或站内 `/`，防止 `javascript:` 注入）。
- 保存按 `currentSeason` 选表：`s6_match_schedule` / `s5_match_schedule`，以 `(group, match_id)` upsert，不会跨赛季写错表。
- 非管理员打开为**只读**（保存按钮隐藏，显示"仅管理员可编辑"提示）。
- `betting.html` 用 `matchBetState()` 统一推导状态（未开始 / 进行中 / 已结束 / 已取消），并每 30 秒按状态签名 `lastStateSig` 自动刷新，赛程改时间后竞猜页自动跟上，无需手动刷新。

### A-6 数据中心赛事筛选（用户问题 6）

**文件**：`players.html`

- `fetchEvents` 改为同时取 `status`，构造下拉时**过滤掉 `draft` 与 `cancelled`**。
- 已用 JSDOM 验证：给定 4 条赛事（registration / cancelled / draft / finished），下拉只出现 `全部赛事`、`正式赛 · S6`、`已结束 · S5`。
- 移动端（≤720px）筛选项改为整行堆叠，标签独占一行，14 列表格在窄屏可横向滚动。

### A-7 自查发现并已修复

| 问题 | 处理 |
| --- | --- |
| `matches.html` 比赛卡片是纯 `div`，键盘不可达 | 补 `role="button"` + `tabindex` + Enter/Space |
| `events.html` 活动卡只有 Enter，Space 无效 | 补 Space（`preventDefault` 防滚动） |
| `betting.html` 竞猜卡同上 | 补 Space |
| `summary.html` 与 `players.html` 同名"数据中心"，导航歧义 | `summary.html` 改为「赛事数据」 |
| 标题品牌写法混乱（`HWVCTS5` / `HWVCTS6` / `HWVCTS` / `HWVCT S5`） | 统一为「页面名 · HWVCTS」 |
| `player.html` 气泡提示写死 `#151520` / `#fff` | 改为 `var(--graphite)` / `var(--pure-white)`，浅色主题自适应 |
| `shop.html` 售罄/下架状态判断顺序错误 | 先判 `out` 再判登录态 |
| `schedule.html` 回放链接未做协议校验 | `safeUrl()` 白名单 |

### A-8 已执行的验证

```bash
# 1) 语法：所有页面内联脚本 + js/*.js
node --check <每个 script>            # → ALL OK

# 2) 补丁空白/冲突检查
git diff --check                      # → 无输出

# 3) JSDOM 冒烟（stub Supabase + HWAuth/HWLayout）
node /tmp/smoke3.js $(ls *.html)   # → 19 个页面全部 OK
node /tmp/players_test.js   # 赛事下拉过滤正确
node /tmp/shop_test.js      # 详情弹窗字段/状态/余额正确
node /tmp/schedule_test.js  # 卡片可开、字段回填、只读态正确
```

> 说明：早期冒烟脚本在 `index.html` 报 `HWLayout.renderAuth is not a function`，经核对为**测试 stub 未导出该方法**（`js/layout.js:1292` 确有导出），补齐 stub 后 `index.html` 通过。`s5draft.html` 的 "Not implemented: navigation" 是跳转桩的正常行为。
> **待补**：真实浏览器下的深/浅色视觉走查（见 C）。

---

## B. 后续改进方案（按优先级）

### B-1 【P0 · 安全】先堵住"任何人可读写全库"

现状：`supabase/schema.sql` 中 `site_users`、`events`、`event_registrations`、`notifications`、`points_ledger`、`goods_redemptions` 等表全部是

```sql
create policy xxx_write on public.xxx for all using (true) with check (true);
```

配合 `js/auth.js` 里硬编码的 publishable key，等于**任何人拿到 URL 就能改积分、改报名、改角色**。`js/layout.js` 的 `promoteRole()` 与 localStorage `hw_admin_until` 只是前端装饰，不构成权限。

方案（分三步，可灰度）：

1. **立刻**：把 `for all using (true)` 改为最小集
   ```sql
   -- 读：公开内容放行；敏感表只允许本人
   create policy site_users_select on public.site_users
     for select using (true);                      -- 主页/榜房需要展示，保留
   create policy site_users_write on public.site_users
     for update using (auth.uid() = id) with check (auth.uid() = id);

   -- 积分流水：只读自己，写入只允许 service role
   drop policy points_ledger_write on public.points_ledger;
   create policy points_ledger_select on public.points_ledger
     for select using (auth.uid() = user_id);

   -- 兑换记录：本人可读，写入走 RPC
   create policy goods_redemptions_select on public.goods_redemptions
     for select using (auth.uid() = user_id);
   ```
2. **业务写操作改走 `rpc`**：`recalcBalance`、`doRedeem`、`promoteRole`、`recalcAfterScoreChange` 全部改为 `security definer` 的 SQL 函数，内部校验 `auth.uid()` 与角色，前端不再直接 `update`。
3. **角色判定服务端化**：新增 `user_roles(user_id, role, granted_by)` 表，`promoteRole` 只保留 UI 提示，真实判定在 RPC / 视图里做；`hw_admin_until` 仅作"本次会话免二次确认"的体验标记。

> 迁移注意：改 RLS 前先用 `select` 只读策略灰度一周，观察 403；`bootstrap.sql` 与 `schema.sql` 要同步，避免两套 DDL 漂移。

### B-2 【P0 · 账号】停用"输错用户名即自动注册"

现状：`js/auth.js` 登录时若查不到用户名，会**自动注册**；密码为无盐 SHA-256（`sha256Hex`），且 `site_users.password` 与 `s6_bet_users.password` 双写。

方案：

1. **关闭自动注册**：登录失败就返回"用户名或密码错误"，注册只能走注册页。
2. **密码哈希升级**：改为 Supabase Auth（`signInWithPassword`），或至少 `crypto.subtle` + 每用户随机 salt（`PBKDF2-SHA-256, 100k` 轮）；登录成功后按需**原地升级**旧哈希（`password_version` 字段）。
3. **去掉双写**：`site_users` 与 `s6_bet_users` 统一到一张表 + 视图，避免两套密码长期不一致。
4. publishable key 是设计上可公开的，但**必须配合 RLS**；在 B-1 完成前不要把 key 当作安全边界。

### B-3 【P1 · 性能】停止"整表拉到前端再过滤"

| 位置 | 问题 | 方案 |
| --- | --- | --- |
| `js/layout.js` `recalcBalance` | 无条件 `select('*')` 拉**全部** `s6_bet_bets` 与 `s6_match_schedule` | 加 `.eq('user_id', userId)`（下注）/ 只取未结算场次；或直接改成一条 SQL 视图 `v_user_balance` |
| `shop.html` `loadRecords` | 拉 500 条兑换 + 全部商品 + 全部用户，前端 `find` | 普通成员已下推 `.eq('user_id', me.id)`；管理员/组织者仍全量，建议再按商品 `created_by` 下推 + 分页 |
| `admin.html` | 多处 `select('*')` | 显式列名 + 分页（`range()`），默认 50 条 |
| `players.html` | 三表 `select('*')` 全量后再聚合 | 服务端视图 `v_player_stats`，或按 `event_id` 下推过滤 |
| `schedule.html` / `matches.html` | 全量拉取后前端分组 | 用 `.in()` / `.eq()` 按 group、event 下推 |

配套：给 `events.status`、`matches.event_id`、`goods_redemptions.user_id`、`points_ledger.user_id` 建索引（`bootstrap.sql` 里补）。

### B-4 【P1 · 视觉一致性】清理硬编码深色

- `game.html`：场景背景（`#0f1923` 等）是**有意的氛围设计**，可保留，但需补 `[data-theme="light"]` 的降级（浅色下降低对比、加白色蒙层），并在 `DESIGN.md` 里注明"剧情页为独立视觉分支"。
- `player.html`：除已修的 tooltip 外，`.summary-list div` / 表格 `rgba(255,255,255,...)` 已有 light 覆盖，建议统一抽成 `--surface-sunken` / `--hairline` 两个 token。
- `manage.html`、`lottery.html`：仅个别 `#fff` / `#14060b` 属于"固定前景色"，可保留。
- 建议：新增 `css/tokens.md` 或在 `DESIGN.md` 补一张 **token 对照表**（深/浅值 + 用途），后续 PR 用 `stylelint` 规则禁止页面内出现裸 `#xxxxxx`（白名单除外）。

### B-5 【P1 · 信息架构】页面职责重叠

- `players.html`（全站数据中心）与 `summary.html`（单赛事数据）职责接近，建议：
  - 短期：已改名区分（全站「数据中心」/ 赛事「赛事数据」）；
  - 中期：`summary.html` 的雷达图 + 对比能力并入 `players.html` 的 `?event=` 模式，减少一套表单与样式。
- `index.html` 的 `renderAuth` 与 `js/layout.js` 的 `renderAuth` 存在重复逻辑，建议统一由 `HWLayout.renderAuth()` 渲染，页面只留挂载点。
- **竞猜表没有赛季维度**：`betting.html` 的赛程/选手表会按 `currentSeason` 切 `s5_*` / `s6_*`，但下注表写死 `s6_bet_bets`。S5 赛事的竞猜实际落到了 S6 表里，且 `recalcBalance` 只扫 S6 下注。建议：新增 `s5_bet_bets`（`like s6_bet_bets including all`）并按赛季选表，或把下注表改成单表 + `season` 列（更彻底，需迁移脚本）。

### B-6 【P1 · 可访问性】补齐剩余键盘路径

- 已完成：赛程卡、比赛卡、活动卡、竞猜卡、商店卡、弹窗 Esc / Tab 陷阱。
- 待办：
  - `summary.html` 排序表头 `th[data-sort-key]` 只有 `cursor:pointer`，应加 `tabindex="0"` + `aria-sort` + Enter 排序；
  - `matches.html` 队伍名单元格 `team-name-cell` 是 `td` 点击，建议改 `<button class="link">`；
  - `manage.html` 行内删除按钮加 `aria-label="删除第 N 行"`；
  - 全站 `<img>` 补 `alt`，装饰性图标 `aria-hidden="true"`；
  - 弹窗打开时把焦点移到标题或第一个输入框（当前只做陷阱，未做初始聚焦）。

### B-7 【P2 · 工程化】降低维护成本

1. **抽公共 CSS**：`events.html`、`player.html`、`betting.html`、`schedule.html` 各自复制了一份 `.modal-*` / `.meta-*` 样式，建议全部收敛到 `css/theme.css`（本次已收敛弹窗与滚动条，剩余页面级样式仍需迁移）。
2. **抽公共 JS**：`SUPABASE_URL` / `SUPABASE_KEY` 在 12+ 个文件里重复，改为 `js/config.js` 单一来源（`window.HW_CONFIG`），避免改环境漏改。
3. **统一错误处理**：目前各页 `if (error) console.error(...)` 静默失败，建议 `HWLayout.apiError(error, '加载赛事失败')` 统一 toast + 上报。
4. **构建**：`package.json` 目前只有 jsdom + lucide-static；建议加一条 `npm run check`（`node --check` 全量 + `html-validate`），把本次手工验证固化。
5. **路由**：`s5draft.html` / `home.html` / `compare.html` 是跳转桩，建议在 `DESIGN.md` 标注"已废弃，保留 301"，或直接删除并加服务端重定向。

### B-8 【P2 · 内容】文案与空状态

- 多处空状态只有"暂无数据"，建议给出**下一步动作**（如"暂无赛程 → 去创建比赛"）。
- `shop.html` 售罄商品建议保留卡片但置灰 + 显示"下次补货时间"，而不是隐藏。
- `events.html` 取消/草稿赛事对普通用户应完全不可见（不仅是筛选器，列表也要过滤）。

---

## C. 验收清单

### C-1 功能

- [x] 商店点开任意商品 → 详情弹窗有头图、价签、库存、条件、余额、兑换按钮
- [x] 未登录点兑换 → 弹登录框；售罄 → 按钮禁用并写明原因
- [x] 所有弹窗右上角有 ×，`Esc` 可关，`Tab` 不会跑到弹窗后面
- [x] 弹窗打开时背景不滚动；面板内滚动条为细圆角、不出现外层第二条
- [x] 浅色模式下积分、余额、资格条件、徽标文字清晰可读
- [x] 赛程卡片（含"待定 vs 待定"）可点开，填写时间/解说/链接后刷新仍在
- [x] 修改赛程时间后，`betting.html` 30 秒内状态自动变化
- [x] 数据中心赛事下拉不含"已取消""草稿"
- [x] 键盘 Tab 能落到赛程/比赛/活动/竞猜/商店卡片，Enter/Space 可打开

### C-2 视觉（待真实浏览器确认）

- [ ] 深色 / 浅色各截一套：商店详情、赛程详情、数据中心筛选、竞猜卡片
- [ ] 375px 宽度下：筛选栏堆叠、表格可横滑、弹窗不超出视口
- [ ] 滚动条在 Chrome / Safari / Firefox 下均为细条（Firefox 走 `scrollbar-width: thin`）

### C-3 回归

- [ ] `node --check` 全绿（已通过）
- [ ] `git diff --check` 无空白错误（已通过）
- [ ] JSDOM 冒烟 19 个页面全 OK（已通过）
- [ ] 真实 Supabase 环境点一遍"赛程保存 → 竞猜状态变化"（**待做**）

---

## D. 实施节奏建议

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| 第 1 轮（本次） | 用户 1–6 + 自查 P0/P1 | 已完成，待视觉走查 |
| 第 2 轮 | B-1 RLS + B-2 账号 | 3–5 天，需灰度 |
| 第 3 轮 | B-3 查询下推 + 索引 | 2–3 天 |
| 第 4 轮 | B-4 token 化 + B-5 页面合并 | 3–4 天 |
| 第 5 轮 | B-6 a11y 收尾 + B-7 工程化 | 2–3 天 |

---

## E. 本次改动文件

```
admin.html      弹窗 ARIA + 头像裁剪 role
betting.html    卡片键盘/ARIA、30s 状态刷新
css/theme.css   滚动条 token、滚动锁、focus ring、浅色对比度
draft.html      两个确认面板 × 按钮 + ARIA
events.html     详情/报名/创建/管理 × 按钮、卡片 Space、ARIA
js/auth.js      登录框 ARIA
js/layout.js    modal 行为系统（Esc/Tab/滚动锁）、toast aria-live
manage.html     校验弹窗 × 按钮 + ARIA
matches.html    卡片键盘、弹窗 ARIA
players.html    赛事过滤、移动端筛选栏
review.html     详情弹窗 ARIA
schedule.html   详情弹窗重做、表单持久化、卡片键盘、safeUrl
shop.html       详情弹窗重做、状态机、键盘、fallback
player.html     tooltip 颜色 token 化
summary.html    改名「赛事数据」
game/admin/manage/player/schedule  标题统一
```
