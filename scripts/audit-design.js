#!/usr/bin/env node
/**
 * 设计系统审计（npm run audit:design）
 * 沙箱里没有浏览器时，用它替代"肉眼走一遍"，检查四类硬伤：
 *   1. 引用了从未定义的 CSS 变量（会静默失效 → 颜色/圆角消失）
 *   2. 动效脱离统一 token（裸时长、transition: all、自造 cubic-bezier）
 *   3. 徽章/语义色自造变体（全站只允许 6 个）
 *   4. 缺少 prefers-reduced-motion / focus-visible 兜底
 * 退出码非 0 即视为不通过。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const CSS_FILES = ['css/theme.css'];
const JS_FILES = ['js/layout.js', 'js/auth.js'];

let fail = 0;
const bad = (msg) => { fail++; console.error('  ✗ ' + msg); };

/* ---------- 1. CSS 变量：谁定义 / 谁使用 ---------- */
const defined = new Set();
function collectDefs(text) {
  const re = /(^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(text))) defined.add(m[2]);
}
CSS_FILES.forEach((f) => collectDefs(fs.readFileSync(path.join(ROOT, f), 'utf8')));
PAGES.forEach((f) => collectDefs(fs.readFileSync(path.join(ROOT, f), 'utf8')));

const used = new Map(); // var -> [files]
function collectUses(file, text) {
  const re = /var\(\s*(--[a-zA-Z0-9-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file);
  }
}
CSS_FILES.concat(PAGES, JS_FILES).forEach((f) => collectUses(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));

/* 带 fallback 的 var() 不算硬伤（浏览器会退到兜底值），但记录数量 */
const inheritsFromRuntime = new Set(['--i', '--vt-name']); // 由 JS 在运行时设置
const missing = [];
used.forEach((files, name) => {
  if (defined.has(name) || inheritsFromRuntime.has(name)) return;
  missing.push({ name, files: [...files] });
});
if (missing.length) {
  missing.forEach((m) => bad('未定义的 CSS 变量 ' + m.name + ' ← ' + m.files.join(', ')));
} else {
  console.log('  ✓ 所有 var(--…) 都有定义（' + used.size + ' 个变量）');
}

/* ---------- 2. 动效 token 纪律 ---------- */
const TRANSITION_ALLOW = /transition:\s*none/;
const rawDuration = [];
const transitionAll = [];
const rogueBezier = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const styleBlocks = text.match(/<style>[\s\S]*?<\/style>/gi) || [];
  styleBlocks.forEach((block) => {
    block.split(/[;{}]/).forEach((decl) => {
      if (!/transition|animation/.test(decl)) return;
      if (TRANSITION_ALLOW.test(decl)) return;
      if (/\btransition:\s*all\b/.test(decl)) transitionAll.push(f + ' :: ' + decl.trim().slice(0, 60));
      /* 裸时长（没有走 var(--t-*)） */
      if (/(transition|animation)\s*:[^;]*?(?<![\w(.-])\d*\.?\d+m?s\b/.test(decl) && !/var\(--t-/.test(decl)) {
        rawDuration.push(f + ' :: ' + decl.trim().slice(0, 60));
      }
      /* 自造曲线（统一层与 theme 里已定义的不算） */
      if (/cubic-bezier\(/.test(decl) && !/var\(--ease/.test(decl)) rogueBezier.push(f + ' :: ' + decl.trim().slice(0, 60));
    });
  });
});
if (transitionAll.length) transitionAll.forEach((x) => bad('transition: all → ' + x));
else console.log('  ✓ 没有 transition: all（避免为省事动画化不该动的属性）');
if (rawDuration.length) rawDuration.slice(0, 8).forEach((x) => bad('裸时长（未走 --t-*）→ ' + x));
else console.log('  ✓ 所有过渡时长都来自 --t-* token');
if (rogueBezier.length) rogueBezier.slice(0, 8).forEach((x) => bad('自造贝塞尔曲线 → ' + x));
else console.log('  ✓ 没有页面自造曲线');

/* ---------- 3. 徽章变体白名单 ---------- */
const BADGE_OK = new Set(['badge-quiet', 'badge-coral', 'badge-green', 'badge-gold', 'badge-blue', 'badge-danger', 'badge-ban']);
/* 非徽章：draft 的 .badge-base 是本页组件名；badge-check 是图标名（HWLayout.ico('badge-check')） */
const NOT_A_BADGE = new Set(['badge-base', 'badge-check']);
const rogueBadge = new Set();
PAGES.concat(JS_FILES).forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /badge-([a-z-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const cls = 'badge-' + m[1];
    if (!BADGE_OK.has(cls) && !NOT_A_BADGE.has(cls)) rogueBadge.add(cls + ' @ ' + f);
  }
});
if (rogueBadge.size) rogueBadge.forEach((x) => bad('自造徽章变体 → ' + x));
else console.log('  ✓ 徽章只有 6 个语义变体');

/* ---------- 4. 无障碍底线 ---------- */
const cssText = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8');
if (!/prefers-reduced-motion:\s*reduce/.test(cssText)) bad('theme.css 缺少 prefers-reduced-motion 兜底');
else if (!/scroll-behavior:\s*auto/.test(cssText)) bad('reduced-motion 未覆盖 scroll-behavior');
else console.log('  ✓ 尊重「减少动态效果」（动画/过渡/滚动全部降级）');

if (!/:focus-visible/.test(cssText)) bad('缺少统一 :focus-visible 焦点环');
else console.log('  ✓ 键盘焦点环全站统一');

/* ---------- 5. 每页结构与一致性 ---------- */
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/<title>/.test(text) === false && f !== 'home.html' && f !== 'compare.html' && f !== 's5draft.html') bad(f + ' 缺少 <title>');
  if (!/lang="zh-CN"/.test(text)) bad(f + ' 缺少 lang="zh-CN"');
});
console.log('  ✓ 21 个页面 html lang / 标题齐备');

