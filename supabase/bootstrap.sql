-- ═══════════════════════════════════════════════════════════════════════
-- HWVCTS 新库引导 · 第 ② 步（配套 supabase/schema.sql）
--
-- 使用顺序（Supabase Dashboard → SQL Editor，整段粘贴运行）：
--   ① 先运行 supabase/schema.sql   —— 建 site_users / events / event_registrations + 示例活动
--   ② 再运行本文件                 —— 建全部历史业务表 + 权限 + 测试数据
--
-- 幂等：可重复运行（IF NOT EXISTS / where not exists / on conflict do nothing）。
-- 每段独立异常保护：某段失败只输出 NOTICE「…跳过」并继续，不会中断后续段。
-- 运行完请检查输出里有没有「跳过」字样的 NOTICE。
--═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. 赛程表（赛程 Tab / 赛程中心 / 竞猜共用）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_match_schedule (
    id           bigint generated always as identity primary key,
    "group"      text not null,
    match_id     text not null,
    team_a       text,
    team_b       text,
    score_a      integer,
    score_b      integer,
    match_date   timestamptz,
    link         text,
    commentators text,
    created_at   timestamptz not null default now(),
    unique ("group", match_id)
  );
  create table if not exists public.s5_match_schedule (like public.s6_match_schedule including all);
exception when others then raise notice '① s6/s5_match_schedule 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. 赛果表（赛果 Tab / 比赛中心 / 选手详情共用）
--    每队 1~5 号位：id（选手 ID）+ ch（角色）+ data（ACS/K/D/A 串）
--    score 为文本，形如 '13:9'（管理页表单 type=text）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_matches (
    id        bigint generated always as identity primary key,
    "group"   text,
    stage     text,
    match_date timestamptz,
    map       text,
    score     text,
    team_a    text,
    team_b    text,
    team_a_player1_id bigint, team_a_player2_id bigint, team_a_player3_id bigint,
    team_a_player4_id bigint, team_a_player5_id bigint,
    team_b_player1_id bigint, team_b_player2_id bigint, team_b_player3_id bigint,
    team_b_player4_id bigint, team_b_player5_id bigint,
    team_a_player1_ch text, team_a_player2_ch text, team_a_player3_ch text,
    team_a_player4_ch text, team_a_player5_ch text,
    team_b_player1_ch text, team_b_player2_ch text, team_b_player3_ch text,
    team_b_player4_ch text, team_b_player5_ch text,
    team_a_player1_data text, team_a_player2_data text, team_a_player3_data text,
    team_a_player4_data text, team_a_player5_data text,
    team_b_player1_data text, team_b_player2_data text, team_b_player3_data text,
    team_b_player4_data text, team_b_player5_data text,
    created_at timestamptz not null default now()
  );
  create table if not exists public.s5_matches (like public.s6_matches including all);
exception when others then raise notice '② s6/s5_matches 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. 选手花名册（管理页成员 Tab / 比赛中心 / 数据汇总 / 竞猜 / 选手页）
--    pwd = 选手页个人密码；name 全表唯一（管理页按 name upsert）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_player_ids (
    id    bigint generated always as identity primary key,
    name  text not null unique,
    team  text,
    "group" text,
    image text,
    honor text,
    pwd   text
  );
  create table if not exists public.s5_player_ids (like public.s6_player_ids including all);
exception when others then raise notice '③ s6/s5_player_ids 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. 选手权限/统计（活动栏「分队」标签的队长判定读 s6_player_stats）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_player_stats (
    id          bigint generated always as identity primary key,
    player_name text not null,
    game_id     text,
    team        text,
    "group"     text,
    pre_group   text,
    role        text
  );
  create table if not exists public.s5_player_stats (like public.s6_player_stats including all);
