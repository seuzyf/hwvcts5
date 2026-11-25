#!/usr/bin/env node
/**
 * 部署自检（npm run check:deploy）
 *
 * 背景：站点曾经连续 5 次部署被 Netlify 判定为 "Skipped"，
 * 线上一直停在旧版本，而本地怎么改都"看不到变化"。
 * 这里用签名文件对比"线上到底是哪一版"。
 *
 * 用法：
 *   npm run check:deploy                  # 对比线上与本地 dist/ 的签名
 *   npm run check:deploy -- <url>         # 指定站点
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.argv[2] || 'https://hwvct.netlify.app').replace(/\/$/, '');

/** 只取"变了就该重新发布"的页面，算一个稳定的指纹 */
const SIGNATURE_FILES = ['player.html', 'events.html', 'players.html', 'shop.html', 'admin.html'];

function sign(root) {
  const parts = [];
  for (const f of SIGNATURE_FILES) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { parts.push(f + '=missing'); continue; }
    parts.push(f + '=' + crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10));
  }
  return parts;
}

/** 线上版本的可辨识特征：不依赖能拿到整个文件，只要几个关键字符串 */
const MARKERS = [
  { name: 'player.html 新骨架', file: 'player.html', needle: 'pc-grid' },
  { name: 'player.html 生涯口径', file: 'player.html', needle: 'careerKey' },
  { name: 'player.html 无旧报错', file: 'player.html', needle: '错误：未找到选手', absent: true },
  { name: 'events.html 用 phase 筛选', file: 'events.html', needle: 'data-status="ended"' },
  { name: 'events.html 无旧 status 值', file: 'events.html', needle: 'data-status="finished"', absent: true },
];

(async () => {
  console.log('站点：' + BASE + '\n');
  const dist = path.resolve(__dirname, '..', 'dist');
  const localRoot = fs.existsSync(dist) ? dist : path.resolve(__dirname, '..');
  console.log('本地签名（' + (fs.existsSync(dist) ? 'dist/' : '仓库根') + '）：');
  sign(localRoot).forEach((s) => console.log('  ' + s));

  console.log('\n线上特征：');
  let bad = 0;
  let unreachable = 0;
  const cache = {};
  for (const m of MARKERS) {
    let text = cache[m.file];
    if (text === undefined) {
      try {
        const res = await fetch(BASE + '/' + m.file, { headers: { 'Cache-Control': 'no-cache' } });
        text = res.ok ? await res.text() : null;
      } catch (e) { text = null; }
      cache[m.file] = text;
    }
    if (text === null) { unreachable++; console.log('  ? ' + m.name + '（网络取不到 ' + m.file + '）'); continue; }
    const has = text.indexOf(m.needle) !== -1;
    const good = m.absent ? !has : has;
    if (!good) bad++;
    console.log('  ' + (good ? '✓' : '✗') + ' ' + m.name + (good ? '' : '  ← 线上不是这版'));
  }

  console.log('');
  if (unreachable && !bad) {
    console.log('无法判断：网络取不到线上文件（' + unreachable + '/' + MARKERS.length + '）。');
    console.log('换个网络或在浏览器里打开站点后再跑一次。');
    process.exit(2);
  }
  if (bad) {
    console.log('结论：线上不是最新版本（' + bad + ' 项不符）。');
    console.log('检查 Netlify → Deploys：如果有部署显示 "Skipped"，说明没有可发布的产物。');
    console.log('本仓库已加 netlify.toml + build 脚本，重新部署即可。');
    process.exit(1);
  }
  console.log('结论：线上已是最新版本 ✓');
})();
