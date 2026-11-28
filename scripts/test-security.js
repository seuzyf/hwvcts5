#!/usr/bin/env node
/**
 * 安全回归测试（npm run test:security）
 *
 * 这些断言全部来自真实事故：
 *   1) guard_event_registration 用 current_user 判断调用者，
 *      但函数是 security definer → current_user 恒为所有者 → 闸门失效。
 *   2) site_users 对 anon 可读可写 → publishable key 就能改任意人的密码/角色。
 *   3) promote_self_admin 无失败计数 → 可无限次猜全站管理口令。
 *   4) 三个 admin_code RPC 只信任传入的 p_operator_id。
 *
 * 纯文本断言 + 少量结构解析，不需要数据库连接。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/install.sql'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(ROOT, 'js/layout.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

/** 取出某个函数的**生效**定义体。
 *  install.sql 里同一函数可能出现多次（后面 create or replace 覆盖前面），
 *  所以必须取最后一处 —— 取第一处会读到已被覆盖的旧版，测试就成了假阴性。 */
function fnBody(name) {
  /* 收集所有 "create or replace function public.<name>(" 的出现位置，取最后一个 */
  const re = new RegExp('create or replace function public\\.' + name + '\\s*\\(', 'g');
  let m, last = -1;
  while ((m = re.exec(SQL)) !== null) last = m.index;
  if (last < 0) return '';
  const end = SQL.indexOf('$fn$;', last);
  return end < 0 ? '' : SQL.slice(last, end);
}

console.log('\n[安全] 报名闸门不能用 current_user 判断调用者');
{
  const body = fnBody('guard_event_registration');
  ok('闸门函数存在', body.length > 0);
  // 先整块剥掉块注释与 -- 行注释，再断言（注释里会解释这个坑，不能算进去）
  const code = body
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  ok('代码里不再使用 current_user', !/current_user/.test(code),
    'security definer 下 current_user 恒为所有者，白名单永远命中 → 闸门失效');
  ok('改为只看 jwt claims', /request\.jwt\.claims/.test(body));
  ok('直连会话放行', /request\.jwt\.claims[^)]*\)\s*is null then\s*\n\s*return new;/.test(body));
}

console.log('\n[安全] site_users 的敏感列不能被 anon 直接写');
{
  ok('收回了整表 update 权限', /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.site_users\s+from\s+anon/.test(SQL));
  const m = SQL.match(/grant\s+update\s*\(([^)]+)\)\s*on\s+public\.site_users\s+to\s+anon/i);
  ok('按列授予自助可改的字段', !!m, m ? '' : '没找到列级 grant');
  const cols = m ? m[1].split(',').map(s => s.trim()) : [];
  ['nickname', 'game_id', 'bio'].forEach(c =>
    ok('允许改 ' + c, cols.includes(c), cols.join(' | ')));
  ['password', 'role', 'balance'].forEach(c =>
    ok('禁止直写 ' + c, !cols.includes(c) && !cols.includes('banned'), cols.join(' | ')));
}

console.log('\n[安全] 密码写入只走受控 RPC');
{
  ok('存在 set_password_hash', fnBody('set_password_hash').length > 0);
  ok('RPC 拒绝非 pbkdf2 哈希', /not like 'pbkdf2\$%'/.test(fnBody('set_password_hash')));
  ok('auth.js 不再直写 password 列', !/\.update\(\{\s*password:/.test(AUTH),
    '直写 password 会绕过列级权限（若授权没生效）');
  ok('改密码走 RPC', /rpc\('set_password_hash'/.test(AUTH));
  ok('重置密码走 RPC', (AUTH.match(/set_password_hash/g) || []).length >= 2);
}

console.log('\n[安全] 角色变更走服务端校验');
{
  ok('site_users 的 role 不可直写', !/update\s*\(\s*\{\s*role:/.test(ADMIN));
  ok('改角色调 set_user_role', /rpc\('set_user_role'/.test(ADMIN));
  ok('set_user_role 校验操作者', /v_op_role not in \('admin', 'superadmin'\)/.test(fnBody('set_user_role')));
  ok('仅 superadmin 可授予 admin', /p_role = 'admin' and v_op_role <> 'superadmin'/.test(fnBody('set_user_role')));
}

console.log('\n[安全] 管理口令相关');
{
  ok('promote_self_admin 有失败计数', /scope = 'promote_admin'/.test(fnBody('promote_self_admin')));
  ok('失败 5 次锁定', /v_fails >= 5/.test(fnBody('promote_self_admin')));
  ok('成功/失败都记 login_attempts', (fnBody('promote_self_admin').match(/insert into public\.login_attempts/g) || []).length >= 2);
  ok('check_admin_password 不对 anon 开放',
    /revoke execute on function public\.check_admin_password\(text\) from anon/.test(SQL),
    '否则等于开放无限次猜口令接口');
  ok('generate_admin_code 要求操作者凭据', /p_operator_hash/.test(fnBody('generate_admin_code')));
  ok('凭据不符则拒绝', /v_stored <> p_operator_hash/.test(fnBody('generate_admin_code')));
  ok('revoke_admin_code 同样要求凭据', /p_operator_hash/.test(fnBody('revoke_admin_code')));
}

console.log('\n[安全] 高危表不对浏览器开放');
{
  ok('admin_access_codes 已收回', /revoke all on public\.admin_access_codes from anon/.test(SQL));
  ok('login_attempts 已收回', /revoke all on public\.login_attempts/.test(SQL));
  ok('audit_log 已收回', /revoke all on public\.audit_log/.test(SQL));
}

console.log('\n[安全] 前端权限判断不能只靠本地 session');
{
  ok('hasRole 从库读角色', /from\('site_users'\)\.select\('id, role'\)/.test(LAYOUT) ||
    /from\('site_users'\)\.select\('role'\)/.test(LAYOUT));
  ok('updateProfile 不允许改 role', /role 不允许自助修改/.test(AUTH));
}

console.log(`\n安全回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
