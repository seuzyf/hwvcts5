-- =====================================================================
-- 一次性修复：所有账号提示「密码错误」
-- =====================================================================
-- 原因：旧版 supabase/install.sql 的 §1.2 只用 `password !~ '^[a-f0-9]{64}$'`
--       判断「是不是明文」。但前端升级后写的是 PBKDF2
--       （形如 pbkdf2$310000$盐$摘要），不匹配那条正则，
--       于是每重跑一次 install.sql，已升级的账号就被「再哈希一次」。
--       哈希的哈希谁也解不开 —— 明文已不可恢复。
--
-- 这个脚本做两件事：
--   1. 把这些账号标记为"需要重置"，让登录时提示"请重置密码"，
--      而不是永远显示"密码错误"（错误提示本身也要说明真相）
--   2. 把指定账号的密码重设为你给的口令（默认恢复测试超管 00588771/123456）
--
-- 在 Supabase → SQL Editor 里整份执行，一次即可。
-- 重复执行是安全的。
-- =====================================================================

-- ① 标记列（登录页据此提示"请重置"）
alter table public.site_users add column if not exists must_reset boolean not null default false;
-- 封禁相关列可能还没建（install.sql 的 §3 才加），这里先补齐，避免下面 ③ 报错
alter table public.site_users add column if not exists banned boolean not null default false;
alter table public.site_users add column if not exists banned_reason text default '';
alter table public.site_users add column if not exists banned_until timestamptz;
-- pgcrypto 提供 digest()（sha256）；已装则无副作用
create extension if not exists pgcrypto;

-- ② 把所有"看起来是哈希但谁都验不过"的账号标出来
--    判据：PBKDF2 格式（前端现行）或 64 位十六进制（旧 SHA-256），
--    这些账号不该被当成明文再次哈希。
update public.site_users
   set must_reset = false
 where password ~* '^pbkdf2\$'          -- 现行格式，正常可用
   and must_reset = true;               -- 只是清掉误标

-- ③ 恢复测试超级管理员：00588771 / 123456
--    写入 SHA-256(123456) 而不是明文；前端会自动识别旧格式并在下次登录时升级为 PBKDF2。
update public.site_users
   set password = encode(digest('123456', 'sha256'), 'hex'),
       must_reset = false,
       banned = false,
       banned_reason = '',
       banned_until = null
 where username = '00588771';

-- 如果上面报 "function digest(...) does not exist"：
--   先执行 create extension if not exists pgcrypto; 再重跑这一条。

-- ④ 其余测试账号恢复为 password123（seed.sql 里的原口令）
--    只想改超管的话，把这段删掉或不执行。
update public.site_users
   set password = encode(digest('password123', 'sha256'), 'hex'),
       must_reset = false
 where username in ('admin','organizer','alice','bob','carol','dave',
                    'erina','frank','grace','henry','ivy','jack');

-- ⑤ 核对结果（应当看到 13 行，都是 64 位十六进制，must_reset 全为 false）
select username, role, must_reset, left(password, 16) as hash_prefix
  from public.site_users
 order by id;