exception when others then raise notice '④ s6/s5_player_stats 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 5. 分队页旧表（draft.html 使用无前缀的 player_stats / player_ids）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.player_stats (
    id            bigint generated always as identity primary key,
    player_name   text not null,
    game_id       text,
    team          text,
    team_note     text,
    "group"       text,
    pre_group     text,
    role          text,
    huawei_score  numeric
  );
  create table if not exists public.player_ids (
    id      bigint generated always as identity primary key,
    name    text not null unique,
    team    text,
    "group" text,
    image   text,
    honor   text,
    pwd     text
  );
exception when others then raise notice '⑤ player_stats/player_ids 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 6. 选手页评论（player.html）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_comments (
    id         bigint generated always as identity primary key,
    player_key text not null,            -- 形如 '<选手id>::<组别>'
    nickname   text,
    rating     integer,
    content    text,
    ip         text,
    parent_id  bigint,
    created_at timestamptz not null default now()
  );
exception when others then raise notice '⑥ s6_comments 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 7. 竞猜三表 + 管理员口令表（betting.html）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create table if not exists public.s6_bet_bets (
    id               bigint generated always as identity primary key,
    user_id          bigint not null,
    match_id         bigint,            -- 指向 s6_match_schedule.id
    amount           integer not null default 0,
    predicted_winner text,
    created_at       timestamptz not null default now()
  );
  create table if not exists public.s6_bet_welfare_claims (
    id         bigint generated always as identity primary key,
    user_id    bigint not null,
    created_at timestamptz not null default now()
  );
  create table if not exists public.s6_betting_groups (
    group_name text primary key,
    is_locked  boolean not null default false
  );
  create table if not exists public.manage (          -- 竞猜「锁定组别」的口令
    id       bigint generated always as identity primary key,
    password text
  );
exception when others then raise notice '⑦ 竞猜/manage 表跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 8. RLS：全开（与站点既有模型一致 —— 前端 anon key + 口令把关）
-- ─────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array[
    's6_match_schedule','s5_match_schedule','s6_matches','s5_matches',
    's6_player_ids','s5_player_ids','s6_player_stats','s5_player_stats',
    'player_stats','player_ids','s6_comments',
    's6_bet_bets','s6_bet_welfare_claims','s6_betting_groups','manage',
    'notifications','event_registrations','event_captains','events','site_users','reg_profiles','organizer_requests','event_lottery_results'
  ] loop
    begin
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "open_all" on public.%I', t);
      execute format('create policy "open_all" on public.%I for all using (true) with check (true)', t);
    exception when others then
      raise notice '⑧ RLS % 跳过: %', t, sqlerrm;
    end;
  end loop;
exception when others then raise notice '⑧ RLS 循环跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 9. 权限：anon / authenticated / service_role 可读写（REST 依赖）
-- ─────────────────────────────────────────────────────────────
do $$ begin
  execute 'grant usage on schema public to anon, authenticated, service_role';
  execute 'grant all on all tables in schema public to anon, authenticated, service_role';
  execute 'grant all on all sequences in schema public to anon, authenticated, service_role';
  execute 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role';
  execute 'alter default privileges in schema public grant all on sequences to anon, authenticated, service_role';
exception when others then raise notice '⑨ GRANT 跳过: %', sqlerrm; end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. 测试数据（全部幂等）
-- ═══════════════════════════════════════════════════════════════════════

-- ⑩-1 测试账号（明文密码可直接登录：verifyPassword 兼容明文与 SHA-256）
do $$ begin
  insert into public.site_users (username, password, nickname, game_id, bio, role, balance)
  values
    ('tester',    'test1234',  '测试小号',   'TESTER#001', '普通成员视图测试账号', 'member', 500),
    ('testadmin', 'admin1234', '测试管理员', 'ADMIN#001',  '管理员视图测试账号',   'admin',  9999)
  on conflict (username) do nothing;
exception when others then raise notice '⑩-1 site_users 跳过: %', sqlerrm; end $$;

