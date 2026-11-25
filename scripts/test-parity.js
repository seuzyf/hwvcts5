#!/usr/bin/env node
/**
 * 前后端口径一致性测试（npm run test:parity）
 *
 * 服务端 sync_event_status() 里那几条 UPDATE 的 where 条件，等于是把状态机又写了一遍。
 * 两套规则一旦漂移，就会出现「界面说报名已截止，库里还写着报名中」——正是这次的原始事故。
 *
 * 这里把 SQL 里的条件**逐条提取出来**，还原成 JS 判定，
 * 再拿一组真实时间场景同时喂给两边，要求每一行结果完全相同。
 * 这样 SQL 改了而 JS 没改（或反过来）会立刻红。
 */
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'install.sql'), 'utf8');
const layout = fs.readFileSync(path.join(__dirname, '..', 'js', 'layout.js'), 'utf8');

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

/* ---------- 1. SQL 里确实有这四条规则（防止有人删了却没人发现） ---------- */
const sqlBody = SQL.slice(SQL.indexOf('create or replace function public.sync_event_status()'));
const fn = sqlBody.slice(0, sqlBody.indexOf('$$;'));
const rules = {
  finished: /set status = 'finished'[\s\S]*?where status in \('registration', 'closed', 'ongoing'\)[\s\S]*?end_time is not null[\s\S]*?end_time < now\(\)/,
  ongoing: /set status = 'ongoing'[\s\S]*?where status in \('registration', 'closed'\)[\s\S]*?start_time is not null[\s\S]*?start_time <= now\(\)/,
  closedDl: /set status = 'closed'[\s\S]*?where status = 'registration'[\s\S]*?reg_deadline is not null[\s\S]*?reg_deadline < now\(\)/,
  closedFull: /set status = 'closed'[\s\S]*?max_slots is not null[\s\S]*?status in \('pending', 'approved'\)[\s\S]*?>= e\.max_slots/
};
console.log('\n[SQL] 状态机四条规则都在');
Object.keys(rules).forEach((k) => ok('规则存在：' + k, rules[k].test(fn)));

/* ---------- 2. 服务端行为（把上面的 where 逐条还原） ---------- */
function serverNext(ev, taken, now) {
  const T = (v) => (v == null ? null : new Date(v).getTime());
  const end = T(ev.end_time), start = T(ev.start_time), dl = T(ev.reg_deadline);
  let status = ev.status;
  /* 顺序必须与 SQL 一致：finished → ongoing → closed(截止) → closed(满员) */
  if (['registration', 'closed', 'ongoing'].includes(status) && end != null && end < now) return 'finished';
  if (['registration', 'closed'].includes(status) && start != null && start <= now && (end == null || end >= now)) return 'ongoing';
  if (status === 'registration' && dl != null && dl < now && (start == null || start > now)) return 'closed';
  if (status === 'registration' && ev.max_slots != null && ev.max_slots > 0 && taken >= ev.max_slots) return 'closed';
  return status;
}

/* ---------- 3. 前端口径（把 evState().coarse 反复应用直到稳定 = 服务端跑过之后的结果） ---------- */
const dom = new (require('jsdom').JSDOM)(`<!doctype html><html><head><title>t</title></head><body></body></html>`,
  { url: 'https://example.test/', runScripts: 'dangerously' });
dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
dom.window.eval(layout);
const HWLayout = dom.window.HWLayout;

const PHASE_TO_STATUS = { ended: 'finished', live: 'ongoing', closed: 'closed', full: 'closed' };

function frontendNext(ev, regs, now) {
  const row = Object.assign({}, ev, { regs });
  const st = HWLayout.evState(row, { regs, now });
  /* coarse 只在"该改"的时候有值；为 null 说明本轮不需要改，用 phase 兜底成收敛目标 */
  return st.coarse || PHASE_TO_STATUS[st.phase] || ev.status;
}
function converge(ev, regs, now) {
  let cur = ev.status;
  for (let i = 0; i < 5; i++) {           /* 最多 5 轮，必然收敛 */
    const nxt = frontendNext(Object.assign({}, ev, { status: cur }), regs, now);
    if (nxt === cur) break;
    cur = nxt;
  }
  return cur;
}

/* ---------- 4. 场景矩阵 ---------- */
const H = 3600 * 1000;
const base = Date.now();
const iso = (ms) => new Date(base + ms).toISOString();
const pad = (n) => Array.from({ length: n }, (_, i) => ({ event_id: 1, user_id: i, status: 'approved' }));

const cases = [
  ['刚发布，报名中，一切正常',        { status: 'registration', reg_deadline: iso(48 * H), start_time: iso(72 * H), end_time: iso(80 * H), max_slots: 32 }, 0],
  ['※ 报名已截止但未开赛（原始事故）', { status: 'registration', reg_deadline: iso(-1 * H), start_time: iso(48 * H), end_time: iso(56 * H), max_slots: 32 }, 0],
  ['已截止且库里已是 closed（幂等）',  { status: 'closed', reg_deadline: iso(-2 * H), start_time: iso(48 * H), end_time: iso(56 * H), max_slots: 32 }, 0],
  ['closed 且已开赛',                 { status: 'closed', reg_deadline: iso(-3 * H), start_time: iso(-1 * H), end_time: iso(20 * H), max_slots: 32 }, 0],
  ['closed 且已结束',                 { status: 'closed', reg_deadline: iso(-72 * H), start_time: iso(-48 * H), end_time: iso(-2 * H), max_slots: 32 }, 0],
  ['名额已满但未截止',                { status: 'registration', reg_deadline: iso(48 * H), start_time: iso(72 * H), end_time: iso(80 * H), max_slots: 2 }, 2],
  ['名额刚放出（不再满）',            { status: 'closed', reg_deadline: iso(48 * H), start_time: iso(72 * H), end_time: iso(80 * H), max_slots: 2 }, 1],
  ['进行中且已超结束时间',            { status: 'ongoing', reg_deadline: iso(-48 * H), start_time: iso(-24 * H), end_time: iso(-1 * H), max_slots: 32 }, 0],
  ['草稿（人工终态，不许被改）',       { status: 'draft', reg_deadline: iso(-48 * H), start_time: iso(-24 * H), end_time: iso(-1 * H), max_slots: 32 }, 0],
  ['已取消（人工终态，不许被改）',     { status: 'cancelled', reg_deadline: iso(-48 * H), start_time: iso(-24 * H), end_time: iso(-1 * H), max_slots: 32 }, 0],
  ['没有截止时间，只有开赛时间',       { status: 'registration', start_time: iso(-1 * H), end_time: iso(20 * H), max_slots: 32 }, 0],
  ['啥时间都没填',                    { status: 'registration', max_slots: 32 }, 0]
];

console.log('\n[一致性] 服务端 sync_event_status 与前端 evState 必须给出同一个结果');
let mismatch = 0;
cases.forEach(([label, ev, taken]) => {
  const e = Object.assign({ id: 1 }, ev);
  const regs = pad(taken);
  const sv = serverNext(e, taken, base);
  const fe = converge(e, regs, base);
  if (sv !== fe) {
    mismatch++;
    console.log('  ✗ ' + label + '：服务端=' + sv + ' / 前端=' + fe);
  } else {
    console.log('  ✓ ' + label + ' → ' + sv);
  }
});
if (mismatch) fails += mismatch;

console.log('\n前后端口径：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
process.exit(fails ? 1 : 0);
