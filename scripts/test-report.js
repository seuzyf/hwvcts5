#!/usr/bin/env node
/**
 * 回归测试（npm run test:report）—— 每个用例都对应一次真实报障。
 *
 *  1. 「过了截止时间还显示报名中」：首页「近期活动」曾用静态字典，绕过 evState
 *  2. 「竞猜名单加载失败」：s6_player_ids 的 `group` 是保留字；聚合键用 p.id 而比赛行存的是游戏 ID
 *  3. 「商店门槛用报名人数没意义」：reg_min 已降级为 event_any，且新增"参与过指定活动"
 *  4. 「所有账号密码错误」：install.sql §1.2 曾把 PBKDF2 密文当明文再哈希一次
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

/* ---------- 1. 首页活动状态必须走 evState ---------- */
console.log('\n[1] 过了截止时间不能还写「报名中」');
const idx = read('index.html');
ok('首页不再有 EV_STATUS / EV_BADGE 字典', !/var EV_STATUS\s*=\s*\{/.test(idx) && !/var EV_BADGE\s*=\s*\{/.test(idx));

const layout = read('js/layout.js');
const dom = new JSDOM(`<!doctype html><html lang="zh-CN"><head><title>t</title></head><body></body></html>`,
  { url: 'https://e.test/', runScripts: 'dangerously' });
dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
dom.window.eval(layout);
const L = dom.window.HWLayout;
const H = 3600e3;
const now = Date.now();
const past = Object.assign({ id: 1, status: 'registration', title: 'x' }, {
  reg_deadline: new Date(now - 2 * H).toISOString(),
  start_time: new Date(now + 48 * H).toISOString()
});
const badge = L.evBadge(past, { now });
ok('evBadge 对已过截止给出「报名已截止」', /报名已截止/.test(badge), badge);
ok('不再输出「报名中」', !/报名中/.test(badge), badge);

/* ---------- 2. 竞猜名单 ---------- */
console.log('\n[2] 竞猜名单：字段名与聚合键');
const bet = read('betting.html');
ok('查询时 group 加了引号（保留字）', /select\('id, name, team, "group"'\)/.test(bet));
ok('聚合键改用游戏 ID（p.name）', /careerAgg\[key\]/.test(bet) || /careerAgg\[String\(p\.name/.test(bet));
ok('不再用 p.id 查聚合表', !/careerAgg\[p\.id\]/.test(bet) && !/careerRank\[p\.id\]/.test(bet));
ok('战绩读取失败不让名单整块消失', /statsFailed/.test(bet));
ok('花名册为空时说明原因，而不是「加载失败」', /还没有花名册数据/.test(bet));

/* ---------- 3. 商店门槛 ---------- */
console.log('\n[3] 商店：门槛表达"参与过"，不是"报名人数"');
const shop = read('shop.html');
ok('reg_min 已从可选类型里移除', !/reg_min:\s*\{ label/.test(shop));
ok('新增「参与过任意活动」', /event_any:\s*\{ label: '参与过任意活动'/.test(shop));
ok('新增「参与过指定活动」', /event_some:\s*\{ label: '参与过指定活动'/.test(shop));
ok('旧数据 reg_min 自动降级', /LEGACY_COND\s*=\s*\{\s*reg_min:\s*'event_any'/.test(shop));
ok('出战数按真实上场统计（不是报名）', /真的出现过这个人/.test(shop));

/* 判定行为：老商品的 reg_min 仍然能兑换（降级成 event_any） */
const shopScript = shop.slice(shop.lastIndexOf('<script>') + 8, shop.lastIndexOf('</script>'));
ok('判定函数对 reg_min 走参与过判定', /normCondType\(c\.type\)/.test(shopScript));

/* ---------- 4. 密码：不再二次哈希 ---------- */
console.log('\n[4] 密码：install.sql 不得二次哈希已有密文');
const sql = read('supabase/install.sql');
const migrate = sql.slice(sql.indexOf('-- 1.2 '), sql.indexOf('-- 1.2bis'));
ok('跳过 PBKDF2', /password !~\* '\^pbkdf2/.test(migrate));
ok('跳过 bcrypt / argon2 / scrypt', /\$2\[aby\]/.test(migrate) && /argon2/.test(migrate) && /scrypt/.test(migrate));
ok('SHA-256 判定带 i（大写也不当明文）', /!\~\* '\^\[a-f0-9\]\{64\}\$'/.test(migrate));
ok('不再只有一条 64 位十六进制判断', (migrate.match(/and password !~/g) || []).length >= 3, migrate);

const auth = read('js/auth.js');
ok('前端识别"需要重置"的哨兵值', /LOCKED_SENTINEL/.test(auth) && /must_reset/.test(auth));
ok('不再只回一句「密码错误」', /PASSWORD_RESET_REQUIRED/.test(auth));
ok('重置密码会清掉 must_reset', /must_reset = false/.test(auth));

/* ---------- 5. 种子账号仍在（00588771 / 123456） ---------- */
console.log('\n[5] 测试超管账号');
const seed = read('supabase/seed.sql');
ok('seed 里有 00588771', /'00588771'/.test(seed));
ok('口令是 123456 的 SHA-256', /00588771[\s\S]{0,120}sha256\(convert_to\('123456'/.test(seed));
ok('角色是 superadmin', /'00588771'[\s\S]{0,200}'superadmin'/.test(seed));

console.log('\n回归：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
process.exit(fails ? 1 : 0);
