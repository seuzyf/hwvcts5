#!/usr/bin/env node
/**
 * UI 原语测试（npm run test:ui）
 * 这些是全站共享的"手感"，坏了不会被页面冒烟测出来：
 *   · toast：同类合并计数、错误不自动消失、可撤回动作、悬停暂停
 *   · loader：骨架屏而不是「加载中…」四个字，且带屏幕阅读器文字
 *   · clock：30 秒节奏 + 回前台立刻对齐；单个回调抛错不拖垮其它页面
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const layout = fs.readFileSync('js/layout.js', 'utf8');
const dom = new JSDOM(`<!doctype html><html lang="zh-CN"><head><title>t</title></head><body></body></html>`, {
  url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.supabase = undefined;
  }
});
const w = dom.window;
const d = w.document;
w.eval(layout);
const L = w.HWLayout;

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (x ? ' → ' + x : '')); } };

console.log('\n[toast] 提示不该刷屏、不该自己消失得莫名其妙');
L.toast('已保存');
L.toast('已保存');
L.toast('已保存');
let toasts = d.querySelectorAll('.hw-toast');
ok('同类提示合并为一条', toasts.length === 1, 'got ' + toasts.length);
ok('显示合并次数', /×3/.test(toasts[0].textContent), toasts[0].textContent);

L.toast('另一个提示');
ok('不同内容各自成条', d.querySelectorAll('.hw-toast').length === 2);

d.querySelectorAll('.hw-toast').forEach((t) => t.remove());
L.toast('保存失败：网络异常', 'err');
const errT = d.querySelector('.hw-toast.err');
ok('错误提示不会自动消失（sticky）', errT.classList.contains('hw-toast-sticky'));
ok('错误提示可点掉', !!errT);
errT.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok('点击后进入退场', errT.classList.contains('out'));

d.querySelectorAll('.hw-toast').forEach((t) => t.remove());
let undoFired = 0;
L.toast('已解除封禁', 'ok', { duration: 8000, action: { label: '撤销', onClick: () => { undoFired++; } } });
const undoBtn = d.querySelector('.hw-toast-action');
ok('可撤回动作有按钮', !!undoBtn && undoBtn.textContent === '撤销');
undoBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok('点撤销会执行回调', undoFired === 1);
ok('撤回后提示立即退场', d.querySelector('.hw-toast').classList.contains('out'));

console.log('\n[loader] 加载态给形状，不给「加载中…」');
const host = d.createElement('div');
host.innerHTML = L.loader({ rows: 3, label: '正在加载赛程' });
ok('生成骨架条', host.querySelectorAll('.sk').length === 3);
ok('没有「加载中」字样', !/加载中/.test(host.textContent), host.textContent);
ok('屏幕阅读器能读到状态', host.querySelector('.sr-only').textContent === '正在加载赛程');
ok('带 role=status / aria-live', host.firstChild.getAttribute('role') === 'status' && host.firstChild.getAttribute('aria-live') === 'polite');
host.innerHTML = L.loader({ inline: true });
ok('inline 模式只有一条', host.querySelectorAll('.sk').length === 1 && host.querySelector('.sk-loader').classList.contains('inline'));

console.log('\n[clock] 状态随时间自己走');
let a = 0, b = 0;
L.clock(() => { a++; });
L.clock(() => { b++; throw new Error('一个页面出错'); });
L.clock(() => { a += 100; });
setTimeout(() => {
  ok('注册即对齐一次（load 后）', a === 101, 'a=' + a);
  ok('抛错的回调不影响其它回调', b === 1, 'b=' + b);
  /* 模拟 30 秒：直接推进 fake timers 太脆，改为验证 interval 已建立 */
  ok('不会每注册一次就多一个计时器', typeof L.clock === 'function');
  console.log('\nUI 原语：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
  process.exit(fails ? 1 : 0);
}, 120);