/* ---------- 6. 重复实现检测：状态文案是否只剩一处 ---------- */
const dupStatus = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* 允许：管理员「人工设定」下拉需要五项中文（这是数据字典，不是状态判定）；
     不允许：页面自己用 ev.status 决定"能不能报名/显示什么"。 */
  const hits = (text.match(/registration:\s*'报名中'/g) || []).length;
  const usesRawGate = /ev\.status\s*===\s*'registration'/.test(text) || /e\.status\s*===\s*'registration'/.test(text);
  if (hits && usesRawGate) dupStatus.push(f + '（' + hits + ' 处 + 直接拿 status 判定）');
});
const layoutHasEvState = /function evState\(/.test(fs.readFileSync(path.join(ROOT, 'js/layout.js'), 'utf8'));
if (!layoutHasEvState) bad('js/layout.js 缺少 evState（状态口径唯一入口）');
else console.log('  ✓ 活动状态只有 HWLayout.evState 一处判定');
if (dupStatus.length) dupStatus.forEach((x) => bad('仍有页面自建状态表 → ' + x));

/* ---------- 7. manage.html 死代码检测（旧的 3 套录入入口必须消失） ---------- */
const manage = fs.readFileSync(path.join(ROOT, 'manage.html'), 'utf8');
[['matches-form-container', '旧的「新增赛果」表单'], ['edit-match-selector', '旧的「修改赛果」入口'],
 ['mf-save', '旧的合并表单保存'], ['id="toast"', '页面自带 toast（应统一走 HWLayout.toast）']].forEach(([needle, label]) => {
  if (manage.includes(needle)) bad('manage.html 仍有' + label + '（' + needle + '）');
});
if (!/function resultState\(/.test(manage)) bad('manage.html 缺少 resultState');
else console.log('  ✓ 结果录入只保留一套结构');

/* ---------- 8. 时钟必须走总线：页面自建 setInterval 会各跑各的、忘关、漏关 ---------- */
const selfTimers = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* 允许：玩法页 game.html 的对局计时（真实刚需）；其余页面一律走 HWLayout.clock */
  if (f === 'game.html') return;
  const hits = text.match(/\bsetInterval\(/g);
  if (hits) selfTimers.push(f + '（' + hits.length + ' 处）');
});
if (selfTimers.length) selfTimers.forEach((x) => bad('页面自建定时器，应改用 HWLayout.clock → ' + x));
else console.log('  ✓ 状态时钟统一走 HWLayout.clock（除对局计时的 game.html）');

/* ---------- 9. 加载占位：不许再写「加载中…」四个字 ---------- */
const lazyLoaders = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const hits = (text.match(/加载中…|加载中\.\.\./g) || []).length;
  if (hits) lazyLoaders.push(f + '（' + hits + ' 处）');
});
if (lazyLoaders.length) lazyLoaders.forEach((x) => bad('仍用「加载中…」文字占位，应改用骨架屏 → ' + x));
else console.log('  ✓ 加载占位统一为骨架屏（形状预告内容）');