-- ⑩-2 补两种活动状态（schema 自带 registration/ongoing/finished 示例 → 管理列表可见全部 5 态）
do $$ begin
  insert into public.events
    (code, title, event_type, season, status, description, rules, format,
     start_time, end_time, reg_deadline, max_slots, venue, cover_emoji)
  select v.code, v.title, v.event_type, v.season, v.status, v.description, v.rules, v.format,
         v.start_time, v.end_time, v.reg_deadline, v.max_slots, v.venue, v.cover_emoji
  from (values
    ('EVT-S6-T1', '测试·草稿活动（未发布）', 'scrim',    'S6', 'draft',
     '假数据：草稿状态，验证管理后台徽章与状态下拉。', 'BO1', 'BO1',
     now()+interval '10 days', now()+interval '10 days', now()+interval '8 days',
     8, '测试房间', '🧪'),
    ('EVT-S6-T2', '测试·已取消活动', 'activity', 'S6', 'cancelled',
     '假数据：已取消状态，验证管理后台徽章与状态下拉。', '无', '自由参与',
     now()+interval '5 days', now()+interval '6 days', now()+interval '4 days',
     30, '—', '⛔')
  ) as v(code, title, event_type, season, status, description, rules, format,
          start_time, end_time, reg_deadline, max_slots, venue, cover_emoji)
  where not exists (select 1 from public.events e where e.code = v.code);
exception when others then raise notice '⑩-2 events 跳过: %', sqlerrm; end $$;

-- ⑩-3 tester 的三条报名：待审核 / 已通过 / 已撤回
do $$ begin
  insert into public.event_registrations (event_id, user_id, team_name, members, contact, note, status)
  select e.id, u.id, v.team_name, v.members::jsonb, v.contact, v.note, v.status
  from (values
    ('EVT-S6-01', '测试战队A',  '["测试小号","队友甲","队友乙"]', 'wechat: tester', '假数据·待审核', 'pending'),
    ('EVT-S6-03', '测试战队B',  '["测试小号"]',                  'qq: 10000',      '假数据·已通过', 'approved'),
    ('EVT-S6-02', '测试独行侠', '["测试小号"]',                  '',               '假数据·已撤回', 'cancelled')
  ) as v(code, team_name, members, contact, note, status)
  join public.events e     on e.code = v.code
  join public.site_users u on u.username = 'tester'
  where not exists (select 1 from public.event_registrations r
                    where r.event_id = e.id and r.user_id = u.id);
exception when others then raise notice '⑩-3 event_registrations 跳过: %', sqlerrm; end $$;

-- ⑩-4 传奇组 3 队 10 名测试选手（花名册）
do $$ begin
  insert into public.s6_player_ids (name, team, "group", image, honor, pwd)
  values
    ('测试·苍穹1号','苍穹队','传奇组','','','pwd888'), ('测试·苍穹2号','苍穹队','传奇组','','',''),
    ('测试·苍穹3号','苍穹队','传奇组','','',''),       ('测试·苍穹4号','苍穹队','传奇组','','',''),
    ('测试·烈焰1号','烈焰队','传奇组','','',''),       ('测试·烈焰2号','烈焰队','传奇组','','',''),
    ('测试·烈焰3号','烈焰队','传奇组','','',''),
    ('测试·雷霆1号','雷霆队','传奇组','','',''),       ('测试·雷霆2号','雷霆队','传奇组','','',''),
    ('测试·雷霆3号','雷霆队','传奇组','','','')
  on conflict (name) do nothing;
exception when others then raise notice '⑩-4 s6_player_ids 跳过: %', sqlerrm; end $$;

-- ⑩-5 赛程数据（赛程 Tab；两场带比分可测写回，两场未打；RR- 前缀免被赛程重生成清理）
do $$ begin
  insert into public.s6_match_schedule
    ("group", match_id, team_a, team_b, score_a, score_b, match_date, link, commentators)
  values
    ('传奇组','RR-T1','苍穹队','烈焰队', 13, 5,  now()+interval '2 days','https://example.com/room/1','测试解说·甲'),
    ('传奇组','RR-T2','苍穹队','雷霆队', 11, 13, now()+interval '3 days','https://example.com/room/2',''),
    ('传奇组','RR-T3','烈焰队','雷霆队', null, null, now()+interval '4 days','',''),
    ('传奇组','RR-T4','烈焰队','苍穹队', null, null, now()+interval '5 days','','')
  on conflict ("group", match_id) do nothing;
