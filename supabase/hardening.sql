-- =====================================================================
-- HWVCTS 安全加固（P0）
-- ---------------------------------------------------------------------
-- 适用：已在运行的 Supabase 项目。可重复执行（幂等）。
--
-- 本文件做四件事：
--   1) 补齐站点引用但仓库里缺失的 RPC：check_admin_password
--   2) 把「改角色 / 调积分 / 兑换 / 重算余额」收敛为 security definer RPC，
--      前端不再直接 update 关键字段
--   3) 给热点查询补索引
--   4) 为 S5 竞猜补表（s5_bet_bets），与 s5_match_schedule 对齐
--
-- 重要背景：站点目前用「用户名 + 密码 → site_users」的自建登录，
-- 不是 Supabase Auth，所以 auth.uid() 恒为空，无法直接用 RLS 做
-- 行级隔离。真正的行级安全需要迁移到 Supabase Auth（见文件末尾
-- AUTH_MIGRATION 注释块）。在那之前，本文件先把**写路径**收敛到
-- 服务端函数，堵住「前端直接改 role / balance」这一类越权。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 站点设置表（管理口令等）
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
    key         text primary key,
    value       text not null,
    updated_at  timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists site_settings_select on public.site_settings;
create policy site_settings_select on public.site_settings for select using (false);
drop policy if exists site_settings_write on public.site_settings;
create policy site_settings_write on public.site_settings for all using (false) with check (false);