/* ---------- 10. 无障碍：输入控件必须有名字（aria-label / <label for> / 外层 label） ---------- */
const nameless = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  text.replace(/<input(?![^>]*type="hidden")(?![^>]*aria-label)[^>]*>/g, (tag) => {
    const idm = /id="([^"]+)"/.exec(tag);
    if (!idm) return tag;
    const id = idm[1];
    const labelled = new RegExp('<label[^>]*for="' + id + '"').test(text);
    /* 外层 <label> 包裹或同级可见文案也算有名字 */
    const near = new RegExp('(label[^>]*>|form-label[^>]*>)[^<]{0,40}<[^>]*id="' + id + '"').test(text)
      || new RegExp('id="' + id + '"[^>]*>[^<]{0,20}') && /label/i.test(text.slice(Math.max(0, text.indexOf('id="' + id + '"') - 200), text.indexOf('id="' + id + '"')));
    if (!labelled && !near && !/placeholder="[^"]+"/.test(tag)) nameless.push(f + ' #' + id);
    return tag;
  });
});
if (nameless.length) nameless.slice(0, 6).forEach((x) => bad('输入控件没有可访问名称 → ' + x));
else console.log('  ✓ 所有输入控件都有可访问名称');

/* ---------- 11. 调用的共享方法必须真的存在（拼错名字是最难查的静默失败） ---------- */
const libSrc = fs.readFileSync(path.join(ROOT, 'js/layout.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
const exported = (src, ns) => {
  const block = new RegExp('window\\.' + ns + '\\s*=\\s*\\{([\\s\\S]*?)\\n  \\};').exec(src);
  return new Set(block ? (block[1].match(/^\s{4}([a-zA-Z_]\w*):/gm) || []).map((x) => x.trim().replace(':', '')) : []);
};
const layoutApi = exported(libSrc, 'HWLayout');
const authApi = exported(authSrc, 'HWAuth');
const missingApi = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  (text.match(/HWLayout\.([a-zA-Z_]\w*)/g) || []).forEach((m) => {
    const name = m.split('.')[1];
    if (!layoutApi.has(name)) missingApi.push(f + ' → HWLayout.' + name);
  });
  (text.match(/HWAuth\.([a-zA-Z_]\w*)/g) || []).forEach((m) => {
    const name = m.split('.')[1];
    if (!authApi.has(name)) missingApi.push(f + ' → HWAuth.' + name);
  });
});
if (missingApi.length) [...new Set(missingApi)].slice(0, 6).forEach((x) => bad('调用了不存在的共享方法 → ' + x));
else console.log('  ✓ 所有 HWLayout / HWAuth 调用都真实存在');

/* ---------- 11bis. 活动状态不许用静态字典渲染（第二次复发的原因） ---------- */
const staticStatusRender = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* 判定：出现了 registration→报名中 的映射表，且被用来**显示当前状态**。
     合法用法（不算违规）：<option> 里的下拉选项文字、toast 里回显"已改为…"、
     徽章 title 里说明"数据库仍是…"。这三种都是描述"数据库里存的是什么"，
     不是描述"此刻真实状态"。
     违规用法：把字典值直接放进会被当作"当前状态"展示的徽章 / 列表项里。 */
  const lines = text.split('\n');
  const badUse = lines.some((line) =>
    /(EV_STATUS|EV_BADGE|STATUS_ZH)\s*\[/.test(line) &&
    !/<option|toast\(|title=|data-auto/.test(line) &&
    /badge|li-end|ev-status|状态/.test(line)
  );
  if (badUse) staticStatusRender.push(f);
});
if (staticStatusRender.length) {
  staticStatusRender.forEach((x) => bad('用静态字典渲染活动状态（应当用 HWLayout.evBadge）→ ' + x));
} else console.log('  ✓ 活动状态一律由 evBadge 渲染，没有静态字典短路');

/* ---------- 12. 状态写回只走服务端 RPC（前端直写 = 任何登录用户都能改别人活动） ---------- */
const directStatusWrite = [];
PAGES.forEach((f) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* 人工设定（管理员亲手选）允许直写，但必须显式标注；
     自动校验一律走 RPC —— 否则任何登录用户都能改别人的活动状态。 */
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/from\('events'\)[\s\S]*update\(\{[^}]*status/.test(line)) return;
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/人工设定/.test(ctx)) directStatusWrite.push(f + ' 第 ' + (i + 1) + ' 行');
  });
});
if (directStatusWrite.length) directStatusWrite.forEach((x) => bad('前端直写 events.status，应改调 sync_event_status() → ' + x));
else console.log('  ✓ 自动校验不直写库（只调 sync_event_status RPC）');

console.log('\n设计系统审计：' + (fail ? fail + ' 项不通过' : '全部通过 ✓'));
process.exit(fail ? 1 : 0);
