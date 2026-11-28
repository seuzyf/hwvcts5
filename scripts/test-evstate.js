#!/usr/bin/env node
/**
 * 活动状态口径回归测试（npm run test:evstate）
 * 覆盖「过了报名截止还显示报名中」这一事故的全部边界：
 * 未到截止 / 即将截止 / 已过截止 / 名额满 / 已开赛 / 已结束 / 草稿 / 取消 / 删除 / 人工 ongoing。
 * 纯函数，无网络：用 jsdom 提供 window/localStorage，再取 HWLayout.evState。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body data-page="test"></body></html>', {
  url: 'https://example.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
window.eval(fs.readFileSync(path.join(ROOT, 'js/layout.js'), 'utf8'));
const L = window.HWLayout;

if (!L || typeof L.evState !== 'function') {
  console.error('FAIL: HWLayout.evState 未导出');
  process.exit(1);
}

const NOW = '2026-06-15T12:00:00+08:00';
const H = 3600 * 1000;
const iso = (ms) => new Date(new Date(NOW).getTime() + ms).toISOString();

let fail = 0, pass = 0;
function check(name, ev, expect, opts) {
  const st = L.evState(ev, Object.assign({ now: NOW }, opts || {}));
  const got = ['phase', 'joinable', 'coarse'].map((k) => st[k]).join('|');
  const want = [expect.phase, expect.joinable, expect.coarse === undefined ? null : expect.coarse].join('|');
  const ok = got === want && (!expect.label || st.label === expect.label);
  if (!ok) {
    fail++;
    console.error(`FAIL ${name}\n   want ${want}${expect.label ? ' label=' + expect.label : ''}\n   got  ${got} label=${st.label}`);
  } else pass++;
}

const base = (o) => Object.assign({ id: 1, status: 'registration', max_slots: null }, o);

check('截止前 3 天 · 报名中', base({ reg_deadline: iso(72 * H), start_time: iso(96 * H) }),
  { phase: 'open', joinable: true, coarse: null, label: '报名中' });

check('截止前 5 小时 · 即将截止', base({ reg_deadline: iso(5 * H), start_time: iso(30 * H) }),
  { phase: 'closing', joinable: true, coarse: null, label: '即将截止' });

check('※ 已过截止仍是 registration → 报名已截止（原事故）', base({ reg_deadline: iso(-1 * H), start_time: iso(48 * H) }),
  { phase: 'closed', joinable: false, coarse: 'closed', label: '报名已截止' });

/* 库里已经是 closed（报名截止但还没开赛）：显示不变，且不再反复回写 */
check('库内已是 closed → 仍显示报名已截止，不再回写', base({ status: 'closed', reg_deadline: iso(-1 * H), start_time: iso(48 * H) }),
  { phase: 'closed', joinable: false, coarse: null, label: '报名已截止' });

/* closed 但开赛时间到了 → 进行中，落库 ongoing */
check('closed 且已开赛 → 进行中', base({ status: 'closed', reg_deadline: iso(-2 * H), start_time: iso(-1 * H), end_time: iso(20 * H) }),
  { phase: 'live', joinable: false, coarse: 'ongoing', label: '进行中' });

/* closed 且结束时间也过了 → 已结束，一步补到 finished（不能卡在 closed） */
check('closed 且已结束 → 已结束 → finished', base({ status: 'closed', reg_deadline: iso(-48 * H), start_time: iso(-30 * H), end_time: iso(-1 * H) }),
  { phase: 'ended', joinable: false, coarse: 'finished', label: '已结束' });

check('已过截止 + 已开赛 → 进行中', base({ reg_deadline: iso(-48 * H), start_time: iso(-2 * H), end_time: iso(20 * H) }),
  { phase: 'live', joinable: false, coarse: 'ongoing' });

check('已过结束时间仍是 registration → 已结束', base({ reg_deadline: iso(-96 * H), start_time: iso(-48 * H), end_time: iso(-2 * H) }),
  { phase: 'ended', joinable: false, coarse: 'finished', label: '已结束' });