exception when others then raise notice '⑩-5 s6_match_schedule 跳过: %', sqlerrm; end $$;

-- ⑩-6 赛果数据（赛果 Tab 编辑下拉有行可选；data 格式 = ACS/K/D/A）
do $$ begin
  insert into public.s6_matches
    ("group", stage, match_date, map, score, team_a, team_b,
     team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
     team_a_player1_ch, team_a_player2_ch, team_b_player1_ch, team_b_player2_ch,
     team_a_player1_data, team_a_player2_data, team_b_player1_data, team_b_player2_data)
  select '传奇组','小组赛', now()+interval '1 day','源工重镇', '13:9','苍穹队','烈焰队',
    (select id from public.s6_player_ids where name='测试·苍穹1号'),
    (select id from public.s6_player_ids where name='测试·苍穹2号'),
    (select id from public.s6_player_ids where name='测试·烈焰1号'),
    (select id from public.s6_player_ids where name='测试·烈焰2号'),
    '霓虹','夜露','捷风','零',
    '24/18/12/3','19/15/14/5','21/16/13/2','14/17/15/4'
  where not exists (select 1 from public.s6_matches m
                    where m."group"='传奇组' and m.stage='小组赛'
                      and m.team_a='苍穹队' and m.team_b='烈焰队' and m.map='源工重镇');
exception when others then raise notice '⑩-6 s6_matches 跳过: %', sqlerrm; end $$;

-- ⑩-7 选手权限（s6_player_stats）：tester 的 game_id 命中队长 → 活动栏出「分队」、draft 放行
do $$ begin
  insert into public.s6_player_stats (player_name, game_id, team, "group", pre_group, role)
  select v.player_name, v.game_id, v.team, v."group", v."group", v.role
  from (values
    ('测试·苍穹1号','TESTER#001','苍穹队','传奇组','队长'),
    ('测试·苍穹2号','FAKE2#002', '苍穹队','传奇组','选手'),
    ('测试·苍穹3号','FAKE3#003', '苍穹队','传奇组','选手'),
    ('测试·苍穹4号','FAKE4#004', '苍穹队','传奇组','选手'),
    ('测试·烈焰1号','FAKE5#005', '烈焰队','传奇组','队长'),
    ('测试·烈焰2号','FAKE6#006', '烈焰队','传奇组','选手'),
    ('测试·烈焰3号','FAKE7#007', '烈焰队','传奇组','选手'),
    ('测试·雷霆1号','FAKE8#008', '雷霆队','传奇组','队长'),
    ('测试·雷霆2号','FAKE9#009', '雷霆队','传奇组','选手'),
    ('测试·雷霆3号','FAKE10#010','雷霆队','传奇组','选手')
  ) as v(player_name, game_id, team, "group", role)
  where not exists (select 1 from public.s6_player_stats p where p.player_name = v.player_name);
exception when others then raise notice '⑩-7 s6_player_stats 跳过: %', sqlerrm; end $$;

