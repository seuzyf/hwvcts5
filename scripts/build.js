#!/usr/bin/env node
/**
 * 静态站点构建（npm run build）
 *
 * 这个项目没有打包步骤：html/css/js 直接就是产物。
 * 但 Netlify 需要两样东西才肯真正发布：
 *   1) 一个能跑通的 build 命令
 *   2) 一个明确存在的 publish 目录
 * 以前两个都没有 → 每次部署都被判定为 "Skipped"，
 * 线上一直停在最早那次发布上（改了代码也看不到任何变化）。
 *
 * 所以这里只做一件事：把要发布的文件原样复制到 dist/。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

/* 要发布的顶层条目：所有页面 + 静态资源目录 */
const INCLUDE_DIRS = ['css', 'js'];
const INCLUDE_FILES = ['404.html'];
/* 根目录下所有 .html 都算页面（新增页面不用改这里） */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      copy(path.join(from, name), path.join(to, name));
    }
  } else {
    fs.copyFileSync(from, to);
    files++;
  }
}

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
for (const p of pages) copy(path.join(ROOT, p), path.join(OUT, p));
for (const d of INCLUDE_DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) copy(src, path.join(OUT, d));
}
for (const f of INCLUDE_FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) copy(src, path.join(OUT, f));
}

/* 页面清单写出来，便于部署后自查"到底发了哪些页面" */
fs.writeFileSync(
  path.join(OUT, '_build.json'),
  JSON.stringify({ pages: pages.sort(), files, builtAt: new Date().toISOString() }, null, 2) + '\n'
);

console.log(`构建完成：${pages.length} 个页面、${files} 个文件 → dist/`);