check('名额已满 → 名额已满（可候补）', base({ max_slots: 2, reg_deadline: iso(72 * H), start_time: iso(96 * H) }),
  { phase: 'full', joinable: true, coarse: null, label: '名额已满' },
  { regs: [{ event_id: 1, status: 'approved' }, { event_id: 1, status: 'pending' }] });

check('候补不计入名额', base({ max_slots: 2, reg_deadline: iso(72 * H), start_time: iso(96 * H) }),
  { phase: 'open', joinable: true, coarse: null },
  { regs: [{ event_id: 1, status: 'approved' }, { event_id: 1, status: 'cancelled' }, { event_id: 1, status: 'waitlist' }] });

check('没有截止时间的活动 · 报名中', base({ start_time: iso(96 * H) }),
  { phase: 'open', joinable: true, coarse: null });

check('人工 ongoing 优先于时间推断', base({ status: 'ongoing', reg_deadline: iso(72 * H) }),
  { phase: 'live', joinable: false, coarse: null, label: '进行中' });

check('人工 finished 一票否决', base({ status: 'finished', reg_deadline: iso(72 * H) }),
  { phase: 'ended', joinable: false, coarse: null });

check('草稿不可报名', base({ status: 'draft', reg_deadline: iso(72 * H) }),
  { phase: 'draft', joinable: false, coarse: null });

check('已取消不可报名', base({ status: 'cancelled' }),
  { phase: 'cancelled', joinable: false, coarse: null });

check('已删除不可报名', base({ status: 'deleted' }),
  { phase: 'deleted', joinable: false, coarse: null });

check('坏数据（时间全为空）也不抛错', { id: 9, status: 'registration' },
  { phase: 'open', joinable: true, coarse: null });

/* ── 人工把状态改回「报名中」──
   事故：活动结束后管理员手动选「报名中」并保存，状态看着被接受了，
   但时间事实（end_time 已过）立刻把它判成「已结束」，自动校验又写回
   finished —— 用户看到的就是"改了没用"。 */
check('※ 想恢复报名，但结束时间已过 → 仍是已结束（必须同时改时间）',
  base({ status: 'registration', reg_deadline: iso(-72 * H), start_time: iso(-48 * H), end_time: iso(-24 * H) }),
  { phase: 'ended', joinable: false, coarse: 'finished', label: '已结束' });

check('恢复报名：结束时间 + 报名截止都已顺延 → 才是报名中',
  base({ status: 'registration', reg_deadline: iso(24 * H), start_time: iso(48 * H), end_time: iso(72 * H) }),
  { phase: 'open', joinable: true, coarse: null, label: '报名中' });

/* 只改结束时间、报名截止还在过去 → 显示「报名已截止」，回写 closed，
   等于又被打回去。这条守住"两个时间都得顺延"的必要性。 */
check('恢复报名：只顺延结束时间、截止仍在过去 → 报名已截止',
  base({ status: 'registration', reg_deadline: iso(-72 * H), start_time: iso(48 * H), end_time: iso(72 * H) }),
  { phase: 'closed', joinable: false, coarse: 'closed', label: '报名已截止' });

/* 草稿/取消是人工终态，时间过了也不能被自动校验改掉 */
check('草稿不因时间流逝被改写', base({ status: 'draft', end_time: iso(-24 * H) }),
  { phase: 'draft', joinable: false, coarse: null, label: '草稿' });
check('已取消不因时间流逝被改写', base({ status: 'cancelled', end_time: iso(-24 * H) }),
  { phase: 'cancelled', joinable: false, coarse: null, label: '已取消' });

/* 徽章 HTML 与文案一致性 */
const badge = L.evBadge(base({ reg_deadline: iso(-1 * H), start_time: iso(48 * H) }), { now: NOW });
if (!/badge-quiet/.test(badge) || !/报名已截止/.test(badge)) {
  fail++;
  console.error('FAIL evBadge: ' + badge);
} else pass++;

/* 应回写数据库的粗粒度状态 */
const target = L.evStatusTarget(base({ start_time: iso(-2 * H), end_time: iso(20 * H) }), NOW);
if (target !== 'ongoing') { fail++; console.error('FAIL evStatusTarget: ' + target); } else pass++;

console.log(`\n活动状态口径：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