-- ⑩-8 分队页旧表镜像（team_note = 已分队伍）
do $$ begin
  insert into public.player_stats (player_name, game_id, team, team_note, "group", pre_group, role, huawei_score)
  select v.player_name, v.game_id, v.team, v.team_note, v."group", v."group", v.role, v.huawei_score
  from (values
    ('测试·苍穹1号','TESTER#001','苍穹队','苍穹队','传奇组','队长',95),
    ('测试·苍穹2号','FAKE2#002', '苍穹队','苍穹队','传奇组','选手',88),
    ('测试·苍穹3号','FAKE3#003', '苍穹队','苍穹队','传奇组','选手',82),
    ('测试·苍穹4号','FAKE4#004', '苍穹队','苍穹队','传奇组','选手',79),
    ('测试·烈焰1号','FAKE5#005', '烈焰队','烈焰队','传奇组','队长',91),
    ('测试·烈焰2号','FAKE6#006', '烈焰队','烈焰队','传奇组','选手',85),
    ('测试·烈焰3号','FAKE7#007', '烈焰队','烈焰队','传奇组','选手',80),
    ('测试·雷霆1号','FAKE8#008', '雷霆队','雷霆队','传奇组','队长',90),
    ('测试·雷霆2号','FAKE9#009', '雷霆队','雷霆队','传奇组','选手',84),
    ('测试·雷霆3号','FAKE10#010','雷霆队','雷霆队','传奇组','选手',77)
  ) as v(player_name, game_id, team, team_note, "group", role, huawei_score)
  where not exists (select 1 from public.player_stats p where p.player_name = v.player_name);

  insert into public.player_ids (name, team, "group", pwd)
  select v.name, v.team, v."group", v.pwd from (values
    ('测试·苍穹1号','苍穹队','传奇组','pwd888'), ('测试·苍穹2号','苍穹队','传奇组',''),
    ('测试·苍穹3号','苍穹队','传奇组',''),       ('测试·苍穹4号','苍穹队','传奇组',''),
    ('测试·烈焰1号','烈焰队','传奇组',''),       ('测试·烈焰2号','烈焰队','传奇组',''),
    ('测试·烈焰3号','烈焰队','传奇组',''),
    ('测试·雷霆1号','雷霆队','传奇组',''),       ('测试·雷霆2号','雷霆队','传奇组',''),
    ('测试·雷霆3号','雷霆队','传奇组','')
  ) as v(name, team, "group", pwd)
  on conflict (name) do nothing;
exception when others then raise notice '⑩-8 player_stats/player_ids 跳过: %', sqlerrm; end $$;

-- ⑩-9 选手页评论 ×2（player_key = 选手id::组别）
do $$ begin
  insert into public.s6_comments (player_key, nickname, rating, content, ip, parent_id)
  select (p.id::text || '::传奇组'), v.nickname, v.rating, v.content, v.ip, null::bigint
  from (values
    ('围观群众', 5, '假数据：这选手打得真不错！'),
    ('测试小号', 4, '假数据：回复一条测试评论。')
  ) as v(nickname, rating, content)
  cross join public.s6_player_ids p
  where p.name = '测试·苍穹1号'
    and not exists (select 1 from public.s6_comments c where c.ip = '127.0.0.1' and c.nickname = '围观群众');
exception when others then raise notice '⑩-9 s6_comments 跳过: %', sqlerrm; end $$;

-- ⑩-10 竞猜：组别状态 + 下注 + 低保领取 + 管理口令
do $$ begin
  insert into public.s6_betting_groups (group_name, is_locked)
  values ('传奇组', false), ('中坚组', false), ('挑战组', false)
  on conflict (group_name) do nothing;

  insert into public.s6_bet_bets (user_id, match_id, amount, predicted_winner)
  select u.id, m.id, v.amount, v.winner
  from (values
    ('RR-T1', 100, '苍穹队'),
    ('RR-T2', 50,  '雷霆队')
  ) as v(mid, amount, winner)
  join public.site_users u        on u.username = 'tester'
  join public.s6_match_schedule m on m.match_id = v.mid and m."group" = '传奇组'
  where not exists (select 1 from public.s6_bet_bets b
                    where b.user_id = u.id and b.match_id = m.id);

  insert into public.s6_bet_welfare_claims (user_id)
  select u.id from public.site_users u
  where u.username = 'tester'
    and not exists (select 1 from public.s6_bet_welfare_claims w where w.user_id = u.id);

  insert into public.manage (password)
  select 'admin1234'
  where not exists (select 1 from public.manage);
exception when others then raise notice '⑩-10 竞猜数据 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
do $$ begin
  raise notice '✅ 引导完成：若上方无「…跳过」 NOTICE，全部表与测试数据已就绪。';
end $$;
