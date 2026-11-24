#!/usr/bin/env node
/**
 * 全站静态检查：所有页面内联 <script> + js/*.js 逐个 node --check，
 * 并校验 CSS 花括号/注释配对。零依赖，直接 npm run check。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html')).sort();
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).sort();

let failures = 0;
let checked = 0;

function checkCode(file, code, label) {
  if (!code.trim()) return;
  const tmp = path.join(os.tmpdir(), `hwvcts-check-${process.pid}-${checked}.js`);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    checked++;
  } catch (e) {
    failures++;
    console.error(`FAIL ${file} [${label}]\n${e.stderr.toString().slice(0, 1200)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

for (const f of jsFiles) {
  checkCode(`js/${f}`, fs.readFileSync(path.join(root, 'js', f), 'utf8'), 'module');
}

const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  let m, i = 0;
  while ((m = scriptRe.exec(html))) {
    checkCode(f, m[1], `inline#${i++}`);
  }
}

/* CSS 结构检查 */
for (const f of ['css/theme.css']) {
  const css = fs.readFileSync(path.join(root, f), 'utf8');
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  const cOpen = (css.match(/\/\*/g) || []).length;
  const cClose = (css.match(/\*\//g) || []).length;
  if (open !== close) { failures++; console.error(`FAIL ${f}: braces ${open}/${close}`); }
  if (cOpen !== cClose) { failures++; console.error(`FAIL ${f}: comments ${cOpen}/${cClose}`); }
}

if (failures) {
  console.error(`\n${failures} problem(s), ${checked} script(s) checked.`);
  process.exit(1);
}
console.log(`OK — ${checked} script(s) in ${htmlFiles.length} pages + ${jsFiles.length} js files, CSS balanced.`);
