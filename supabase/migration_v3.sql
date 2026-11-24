-- =====================================================================
-- HWVCTS · migration_v3.sql（Phase 14 / 方案 V3 阶段 0–8 的数据库增量）
--
-- 只增不改、幂等。执行顺序：
--   schema.sql → bootstrap.sql → hardening.sql → 本文件 → seed.sql
-- 未执行本文件的环境下，前端新功能（荣誉/别名/结果状态/软删除）会优雅降级，不白屏。
-- =====================================================================

-- ----------------------------------------------------------------------
-- 1. 活动软删除（管理员可删活动；组织者仅删自己的草稿；超管可恢复/彻底清除）
-- ----------------------------------------------------------------------
alter table public.events add column if not exists deleted_at timestamptz;
alter table public.events add column if not exists deleted_by bigint;
alter table public.events add column if not exists delete_reason text;

-- ----------------------------------------------------------------------
-- 2. 选手不可变身份 + 游戏 ID 别名
--    player_key 是选手数据的归一键；游戏 ID 可改，旧值进 aliases 做跳转解析。
-- ----------------------------------------------------------------------
create table if not exists public.player_identities (
    player_key    uuid primary key default gen_random_uuid(),
    user_id       bigint unique,
    real_name     text not null default '',
    current_game_id text not null default '',
    created_at    timestamptz not null default now()
);
create index if not exists idx_identity_game on public.player_identities (lower(current_game_id));
create index if not exists idx_identity_name on public.player_identities (real_name);

create table if not exists public.player_id_aliases (
    id          bigint generated always as identity primary key,
    game_id     text not null,
    season      text,
    player_key  uuid not null references public.player_identities(player_key) on delete cascade,
    is_current  boolean not null default false,
    created_at  timestamptz not null default now()
);
create unique index if not exists uq_alias_game_season
    on public.player_id_aliases (lower(game_id), coalesce(season, ''));

-- ----------------------------------------------------------------------
-- 3. 荣誉（结构化，替代 *_player_ids.honor 文本拼接）
-- ----------------------------------------------------------------------
create table if not exists public.player_honors (
    id           bigint generated always as identity primary key,
    player_key   uuid references public.player_identities(player_key) on delete set null,
    user_id      bigint,
    player_name  text not null default '',
    game_id      text not null default '',
    event_id     bigint references public.events(id) on delete set null,
    title        text not null,
    description  text not null default '',
    awarded_at   date not null default current_date,
    awarded_by   bigint,
    created_at   timestamptz not null default now()
);
create index if not exists idx_honors_player on public.player_honors (player_name, game_id);
create index if not exists idx_honors_event on public.player_honors (event_id);

-- ----------------------------------------------------------------------
-- 4. 比赛结果状态机（挂在赛程行上）
--    unrecorded → pending → confirmed → locked（旧数据无值时前端视为 confirmed）
-- ----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['s6_match_schedule', 's5_match_schedule'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists result_status text', t);
      execute format('alter table public.%I add column if not exists submitted_by bigint', t);
      execute format('alter table public.%I add column if not exists confirmed_by bigint', t);
      execute format('alter table public.%I add column if not exists confirmed_at timestamptz', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------
-- 5. 审计日志（本阶段建表 + 写入点，查询页下轮）
-- ----------------------------------------------------------------------
create table if not exists public.audit_log (
    id          bigint generated always as identity primary key,
    actor_id    bigint,
    actor_role  text,
    action      text not null,
    target_type text,
    target_id   text,
    detail      jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_log (created_at desc);
create index if not exists idx_audit_actor on public.audit_log (actor_id, created_at desc);

-- ----------------------------------------------------------------------
-- 6. RLS 与授权（与站点既有宽松模型一致，接入 Supabase Auth 后再收紧）
-- ----------------------------------------------------------------------
alter table public.player_identities enable row level security;
alter table public.player_id_aliases enable row level security;
alter table public.player_honors enable row level security;
alter table public.audit_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['player_identities', 'player_id_aliases', 'player_honors', 'audit_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_all') then
      execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_all', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.player_identities,
    public.player_id_aliases, public.player_honors, public.audit_log
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- =====================================================================
-- 验收（只读，供手动核对）：
--   select column_name from information_schema.columns
--    where table_name = 'events' and column_name like 'delet%';
--   select count(*) from public.player_honors;
-- =====================================================================
