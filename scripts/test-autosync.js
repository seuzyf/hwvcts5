#!/usr/bin/env node
/**
 * 活动状态「自动校验」端到端测试（npm run test:autosync）
 *
 * 这条链路以前是坏的，且坏得很安静：
 *   报名截止了但还没开赛时，evState 给的是 coarse=null，
 *   写回代码 `if (target && target !== status)` 直接跳过 →
 *   「报名已截止」这个事实永远进不了库。
 *
 * 现在要求：
 *   1. 前端不再直写 events（RLS 是 for all using(true)，直写等于谁都能改）
 *   2. 只调 sync_event_status() 这一个 security definer 的 RPC
 *   3. 10 分钟内不重复打数据库
 *   4. 服务端 RPC 报错 / 函数不存在 → 静默，不影响展示
 *   5. 窗口聚焦会触发，30 秒节拍不会触发（落库是低频动作）
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const layout = fs.readFileSync('js/layout.js', 'utf8');
let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

const stub = `
window.__calls = { rpc: [], updates: [] };
window.supabase = { createClient: function () { return {
  from: function (t) {
    var q = {};
    ['select','in','not','is','neq','order','limit','range','or','ilike','gte','lte','match'].forEach(function (m) { q[m] = function () { return q; }; });
    q.eq = function () { return q; };
    q.insert = q.upsert = q.delete = function () { return q; };
    q.update = function () { window.__calls.updates.push(t); return q; };
    q.maybeSingle = q.single = function () { return Promise.resolve({ data: null, error: null }); };
    q.then = function (r) { return Promise.resolve({ data: [], error: null }).then(r); };
    return q;
  },
  rpc: function (name) {
    window.__calls.rpc.push(name);
    return { then: function (r) { return Promise.resolve({ data: 2, error: window.__rpcError || null }).then(r); } };
  },
  auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } }
}; } };`;

const dom = new JSDOM(`<!doctype html><html lang="zh-CN"><head><title>t</title></head><body></body></html>`, {
  url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.eval(stub);
  }
});
const w = dom.window;
const d = w.document;
w.eval(layout);
const L = w.HWLayout;

setTimeout(() => {
  const calls = w.__calls;

  console.log('\n[落库方式] 只走服务端 RPC');
  ok('调用了 sync_event_status()', calls.rpc.includes('sync_event_status'), JSON.stringify(calls.rpc));
  ok('没有前端直写 events', calls.updates.filter((t) => t === 'events').length === 0, JSON.stringify(calls.updates));

  console.log('\n[节流] 10 分钟内不重复打数据库');
  const before = calls.rpc.length;
  return L.syncEventStatuses().then(() => {
    ok('第二次调用被节流', calls.rpc.length === before, 'rpc 次数 ' + before + ' → ' + calls.rpc.length);
    return L.syncEventStatuses(true); /* force：绕过节流 */
  }).then(() => {
    ok('force 时确实会再调一次', calls.rpc.length === before + 1);

    console.log('\n[容错] RPC 报错不影响展示');
    w.__rpcError = { message: 'function does not exist', code: 'PGRST202' };
    return L.syncEventStatuses(true);
  }).then((n) => {
    ok('RPC 报错时返回 0，不抛错', n === 0, String(n));
    w.__rpcError = null;

    console.log('\n[触发时机] 聚焦触发落库，30 秒节拍不落库');
    /* clock 总线的 sync 通道 */
    let tickCount = 0, syncCount = 0;
    L.clock({ tick: () => { tickCount++; }, sync: () => { syncCount++; } });
    return new Promise((r) => setTimeout(r, 60)).then(() => {
      ok('注册时对齐一次（sync）', syncCount === 1, 'sync=' + syncCount);
      w.dispatchEvent(new w.Event('focus'));
      return new Promise((r) => setTimeout(r, 30));
    }).then(() => {
      ok('窗口聚焦触发 sync', syncCount === 2, 'sync=' + syncCount);
      ok('对局节拍只走 tick 通道', tickCount === 0, 'tick=' + tickCount);

      console.log('\n活动状态自动校验：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
      process.exit(fails ? 1 : 0);
    });
  });
}, 200);
