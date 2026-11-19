-- =====================================================================
-- HWVCTS 赛事网站 · 统一账号 + 活动报名 数据库升级脚本
-- ---------------------------------------------------------------------
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 整段粘贴执行
--
-- 本脚本做三件事（全部幂等，可重复执行）：
--   1. 创建统一账号表 site_users，并从旧竞猜账号表 s6_bet_users 迁移
--      （保留原 id，竞猜/低保数据的 user_id 引用不受影响）
--   2. 创建 events（赛事/活动数据）与 event_registrations（报名信息）
--      —— 两张表完全分离，报名信息只通过 event_id 关联赛事
--   3. 写入示例活动数据，便于立刻体验报名流程
--
-- 兼容性：脚本执行前站点即可正常使用（前端会自动回退旧账号表）；
-- 执行后自动切换到新账号体系。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 统一账号表
-- ---------------------------------------------------------------------
create table if not exists public.site_users (
    id            bigint generated always as identity primary key,
    username      text not null unique,
    password      text not null,                 -- SHA-256 十六进制（旧数据迁移时自动转换）
    nickname      text,                          -- 展示昵称
    game_id       text,                          -- 无畏契约游戏 ID
    bio           text default '',               -- 个人简介
    role          text not null default 'member',-- member | admin
    balance       integer not null default 100,  -- 竞猜分数（与旧表同名字段对齐）
    created_at    timestamptz not null default now(),
    last_login_at timestamptz
);

comment on table public.site_users is '全站统一账号（个人主页 / 活动报名 / 竞猜共用）';
comment on column public.site_users.password is 'SHA-256(hex)；历史明文数据由下方迁移自动转换';

-- 1.1 从旧竞猜账号表迁移（保留 id，确保 s6_bet_bets / s6_bet_welfare_claims 引用不断）
do $$
begin
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 's6_bet_users'
    ) then
        insert into public.site_users (id, username, password, balance)
        select s.id, s.username, s.password, coalesce(s.balance, 100)
        from public.s6_bet_users s
        on conflict (id) do nothing;

        -- 显式插入会推进不了自增序列，这里把序列拉到当前最大 id 之后
        perform setval(
            pg_get_serial_sequence('public.site_users', 'id'),
            greatest(coalesce((select max(id) from public.site_users), 0), 1),
            coalesce((select max(id) from public.site_users), 0) > 0
        );
    end if;
end $$;

-- 1.2 把历史明文密码转成 SHA-256（幂等：已是摘要格式的跳过）
do $$
begin
    execute 'create extension if not exists pgcrypto';
    update public.site_users
       set password = encode(digest(password, 'sha256'), 'hex')
     where password !~ '^[a-f0-9]{64}$';
exception when others then
    -- pgcrypto 不可用时保持明文，前端会自动识别并兼容，不影响使用
    raise notice '密码摘要迁移跳过: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 2. 赛事/活动表（只存赛事本身的元数据，不含任何报名者信息）