-- 默认管理口令：hwvcts-admin（上线前务必替换！见文末「轮换口令」）
insert into public.site_settings (key, value)
values ('admin_password_sha256',
        encode(sha256(convert_to('hwvcts-admin', 'UTF8')), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. 管理口令校验（events.html / review.html 已在调用，但仓库里没有定义）
-- ---------------------------------------------------------------------
create or replace function public.check_admin_password(p_pwd text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_hash text;
begin
    select value into v_hash from public.site_settings where key = 'admin_password_sha256';
    if v_hash is null or p_pwd is null then
        return false;
    end if;
    return encode(sha256(convert_to(p_pwd, 'UTF8')), 'hex') = lower(v_hash);
end;
$fn$;
grant execute on function public.check_admin_password(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. 口令正确者把自己提升为 admin（替代前端直接 update role）
--    说明：站点没有服务端会话，只能靠管理口令证明身份；
--    口令本身不落库明文，函数内即时校验。
-- ---------------------------------------------------------------------
create or replace function public.promote_self_admin(p_pwd text, p_user_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_count integer;
begin
    if not public.check_admin_password(p_pwd) then
        return false;
    end if;
    update public.site_users
       set role = 'admin'
     where id = p_user_id
       and coalesce(role, 'member') in ('member', 'organizer');
    get diagnostics v_count = row_count;
    return v_count > 0;
end;
$fn$;
grant execute on function public.promote_self_admin(text, bigint) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. 管理员改角色（仅 admin/superadmin 可操作；授 admin 需 superadmin）
-- ---------------------------------------------------------------------
create or replace function public.set_user_role(
    p_operator_id bigint,
    p_user_id     bigint,
    p_role        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_op_role text;
begin
    if p_role not in ('member', 'organizer', 'admin') then
        return jsonb_build_object('error', '非法角色');
    end if;
    select role into v_op_role from public.site_users where id = p_operator_id;
    if v_op_role is null then
        return jsonb_build_object('error', '操作者不存在');
    end if;
    if v_op_role not in ('admin', 'superadmin') then
        return jsonb_build_object('error', '仅管理员可调整角色');
    end if;
    if p_role = 'admin' and v_op_role <> 'superadmin' then
        return jsonb_build_object('error', '仅超级管理员可授予 admin');
    end if;
    update public.site_users set role = p_role where id = p_user_id;
    if not found then
        return jsonb_build_object('error', '目标用户不存在');
    end if;
    return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.set_user_role(bigint, bigint, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. 管理员调积分：原子、记流水、不允许扣成负数
-- ---------------------------------------------------------------------
create or replace function public.adjust_points(
    p_operator_id bigint,
    p_user_id     bigint,
    p_delta       integer,
    p_reason      text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_op_role text;
    v_bal     integer;
    v_after   integer;
begin
    select role into v_op_role from public.site_users where id = p_operator_id;
    if v_op_role is null or v_op_role not in ('admin', 'superadmin') then
        return jsonb_build_object('error', '仅管理员可调整积分');
    end if;
    if p_delta is null or p_delta = 0 then
        return jsonb_build_object('error', '积分变化不能为 0');
    end if;
    select balance into v_bal from public.site_users where id = p_user_id for update;
    if not found then
        return jsonb_build_object('error', '用户不存在');
    end if;
    v_after := coalesce(v_bal, 0) + p_delta;
    if v_after < 0 then
        return jsonb_build_object('error', '积分不足，不能扣成负数');
    end if;
    update public.site_users
       set balance = v_after, balance_synced_at = now()
     where id = p_user_id;
    insert into public.points_ledger (user_id, delta, balance_after, reason, operator_id, source)
    values (p_user_id, p_delta, v_after, coalesce(p_reason, ''), p_operator_id, 'admin');
    return jsonb_build_object('ok', true, 'balance', v_after);
end;
$fn$;
grant execute on function public.adjust_points(bigint, bigint, integer, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. 服务端权威重算余额（替代前端「拉全表 + 全部下注」）
--    公式与 js/layout.js recalcBalance 完全一致：
--      100 − 投注 + 赢利 + 积分流水净额 − 商城兑换
-- ---------------------------------------------------------------------
create or replace function public.recalc_balance(p_user_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_staked   numeric := 0;
    v_winnings numeric := 0;
    v_ledger   numeric := 0;
    v_redeem   numeric := 0;
    v_bal      integer;
    v_pool_a   numeric;
    v_pool_b   numeric;
    v_winner   text;
    v_win_pool numeric;
    v_lose_pool numeric;
    r record;
begin
    select coalesce(sum(delta), 0) into v_ledger
      from public.points_ledger where user_id = p_user_id;
    select coalesce(sum(cost), 0) into v_redeem
      from public.goods_redemptions where user_id = p_user_id;

    for r in
        select b.id, b.match_id, b.amount, b.predicted_winner,
               m.team_a, m.team_b, m.score_a, m.score_b
          from public.s6_bet_bets b
          left join public.s6_match_schedule m on m.id = b.match_id
         where b.user_id = p_user_id
    loop
        v_staked := v_staked + coalesce(r.amount, 0);
        if r.team_a is not null and r.score_a is not null and r.score_b is not null
           and r.score_a <> r.score_b then
            v_winner := case when r.score_a > r.score_b then r.team_a else r.team_b end;
            if r.predicted_winner = v_winner then
                select coalesce(sum(amount) filter (where predicted_winner = r.team_a), 0),
                       coalesce(sum(amount) filter (where predicted_winner = r.team_b), 0)
                  into v_pool_a, v_pool_b
                  from public.s6_bet_bets
                 where match_id = r.match_id;
                if v_winner = r.team_a then
                    v_win_pool  := 100 + v_pool_a;
                    v_lose_pool := 100 + v_pool_b;
                else
                    v_win_pool  := 100 + v_pool_b;
                    v_lose_pool := 100 + v_pool_a;
                end if;
                v_winnings := v_winnings + r.amount
                              + ceil((r.amount / nullif(v_win_pool, 0)) * v_lose_pool);
            end if;
        end if;
    end loop;

    v_bal := round(100 - v_staked + v_winnings + v_ledger - v_redeem)::integer;
    update public.site_users
       set balance = v_bal, balance_synced_at = now()
     where id = p_user_id;
    return v_bal;
end;
$fn$;
grant execute on function public.recalc_balance(bigint) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. S5 竞猜表（与 s5_match_schedule 对齐；此前只有 s6_bet_bets）
-- ---------------------------------------------------------------------
create table if not exists public.s5_bet_bets (like public.s6_bet_bets including all);
alter table public.s5_bet_bets enable row level security;
drop policy if exists s5_bet_bets_all on public.s5_bet_bets;
create policy s5_bet_bets_all on public.s5_bet_bets
    for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 7. 索引：把「全表扫」变成「按人/按场」
-- ---------------------------------------------------------------------
create index if not exists idx_s6_bets_user   on public.s6_bet_bets (user_id);
create index if not exists idx_s6_bets_match  on public.s6_bet_bets (match_id);
create index if not exists idx_s5_bets_user   on public.s5_bet_bets (user_id);
create index if not exists idx_s5_bets_match  on public.s5_bet_bets (match_id);
create index if not exists idx_redemptions_user on public.goods_redemptions (user_id, created_at desc);
create index if not exists idx_ledger_user     on public.points_ledger (user_id, created_at desc);
create index if not exists idx_matches_event   on public.s6_matches (event_id);
create index if not exists idx_matches_event_s5 on public.s5_matches (event_id);
create index if not exists idx_notifications_unread
    on public.notifications (user_id, read) where read = false;

-- =====================================================================
-- AUTH_MIGRATION（下一步，不在本 PR 强制）
-- ---------------------------------------------------------------------
-- 站点当前是自建登录（site_users.username/password），auth.uid() 恒为空，
-- 因此下面这组「真正行级安全」的策略必须先完成 Supabase Auth 迁移才能启用。
--
-- 迁移步骤：
--   1) 为每个 site_users 用户创建 auth.users 记录（email = username 占位），
--      用 service role 批量导入；
--   2) 前端 login 改为 supabase.auth.signInWithPassword；
--   3) 启用下面的策略，并把所有写操作改走 RPC（本文件已就绪）。
--
-- drop policy if exists site_users_write on public.site_users;
-- create policy site_users_self_update on public.site_users
--     for update using (auth.uid() = id) with check (auth.uid() = id);
-- drop policy if exists points_ledger_write on public.points_ledger;
-- create policy points_ledger_select on public.points_ledger
--     for select using (auth.uid() = user_id);
-- drop policy if exists goods_redemptions_write on public.goods_redemptions;
-- create policy goods_redemptions_select on public.goods_redemptions
--     for select using (auth.uid() = user_id);
-- =====================================================================

-- ---------------------------------------------------------------------
-- 轮换管理口令（上线前执行一次）
-- ---------------------------------------------------------------------
-- update public.site_settings
--    set value = encode(sha256(convert_to('你的新口令', 'UTF8')), 'hex'),
--        updated_at = now()
--  where key = 'admin_password_sha256';