-- ---------------------------------------------------------------------
create table if not exists public.events (
    id            bigint generated always as identity primary key,
    code          text unique,                   -- 活动编号，如 EVT-S6-01（可空，自动生成用 id）
    title         text not null,                 -- 活动标题
    event_type    text not null default 'tournament',
                  -- tournament 赛事 | scrim 训练赛 | showmatch 表演赛 | activity 活动
    season        text default 'S6',             -- 所属赛季
    status        text not null default 'registration',
                  -- draft 草稿 | registration 报名中 | ongoing 进行中 | finished 已结束 | cancelled 已取消
    description   text default '',               -- 活动简介
    rules         text default '',               -- 赛制/规则
    format        text default '',               -- 形式：BO1/BO3、5v5 等
    start_time    timestamptz,                   -- 开始时间
    end_time      timestamptz,                   -- 结束时间
    reg_deadline  timestamptz,                   -- 报名截止
    max_slots     integer,                       -- 名额上限（空 = 不限）
    venue         text default '',               -- 线上房间号 / 平台说明
    cover_emoji   text default '🏆',             -- 卡片封面图标（无图时回退）
    cover_image   text default '',               -- 封面图 URL（Storage: event-covers，管理员上传）
    created_by    text default 'admin',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on table public.events is '赛事/活动数据（与报名信息完全分离）';

-- 幂等补列：已有项目重跑本文件时自动加上封面图列
alter table public.events add column if not exists cover_image text default '';
-- 幂等补列：创建活动「赛制选择」（参赛队伍 / 分组数量；赛制复用 format 列）
alter table public.events add column if not exists teams text default '';
alter table public.events add column if not exists group_count integer default 1;

-- ---------------------------------------------------------------------
-- 3. 报名信息表（只存“谁报了什么”，赛事详情一律回查 events）
-- ---------------------------------------------------------------------
create table if not exists public.event_registrations (
    id          bigint generated always as identity primary key,
    event_id    bigint not null references public.events(id) on delete cascade,
    user_id     bigint not null references public.site_users(id) on delete cascade,
    team_name   text not null default '',        -- 战队名（个人赛可与昵称相同）
    members     jsonb not null default '[]',     -- 队员名单 ["张三","李四",...]
    contact     text default '',                 -- 联系方式（微信/QQ/游戏内 ID）
    note        text default '',                 -- 备注
    status      text not null default 'pending',
                -- pending 待审核 | approved 已通过 | rejected 未通过 | cancelled 已撤回
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (event_id, user_id)                  -- 一人一活动一条报名（撤回后可再报）
);

comment on table public.event_registrations is '报名信息（与 events 分表，仅通过 event_id 关联）';

create index if not exists idx_reg_event  on public.event_registrations (event_id, status);
create index if not exists idx_reg_user   on public.event_registrations (user_id, status);
create index if not exists idx_events_status on public.events (status, start_time);

-- updated_at 自动维护
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_events_updated on public.events;
create trigger trg_events_updated before update on public.events
    for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_reg_updated on public.event_registrations;
create trigger trg_reg_updated before update on public.event_registrations
    for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 4. RLS 策略
-- ---------------------------------------------------------------------
-- 说明：站点使用 publishable(anon) key，前端无法验证身份，因此策略与
-- 现有表（s6_*）保持一致的宽松模型：读写开放，管理动作靠管理口令 RPC
-- （check_admin_password）在前端把关。
-- 加固建议（后续可选）：迁移到 Supabase Auth 后，把写策略收紧为
--   using (auth.uid() = user_id) 并对 events 写操作限定 service role。
alter table public.site_users            enable row level security;
alter table public.events                enable row level security;
alter table public.event_registrations   enable row level security;

-- 账号：读全表（排行榜/报名列表需要用户名），写走前端口令与校验
drop policy if exists site_users_select on public.site_users;
create policy site_users_select on public.site_users for select using (true);
drop policy if exists site_users_write on public.site_users;
create policy site_users_write on public.site_users for all using (true) with check (true);

-- 赛事：公开可见；写操作在前端经管理口令验证后执行
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (true);
drop policy if exists events_write on public.events;
create policy events_write on public.events for all using (true) with check (true);

-- 报名：公开可见（展示战队名单）；写操作由前端校验“本人 +活动状态”
drop policy if exists regs_select on public.event_registrations;
create policy regs_select on public.event_registrations for select using (true);
drop policy if exists regs_write on public.event_registrations;
create policy regs_write on public.event_registrations for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 5. 示例活动（幂等：按 title 去重）
-- ---------------------------------------------------------------------
insert into public.events
    (code, title, event_type, season, status, description, rules, format,
     start_time, end_time, reg_deadline, max_slots, venue, cover_emoji)
select v.code, v.title, v.event_type, v.season, v.status, v.description,
       v.rules, v.format, v.start_time, v.end_time, v.reg_deadline,
       v.max_slots, v.venue, v.cover_emoji
from (values
    ('EVT-S6-01', 'S6 赛季冠军赛', 'tournament', 'S6', 'registration',
     '第六赛季最终冠军赛，各组别优胜队伍晋级线上对决，冠军将获得定制奖杯与称号。',
     '小组赛 BO1 循环 → 淘汰赛 BO3 单败；每队 5 人 + 1 替补，迟到 10 分钟判负',
     'BO1 / BO3',
     now() + interval '7 days', now() + interval '14 days', now() + interval '5 days',
     16, '腾讯会议房间号（报名通过后群内发放）', '🏆'),
    ('EVT-S6-02', 'S6 周末表演赛', 'showmatch', 'S6', 'ongoing',
     '娱乐表演赛，随机组队混战，欢迎所有段位的选手参与。',
     'BO1 双败，娱乐为主，禁止代打',
     'BO1',
     now() - interval '1 day', now() + interval '2 days', now() - interval '2 days',
     20, '自定义房间：HWVCT-SHOW', '🎉'),
    ('EVT-S6-03', 'S6 新人训练营', 'scrim', 'S6', 'registration',
     '面向新人的训练赛活动，由老选手带队教学，报名即可参与。',
     'BO3 两场，赛后复盘',
     'BO3',
     now() + interval '3 days', now() + interval '3 days', now() + interval '2 days',
     12, '训练房间（私密）', '🎯'),
    ('EVT-S5-01', 'S5 赛季总决赛（回顾）', 'tournament', 'S5', 'finished',
     '第五赛季总决赛，已完赛。数据可在比赛中心查看。',
     'BO5 两场，赛后复盘',
     'BO5',
     now() - interval '30 days', now() - interval '30 days', now() - interval '35 days',
     8, '已结束', '📜')
) as v(code, title, event_type, season, status, description, rules, format,
       start_time, end_time, reg_deadline, max_slots, venue, cover_emoji)
where not exists (select 1 from public.events e where e.title = v.title);

-- ---------------------------------------------------------------------
-- 6. 活动封面图存储桶（公开读；站点既有宽松模型，管理员在活动页上传）
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-covers', 'event-covers', true)
on conflict (id) do nothing;

drop policy if exists "event_covers_all" on storage.objects;
create policy "event_covers_all" on storage.objects for all
    using (bucket_id = 'event-covers')
    with check (bucket_id = 'event-covers');

-- ---------------------------------------------------------------------
-- 7. 活动队长（与活动绑定 →该活动「数据台」的权限）
--    管理员在活动详情「管理」区设置；队长登录后可见 管理 页签
-- ---------------------------------------------------------------------
create table if not exists public.event_captains (
    id          bigint generated always as identity primary key,
    event_id    bigint not null references public.events(id) on delete cascade,
    player_name text not null,                 -- 选手真名（花名册主键）
    game_id     text default '',               -- 冗余存一份，便于登录匹配
    added_by    text default 'admin',
    created_at  timestamptz not null default now(),
    unique (event_id, player_name)
);

drop policy if exists event_captains_select on public.event_captains;
create policy event_captains_select on public.event_captains for select using (true);
drop policy if exists event_captains_write on public.event_captains;
create policy event_captains_write on public.event_captains for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 完成 ✓
-- 执行后刷新网站即可：登录 → 个人主页 → 活动大厅报名
-- ---------------------------------------------------------------------
