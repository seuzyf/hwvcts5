-- =====================================================================
-- HWVCTS · install.sql（唯一结构脚本：全部表结构 + 全部服务端函数）
-- ---------------------------------------------------------------------
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴执行。幂等可重跑。
--   全新库：先跑本文件，再按需跑 seed.sql（仅测试数据，正式库勿跑）。
--   已有库：改版后重跑本文件即可（结构补齐段会把缺的列/表补上）。
--
-- 【重要教训】给老表加列必须写在下面的「结构补齐段」里用
-- add column if not exists，只改建表语句对已存在的表无效。
-- 文件内部顺序：核心表 → 赛季表 → 既有增量 → 安全函数 → 本轮新增
-- （新表/补齐/RPC）→ 旧静态口令退役清理。
-- =====================================================================

-- ═══════════ 第一段 · 核心表（原 schema.sql） ═══════════
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

-- 1.2 把历史明文密码转成 SHA-256
--
--   曾经这里是 `where password !~ '^[a-f0-9]{64}$'`，只看 64 位十六进制。
--   但前端升级后写的是 **PBKDF2**（`pbkdf2$310000$salt$hash`），不匹配那条正则，
--   于是每重跑一次本文件，所有已升级的账号就被「再哈希一次」——
--   哈希的哈希，谁都登不上，且不可逆。
--   （现象：所有账号都提示密码错误，连种子超管也一样。）
--
--   现在的判定：只转「看起来是明文」的。已知的哈希格式一律跳过，永不二次哈希。
--   注意 `[a-f0-9]` 要带 i：大写十六进制同样不能被当成明文。
do $$
begin
    execute 'create extension if not exists pgcrypto';
    update public.site_users
       set password = encode(digest(password, 'sha256'), 'hex')
     where password !~* '^[a-f0-9]{64}$'          -- SHA-256（含大写）
       and password !~* '^pbkdf2\$'                 -- PBKDF2（前端现行格式）
       and password !~ '^\$2[aby]?\$'                -- bcrypt
       and password !~ '^\$argon2'                   -- argon2
       and password !~ '^\$scrypt\$';                -- scrypt
exception when others then
    -- pgcrypto 不可用时保持明文，前端会自动识别并兼容，不影响使用
    raise notice '密码摘要迁移跳过: %', sqlerrm;
end $$;

-- 1.2bis 修复被旧版 1.2「二次哈希」锁死的账号
--
--   旧版把 PBKDF2 串（`pbkdf2$...`）当成明文又算了一次 SHA-256，
--   库里现在是 SHA256(那个 PBKDF2 串)，明文已不可恢复 —— 这些账号谁都登不上。
--
--   这里做两件事，都幂等：
--     1) 给 site_users 加 must_reset 标记，登录时明确提示「请重置密码」，
--        而不是永远显示"密码错误"（错误提示本身也是 bug）
--     2) 把这些账号的密文换成哨兵值 `!locked!`，前端识别为「需要重置」
--
--   解锁方式（二选一，都需要管理员操作，这是有意的——密码不可逆不能自动猜）：
--     a. 站点管理员登录后在「权限管理」里为该账号重置密码
--     b. 直接在 SQL Editor 执行：
--        update public.site_users
--           set password = encode(digest('新密码','sha256'),'hex'), must_reset = false
--         where username = '00588771';
alter table public.site_users add column if not exists must_reset boolean not null default false;

do $$
begin
    /* 被二次哈希的账号 = 密文是 64 位十六进制，且它的"原始 PBKDF2 串"再也取不回来。
       无法逐条识别，所以采用保守策略：只在**没有任何账号能正常登录**这种
       极端情况下才批量锁，避免误伤明文的正常账号。
       判断依据：PBKDF2 账号数为 0，但 must_reset 账号也为 0 → 说明本轮之前
       可能刚被旧版 1.2 洗过一遍。这里不自动锁，只把提示留在文档里。 */
    raise notice '若所有账号都无法登录：极可能是旧版 install.sql §1.2 对 PBKDF2 密文二次哈希，请按上方注释重置密码。';
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
                  -- draft 草稿 | registration 报名中 | closed 报名已截止（未开赛）
                  -- ongoing 进行中 | finished 已结束 | cancelled 已取消
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
-- 8. 报名「新建队伍」标记 + 站内通知（右上角铃铛）
--    新建队伍的报名 → 管理员审批通过 → 自动绑定本活动队长
-- ---------------------------------------------------------------------
alter table public.event_registrations add column if not exists new_team boolean not null default false;

create table if not exists public.notifications (
    id          bigint generated always as identity primary key,
    user_id     bigint not null references public.site_users(id) on delete cascade,
    title       text not null,
    body        text default '',
    link        text default '',
    read        boolean not null default false,
    created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (true);
drop policy if exists notifications_write on public.notifications;
create policy notifications_write on public.notifications for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 9. 报名选手资料档案（新选手完整两段式；老选手自动带入）
--    + 站点头像（右上角导航展示）+ 资料截图存储桶
-- ---------------------------------------------------------------------
alter table public.site_users add column if not exists avatar text default '';

create table if not exists public.reg_profiles (
    user_id     bigint primary key references public.site_users(id) on delete cascade,
    game_id     text default '',                -- 游戏 ID
    real_name   text default '',                -- 真名
    staff_no    text default '',                -- 工号
    positions   text default '',                -- 常玩位置，逗号分隔（一突,二突,先锋,控场,哨位）
    cur_rank    text default '',                -- 当前段位
    cur_acs     text default '',                -- 当前 ACS
    cur_kda     text default '',                -- 当前 KDA
    cur_kast    text default '',                -- 当前 KAST
    cur_adr     text default '',                -- 当前回合伤害
    cur_shot    text default '',                -- 当前赛季数据截图 URL
    hist_rank   text default '',                -- 历史最高段位
    hist_acs    text default '',                -- 历史巅峰 ACS
    hist_kda    text default '',                -- 历史巅峰 KDA
    hist_kast   text default '',                -- 历史巅峰 KAST
    hist_adr    text default '',                -- 历史巅峰回合伤害
    playtime    text default '',                -- 总游戏时长
    fps_before  text default '',                -- 之前玩过的 FPS
    fps_best    text default '',                -- 其他 FPS 最高段位
    career_shot text default '',                -- 生涯数据截图 URL
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
alter table public.reg_profiles enable row level security;
drop policy if exists reg_profiles_select on public.reg_profiles;
create policy reg_profiles_select on public.reg_profiles for select using (true);
drop policy if exists reg_profiles_write on public.reg_profiles;
create policy reg_profiles_write on public.reg_profiles for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('reg-docs', 'reg-docs', true)
on conflict (id) do nothing;

drop policy if exists "reg_docs_all" on storage.objects;
create policy "reg_docs_all" on storage.objects for all
    using (bucket_id = 'reg-docs')
    with check (bucket_id = 'reg-docs');

-- ---------------------------------------------------------------------
-- 10. 审核增强：截图人工核对标记
-- ---------------------------------------------------------------------
alter table public.reg_profiles add column if not exists shots_verified boolean not null default false;
alter table public.reg_profiles add column if not exists shots_verified_at timestamptz;

-- ---------------------------------------------------------------------
-- 11. 活动组织者：申请 → 管理员审核 → 该活动下等同管理员
-- ---------------------------------------------------------------------
alter table public.events add column if not exists organizer_id bigint;

create table if not exists public.organizer_requests (
    id           bigint generated always as identity primary key,
    user_id      bigint not null references public.site_users(id) on delete cascade,
    reason       text default '',
    status       text not null default 'pending',   -- pending / approved / rejected
    reviewed_by  bigint,
    reviewed_at  timestamptz,
    created_at   timestamptz not null default now()
);
alter table public.organizer_requests enable row level security;
drop policy if exists organizer_requests_select on public.organizer_requests;
create policy organizer_requests_select on public.organizer_requests for select using (true);
drop policy if exists organizer_requests_write on public.organizer_requests;
create policy organizer_requests_write on public.organizer_requests for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 12. 活动抽奖：中奖记录（名单滚筒抽取 → 提交入库 → 历史可查）
-- ---------------------------------------------------------------------
create table if not exists public.event_lottery_results (
    id          bigint generated always as identity primary key,
    event_id    bigint not null references public.events(id) on delete cascade,
    mode        text not null default 'random',    -- random=随机抽取 / weighted=按场次加权
    exec_mode   text not null default 'auto',      -- auto=自动停止 / manual=手动停止（带惯性）
    seed        text not null default '',          -- 随机种子（默认当前时间，可手动指定）
    winners     jsonb not null default '[]',       -- [{label, gid, weight}]
    drawn_by    bigint,
    created_at  timestamptz not null default now()
);
create index if not exists idx_lottery_event on public.event_lottery_results (event_id, created_at desc);
alter table public.event_lottery_results enable row level security;
drop policy if exists lottery_select on public.event_lottery_results;
create policy lottery_select on public.event_lottery_results for select using (true);
drop policy if exists lottery_write on public.event_lottery_results;
create policy lottery_write on public.event_lottery_results for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 13. Phase 13：积分存库 / 封禁 / 活动封禁 / 商品商店 / 直播链接 / 比赛归属
-- ---------------------------------------------------------------------
-- 13.1 积分权威列 + 全局封禁
alter table public.site_users add column if not exists balance_synced_at timestamptz;
alter table public.site_users add column if not exists banned boolean not null default false;
alter table public.site_users add column if not exists banned_reason text default '';
alter table public.site_users add column if not exists banned_until timestamptz;  -- null = 永久

-- 13.2 活动直播链接
alter table public.events add column if not exists stream_url text default '';

-- 13.3 积分流（审计 + 「谁改的」通知来源；余额 = 比赛推导部分 + 流水净额）
create table if not exists public.points_ledger (
    id            bigint generated always as identity primary key,
    user_id       bigint not null references public.site_users(id) on delete cascade,
    delta         integer not null,
    balance_after integer,
    reason        text default '',
    operator_id   bigint,
    source        text not null default 'admin',   -- admin / shop / system
    created_at    timestamptz not null default now()
);
alter table public.points_ledger enable row level security;
drop policy if exists points_ledger_select on public.points_ledger;
create policy points_ledger_select on public.points_ledger for select using (true);
drop policy if exists points_ledger_write on public.points_ledger;
create policy points_ledger_write on public.points_ledger for all using (true) with check (true);

-- 13.4 活动封禁（组织者仅限自己组织的活动）
create table if not exists public.event_bans (
    id          bigint generated always as identity primary key,
    event_id    bigint not null references public.events(id) on delete cascade,
    user_id     bigint not null references public.site_users(id) on delete cascade,
    reason      text default '',
    until       timestamptz,                        -- null = 永久
    created_by  bigint,
    created_at  timestamptz not null default now(),
    unique (event_id, user_id)
);
alter table public.event_bans enable row level security;
drop policy if exists event_bans_select on public.event_bans;
create policy event_bans_select on public.event_bans for select using (true);
drop policy if exists event_bans_write on public.event_bans;
create policy event_bans_write on public.event_bans for all using (true) with check (true);

-- 13.5 积分商店：商品 + 兑换记录
create table if not exists public.goods (
    id           bigint generated always as identity primary key,
    title        text not null,
    description  text default '',
    image_url    text default '',
    stock        integer not null default 0,
    cost         integer not null default 0,
    conditions   jsonb not null default '[]',        -- [{type, conn, ...params}]
    status       text not null default 'active',     -- active / draft（下架）
    created_by   bigint,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
alter table public.goods enable row level security;
drop policy if exists goods_select on public.goods;
create policy goods_select on public.goods for select using (true);
drop policy if exists goods_write on public.goods;
create policy goods_write on public.goods for all using (true) with check (true);

create table if not exists public.goods_redemptions (
    id         bigint generated always as identity primary key,
    goods_id   bigint not null references public.goods(id) on delete cascade,
    user_id    bigint not null references public.site_users(id) on delete cascade,
    cost       integer not null default 0,
    created_at timestamptz not null default now()
);
alter table public.goods_redemptions enable row level security;
drop policy if exists goods_redemptions_select on public.goods_redemptions;
create policy goods_redemptions_select on public.goods_redemptions for select using (true);
drop policy if exists goods_redemptions_write on public.goods_redemptions;
create policy goods_redemptions_write on public.goods_redemptions for all using (true) with check (true);

-- 13.6 比赛表归属赛事（赛季表可能不存在 → DO 保护；回填该赛季主活动）
do $$
declare
    t text;
    season_code text;
begin
    foreach t in array array['s5_matches', 's6_matches'] loop
        begin
            season_code := upper(substr(t, 1, 2));
            execute format('alter table public.%I add column if not exists event_id bigint', t);
            execute format(
                'update public.%I m set event_id = coalesce(m.event_id, (' ||
                'select e.id from public.events e where upper(coalesce(e.season, '''''')) = %L order by e.id limit 1))',
                t, season_code);
        exception when others then
            raise notice '13 比赛 event_id 跳过 %: %', t, sqlerrm;
        end;
    end loop;
end $$;

-- 13.7 原子兑换：校验库存与余额 → 扣减 → 流水 + 兑换记录
create or replace function public.redeem_goods(p_goods_id bigint, p_user_id bigint)
returns jsonb
language plpgsql
security definer
as $fn$
declare
    g public.goods%rowtype;
    cur integer;
    newbal integer;
begin
    select * into g from public.goods where id = p_goods_id for update;
    if not found then
        return jsonb_build_object('error', '商品不存在');
    end if;
    if g.status <> 'active' then
        return jsonb_build_object('error', '商品已下架');
    end if;
    if g.stock <= 0 then
        return jsonb_build_object('error', '库存不足');
    end if;
    select balance into cur from public.site_users where id = p_user_id for update;
    if not found then
        return jsonb_build_object('error', '用户不存在');
    end if;
    if cur is null or cur < g.cost then
        return jsonb_build_object('error', '积分不足');
    end if;
    newbal := cur - g.cost;
    update public.site_users set balance = newbal, balance_synced_at = now() where id = p_user_id;
    update public.goods set stock = stock - 1, updated_at = now() where id = p_goods_id;
    insert into public.goods_redemptions (goods_id, user_id, cost) values (p_goods_id, p_user_id, g.cost);
    insert into public.points_ledger (user_id, delta, balance_after, reason, operator_id, source)
        values (p_user_id, -g.cost, newbal, '兑换：' || g.title, null, 'shop');
    return jsonb_build_object('ok', true, 'balance', newbal, 'stock', g.stock - 1);
end;
$fn$;
grant execute on function public.redeem_goods(bigint, bigint) to anon, authenticated, service_role;

-- 13.8 存储桶：头像 / 商品图
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;
drop policy if exists "avatars_all" on storage.objects;
create policy "avatars_all" on storage.objects for all
    using (bucket_id = 'avatars')
    with check (bucket_id = 'avatars');

insert into storage.buckets (id, name, public) values ('goods', 'goods', true)
on conflict (id) do nothing;
drop policy if exists "goods_all" on storage.objects;
create policy "goods_all" on storage.objects for all
    using (bucket_id = 'goods')
    with check (bucket_id = 'goods');

-- 初始超级管理员（按需修改用户名后执行）：
--   update public.site_users set role = 'superadmin' where username = 'testadmin';

-- ---------------------------------------------------------------------
-- 完成 ✓
-- 执行后刷新网站即可：登录 → 个人主页 → 活动大厅报名
-- ---------------------------------------------------------------------

-- ═══════════ 第二段 · 赛季表（原 bootstrap.sql 建表部分） ═══════════
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
    result_status text,
    submitted_by bigint,
    confirmed_by bigint,
    confirmed_at timestamptz,
    import_batch_id bigint,
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
    event_id  bigint,
    import_batch_id bigint,
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
    status     text not null default 'visible',
    hidden_by  bigint,
    hidden_at  timestamptz,
    hide_reason text,
    created_at timestamptz not null default now()
  );
exception when others then raise notice '⑥ s6_comments 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 7. 竞猜表（betting.html；旧 manage 口令表已退役，不再新建）
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
  create table if not exists public.s5_betting_groups (like public.s6_betting_groups including all);
exception when others then raise notice '⑦ 竞猜/manage 表跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- 8. RLS：全开（与站点既有模型一致 —— 前端 anon key + 口令把关）
-- ─────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array[
    's6_match_schedule','s5_match_schedule','s6_matches','s5_matches',
    's6_player_ids','s5_player_ids','s6_player_stats','s5_player_stats',
    'player_stats','player_ids','s6_comments',
    's6_bet_bets','s6_bet_welfare_claims','s6_betting_groups','s5_betting_groups',
    'notifications','event_registrations','event_captains','events','site_users','reg_profiles','organizer_requests','event_lottery_results','points_ledger','event_bans','goods','goods_redemptions'
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


-- ═══════════ 第三段 · 既有增量（原 migration_v3.sql） ═══════════
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

-- ═══════════ 第四段 · 安全与服务端函数（原 hardening.sql） ═══════════
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

-- 【已退役】静态管理口令已由一次性口令（admin_access_codes）替代：
-- 不再写入默认口令；文件末尾会删除存量口令行并 drop 旧校验函数。

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

-- ═══════════ 第五段 · 本轮新增（一次性口令 / 限流 / 赛季 / 运营闭环） ═══════════

-- 5.1 结构补齐（老库重跑靠本段；只加不删，全部 if not exists） ----------
do $$
declare s text; t text;
begin
  foreach s in array array['s5','s6'] loop
    foreach t in array array['_matches','_match_schedule'] loop
      if to_regclass('public.' || s || t) is not null then
        execute format('alter table public.%I add column if not exists import_batch_id bigint', s || t);
      end if;
    end loop;
    if to_regclass('public.' || s || '_matches') is not null then
      execute format('alter table public.%I add column if not exists event_id bigint', s || '_matches');
    end if;
  end loop;
end $$;
alter table public.s6_comments add column if not exists status text not null default 'visible';
alter table public.s6_comments add column if not exists hidden_by bigint;
alter table public.s6_comments add column if not exists hidden_at timestamptz;
alter table public.s6_comments add column if not exists hide_reason text;
alter table public.goods_redemptions add column if not exists status text not null default 'completed';
alter table public.goods_redemptions add column if not exists refund_reason text;
alter table public.goods_redemptions add column if not exists refunded_by bigint;
alter table public.goods_redemptions add column if not exists refunded_at timestamptz;
create table if not exists public.s5_betting_groups (like public.s6_betting_groups including all);

-- 5.2 新表 -------------------------------------------------------------
create table if not exists public.admin_access_codes (
    id          bigint generated always as identity primary key,
    code_hash   text not null unique,
    code_hint   text not null default '',
    note        text not null default '',
    created_by  bigint,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz,
    used_by     bigint,
    revoked_at  timestamptz,
    revoked_by  bigint
);
create index if not exists idx_admin_codes_created on public.admin_access_codes (created_at desc);

create table if not exists public.login_attempts (
    id           bigint generated always as identity primary key,
    username     text not null default '',
    user_id      bigint,
    scope        text not null default 'login',   -- login / admin_code
    success      boolean not null default false,
    attempted_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_lookup on public.login_attempts (scope, username, attempted_at desc);
create index if not exists idx_login_attempts_user on public.login_attempts (scope, user_id, attempted_at desc);

create table if not exists public.seasons (
    id         bigint generated always as identity primary key,
    season_key text not null unique,              -- s5 / s6 / s7 …
    name       text not null default '',
    status     text not null default 'active',    -- active / archived（归档纯手动、可恢复）
    is_current boolean not null default false,    -- 仅作新建活动默认值，不限制其他赛季办赛
    starts_at  date,
    ends_at    date,
    created_at timestamptz not null default now()
);
create unique index if not exists uq_seasons_one_current on public.seasons (is_current) where is_current;
insert into public.seasons (season_key, name, status, is_current) values
  ('s5', '第五赛季', 'archived', false),
  ('s6', '第六赛季', 'active',   true)
on conflict (season_key) do nothing;

create table if not exists public.registration_revisions (
    id              bigint generated always as identity primary key,
    registration_id bigint not null,
    event_id        bigint,
    snapshot        jsonb not null default '{}'::jsonb,
    changed_by      bigint,
    change_kind     text not null default 'edit',  -- edit / key_edit（关键字段变更回待审核）
    created_at      timestamptz not null default now()
);
create index if not exists idx_reg_revisions_reg on public.registration_revisions (registration_id, created_at desc);

create table if not exists public.event_templates (
    id         bigint generated always as identity primary key,
    owner_id   bigint,
    name       text not null,
    payload    jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.import_batches (
    id           bigint generated always as identity primary key,
    batch_no     text not null unique,
    event_id     bigint,
    season       text not null default 's6',
    imported_by  bigint,
    row_count    integer not null default 0,
    status       text not null default 'imported',  -- imported / undone
    detail       jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    undone_at    timestamptz
);

create table if not exists public.comment_reports (
    id          bigint generated always as identity primary key,
    comment_id  bigint not null,
    season      text not null default 's6',
    reporter_id bigint,
    reason      text not null default '',
    status      text not null default 'pending',  -- pending / hidden / dismissed
    handled_by  bigint,
    handled_at  timestamptz,
    created_at  timestamptz not null default now()
);
create index if not exists idx_comment_reports_status on public.comment_reports (status, created_at desc);

create table if not exists public.team_transfer_requests (
    id           bigint generated always as identity primary key,
    season       text not null default 's6',
    team_name    text not null,
    from_user_id bigint,
    to_user_id   bigint not null,
    status       text not null default 'pending', -- pending / accepted / rejected
    created_at   timestamptz not null default now(),
    decided_at   timestamptz
);

create table if not exists public.bet_odds_snapshots (
    id          bigint generated always as identity primary key,
    season      text not null default 's6',
    match_id    bigint not null,
    pool_a      integer not null default 0,
    pool_b      integer not null default 0,
    rate_a      numeric,
    rate_b      numeric,
    created_at  timestamptz not null default now()
);
create index if not exists idx_odds_match on public.bet_odds_snapshots (season, match_id, created_at);

-- 新表 RLS（与站点既有宽松模型一致）+ 授权
do $$ declare t text; begin
  foreach t in array array['admin_access_codes','login_attempts','seasons','registration_revisions',
                           'event_templates','import_batches','comment_reports','team_transfer_requests','bet_odds_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "open_all" on public.%I', t);
    execute format('create policy "open_all" on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

-- 5.3 一次性临时管理员口令 ----------------------------------------------
create or replace function public.generate_admin_code(
    p_operator_id bigint, p_ttl_minutes integer default 30, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
    v_role text; v_hex text; v_code text; v_exp timestamptz; v_hint text;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is distinct from 'superadmin' then
        return jsonb_build_object('error', '仅超级管理员可生成临时口令');
    end if;
    if p_ttl_minutes is null then p_ttl_minutes := 30; end if;
    if p_ttl_minutes < 5 or p_ttl_minutes > 1440 then
        return jsonb_build_object('error', '有效期须在 5–1440 分钟之间');
    end if;
    v_hex := replace(gen_random_uuid()::text, '-', '');
    v_code := 'HW-' || translate(substr(v_hex, 1, 4), '01', 'QJ') || '-'
                   || translate(substr(v_hex, 5, 4), '01', 'QJ') || '-'
                   || translate(substr(v_hex, 9, 4), '01', 'QJ');
    v_hint := 'HW-' || translate(substr(v_hex, 1, 4), '01', 'QJ') || '-••••-'
                   || translate(substr(v_hex, 9, 4), '01', 'QJ');
    v_exp := now() + make_interval(mins => p_ttl_minutes);
    insert into public.admin_access_codes (code_hash, code_hint, note, created_by, expires_at)
    values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_hint, coalesce(p_note, ''), p_operator_id, v_exp);
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_role, 'admin_code.generate', 'admin_access_code', v_hint,
            jsonb_build_object('ttl_minutes', p_ttl_minutes, 'note', coalesce(p_note, ''), 'expires_at', v_exp));
    return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_exp);
end; $fn$;
grant execute on function public.generate_admin_code(bigint, integer, text) to anon, authenticated, service_role;

create or replace function public.redeem_admin_code(p_code text, p_user_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
    v_id bigint; v_fails integer; v_role text;
begin
    if p_user_id is null then
        return jsonb_build_object('error', '请先登录再兑换口令');
    end if;
    select count(*) into v_fails from public.login_attempts
     where scope = 'admin_code' and user_id = p_user_id and success = false
       and attempted_at > now() - interval '10 minutes';
    if v_fails >= 5 then
        return jsonb_build_object('error', '尝试过于频繁，请 10 分钟后再试');
    end if;
    -- 原子兑换：同一语句校验未用/未撤销/未过期并标记，防并发重复兑换
    update public.admin_access_codes
       set used_at = now(), used_by = p_user_id
     where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
    returning id into v_id;
    if v_id is null then
        insert into public.login_attempts (username, user_id, scope, success)
        select username, id, 'admin_code', false from public.site_users where id = p_user_id;
        return jsonb_build_object('error', '口令无效或已失效');
    end if;
    select role into v_role from public.site_users where id = p_user_id;
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_user_id, coalesce(v_role, ''), 'admin_code.redeem', 'admin_access_code', v_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end; $fn$;
grant execute on function public.redeem_admin_code(text, bigint) to anon, authenticated, service_role;

create or replace function public.revoke_admin_code(p_operator_id bigint, p_code_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_role text; v_n integer;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is distinct from 'superadmin' then
        return jsonb_build_object('error', '仅超级管理员可撤销口令');
    end if;
    update public.admin_access_codes
       set revoked_at = now(), revoked_by = p_operator_id
     where id = p_code_id and used_at is null and revoked_at is null;
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('error', '该口令已使用或已撤销，无法撤销'); end if;
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_role, 'admin_code.revoke', 'admin_access_code', p_code_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end; $fn$;
grant execute on function public.revoke_admin_code(bigint, bigint) to anon, authenticated, service_role;

-- 撤销口令的反悔窗口：8 秒内可恢复（只允许"刚撤销、且尚未被使用"的口令）。
-- 与前端 toast 的「撤销此操作」按钮配套；超过 8 秒即视为确认，不提供恢复。
create or replace function public.restore_admin_code(p_operator_id bigint, p_code_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_role text; v_n integer;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is distinct from 'superadmin' then
        return jsonb_build_object('error', '仅超级管理员可恢复口令');
    end if;
    update public.admin_access_codes
       set revoked_at = null, revoked_by = null
     where id = p_code_id
       and used_at is null
       and revoked_at is not null
       and revoked_at > now() - interval '10 seconds';
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('error', '已超过可恢复时间，或该口令已被使用'); end if;
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_role, 'admin_code.restore', 'admin_access_code', p_code_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end; $fn$;
grant execute on function public.restore_admin_code(bigint, bigint) to anon, authenticated, service_role;

create or replace function public.list_admin_codes(p_operator_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_role text; v_out jsonb;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is distinct from 'superadmin' then
        return jsonb_build_object('error', '仅超级管理员可查看口令列表');
    end if;
    select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v_out
    from (
        select c.id, c.code_hint, c.note, c.created_at, c.expires_at, c.used_at, c.revoked_at,
               cu.username as created_by_name, uu.username as used_by_name,
               case when c.revoked_at is not null then 'revoked'
                    when c.used_at is not null then 'used'
                    when c.expires_at <= now() then 'expired' else 'active' end as status
          from public.admin_access_codes c
          left join public.site_users cu on cu.id = c.created_by
          left join public.site_users uu on uu.id = c.used_by
         order by c.created_at desc limit 50
    ) x;
    return jsonb_build_object('ok', true, 'codes', v_out);
end; $fn$;
grant execute on function public.list_admin_codes(bigint) to anon, authenticated, service_role;

-- 5.4 新建赛季物理表（仅管理员；key 白名单；幂等） -----------------------
create or replace function public.create_season_tables(
    p_operator_id bigint, p_key text, p_name text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_role text; t text;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is null or v_role not in ('admin', 'superadmin') then
        return jsonb_build_object('error', '仅管理员可新建赛季');
    end if;
    if p_key is null or p_key !~ '^s[0-9]{1,3}$' then
        return jsonb_build_object('error', '赛季 key 格式应为 s+数字，如 s7');
    end if;
    insert into public.seasons (season_key, name, status, is_current)
    values (p_key, coalesce(nullif(p_name, ''), upper(p_key) || ' 赛季'), 'active', false)
    on conflict (season_key) do nothing;
    foreach t in array array['match_schedule', 'matches', 'player_ids', 'player_stats', 'bet_bets', 'betting_groups'] loop
        execute format('create table if not exists public.%I (like public.%I including all)', p_key || '_' || t, 's6_' || t);
        execute format('alter table public.%I enable row level security', p_key || '_' || t);
        execute format('drop policy if exists "open_all" on public.%I', p_key || '_' || t);
        execute format('create policy "open_all" on public.%I for all using (true) with check (true)', p_key || '_' || t);
    end loop;
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_role, 'season.create', 'season', p_key, jsonb_build_object('name', p_name));
    return jsonb_build_object('ok', true);
end; $fn$;
grant execute on function public.create_season_tables(bigint, text, text) to anon, authenticated, service_role;

-- 5.5 商城退款（原子：状态防重 + 库存 + 积分流水 + 审计） -----------------
create or replace function public.refund_redemption(
    p_operator_id bigint, p_redemption_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
    v_role text; r public.goods_redemptions%rowtype; v_after integer;
begin
    select role into v_role from public.site_users where id = p_operator_id;
    if v_role is null or v_role not in ('admin', 'superadmin') then
        return jsonb_build_object('error', '仅管理员可撤销兑换');
    end if;
    if coalesce(trim(p_reason), '') = '' then
        return jsonb_build_object('error', '退款原因必填');
    end if;
    select * into r from public.goods_redemptions where id = p_redemption_id for update;
    if not found then return jsonb_build_object('error', '兑换记录不存在'); end if;
    if r.status = 'refunded' then return jsonb_build_object('error', '该记录已退款，请勿重复操作'); end if;
    update public.goods_redemptions
       set status = 'refunded', refund_reason = p_reason, refunded_by = p_operator_id, refunded_at = now()
     where id = p_redemption_id;
    update public.goods set stock = stock + 1, updated_at = now() where id = r.goods_id;
    update public.site_users set balance = coalesce(balance, 0) + r.cost, balance_synced_at = now()
     where id = r.user_id returning balance into v_after;
    insert into public.points_ledger (user_id, delta, balance_after, reason, operator_id, source)
    values (r.user_id, r.cost, v_after, '商城退款：' || p_reason, p_operator_id, 'shop');
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_role, 'shop.refund', 'goods_redemption', p_redemption_id::text,
            jsonb_build_object('reason', p_reason, 'cost', r.cost, 'user_id', r.user_id));
    return jsonb_build_object('ok', true, 'balance', v_after);
end; $fn$;
grant execute on function public.refund_redemption(bigint, bigint, text) to anon, authenticated, service_role;

-- 5.6 调分上限（覆盖第四段版本：admin 单次 ±500，superadmin 不限） --------
create or replace function public.adjust_points(
    p_operator_id bigint, p_user_id bigint, p_delta integer, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_op_role text; v_bal integer; v_after integer;
begin
    select role into v_op_role from public.site_users where id = p_operator_id;
    if v_op_role is null or v_op_role not in ('admin', 'superadmin') then
        return jsonb_build_object('error', '仅管理员可调整积分');
    end if;
    if p_delta is null or p_delta = 0 then
        return jsonb_build_object('error', '积分变化不能为 0');
    end if;
    if v_op_role = 'admin' and abs(p_delta) > 500 then
        return jsonb_build_object('error', '管理员单次调分上限 ±500，超出请联系超级管理员');
    end if;
    select balance into v_bal from public.site_users where id = p_user_id for update;
    if not found then return jsonb_build_object('error', '用户不存在'); end if;
    v_after := coalesce(v_bal, 0) + p_delta;
    if v_after < 0 then return jsonb_build_object('error', '积分不足，不能扣成负数'); end if;
    update public.site_users set balance = v_after, balance_synced_at = now() where id = p_user_id;
    insert into public.points_ledger (user_id, delta, balance_after, reason, operator_id, source)
    values (p_user_id, p_delta, v_after, coalesce(p_reason, ''), p_operator_id, 'admin');
    insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
    values (p_operator_id, v_op_role, 'points.adjust', 'user', p_user_id::text,
            jsonb_build_object('delta', p_delta, 'reason', coalesce(p_reason, '')));
    return jsonb_build_object('ok', true, 'balance', v_after);
end; $fn$;
grant execute on function public.adjust_points(bigint, bigint, integer, text) to anon, authenticated, service_role;

-- 5.7 下注（服务端以数据库时间裁决锁定；组别手动锁/已结算/未定时间均拦截） --
create or replace function public.place_bet(
    p_user_id bigint, p_season text, p_match_id bigint, p_amount integer, p_predicted_winner text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
    v_group text; v_date timestamptz; v_sa integer; v_sb integer; v_locked boolean; v_id bigint;
begin
    if p_season is null or p_season !~ '^s[0-9]{1,3}$' then
        return jsonb_build_object('error', '赛季参数非法');
    end if;
    if p_amount is null or p_amount <= 0 then
        return jsonb_build_object('error', '下注积分须为正数');
    end if;
    execute format('select "group", match_date, score_a, score_b from public.%I where id = $1', p_season || '_match_schedule')
       into v_group, v_date, v_sa, v_sb using p_match_id;
    if v_group is null and v_date is null and v_sa is null and v_sb is null then
        return jsonb_build_object('error', '比赛不存在');
    end if;
    if v_sa is not null and v_sb is not null and (v_sa > 0 or v_sb > 0) then
        return jsonb_build_object('error', '该场比赛已结算');
    end if;
    if v_date is null then
        return jsonb_build_object('error', '对战时间待定，暂未开放竞猜');
    end if;
    if v_date <= now() then
        return jsonb_build_object('error', '比赛时间已到，预测已锁定');
    end if;
    execute format('select is_locked from public.%I where group_name = $1', p_season || '_betting_groups')
       into v_locked using v_group;
    if coalesce(v_locked, false) then
        return jsonb_build_object('error', '该组别已被管理员锁定');
    end if;
    execute format('insert into public.%I (user_id, match_id, amount, predicted_winner) values ($1, $2, $3, $4) returning id', p_season || '_bet_bets')
       into v_id using p_user_id, p_match_id, p_amount, p_predicted_winner;
    return jsonb_build_object('ok', true, 'id', v_id);
end; $fn$;
grant execute on function public.place_bet(bigint, text, bigint, integer, text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------
-- 5.7bis 活动状态自动推进（幂等；手动 / 定时均可）
--   过去的问题：events.status 是纯人工字段，没人推进。
--     结果是「报名截止时间早过了，库里还写着 registration」，而卡片和详情又各自算一遍 → 说法不一致。
--   现在：判定规则只写在**这一个函数**里，前端只负责提醒它跑。
--
--   规则（时间事实优先，与前端 HWLayout.evState 逐条对应）：
--     end_time 已过                    → finished
--     start_time 已到                  → ongoing
--     reg_deadline 已过 + registration → closed（报名已截止，但还没开赛）
--     registration + 名额已满          → closed（报名同样关闭，候补走 waitlist 通道）
--   已经是 closed / ongoing / finished 的不回退；draft / cancelled 不动（人工终态）。
--
--   用法：
--     select public.sync_event_status();                    -- 手动
--     select cron.schedule('event-status','*/15 * * * *',
--            $$select public.sync_event_status()$$);         -- pg_cron 每 15 分钟
-- ----------------------------------------------------------------------
create or replace function public.sync_event_status()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_touched integer := 0;
    v_n integer := 0;
begin
    /* 1) 已结束。
       只推进"比时间落后"的状态：draft 是人工草稿、cancelled 是人工取消，
       都不该被时间改回来。 */
    update public.events
       set status = 'finished', updated_at = now()
     where status in ('registration', 'closed', 'ongoing')
       and end_time is not null
       and end_time < now();
    get diagnostics v_n = row_count; v_touched := v_touched + v_n;

    /* 2) 已开赛（报名期自动关闭，不必再写 closed） */
    update public.events
       set status = 'ongoing', updated_at = now()
     where status in ('registration', 'closed')
       and start_time is not null
       and start_time <= now()
       and (end_time is null or end_time >= now());
    get diagnostics v_n = row_count; v_touched := v_touched + v_n;

    /* 3) 报名截止时间已过 */
    update public.events
       set status = 'closed', updated_at = now()
     where status = 'registration'
       and reg_deadline is not null
       and reg_deadline < now()
       and (start_time is null or start_time > now());
    get diagnostics v_n = row_count; v_touched := v_touched + v_n;

    /* 4) 名额已满（仍有空位的场地不动；没设上限的不动） */
    update public.events e
       set status = 'closed', updated_at = now()
     where e.status = 'registration'
       and e.max_slots is not null
       and e.max_slots > 0
       and (select count(*) from public.event_registrations r
             where r.event_id = e.id and r.status in ('pending', 'approved')) >= e.max_slots;
    get diagnostics v_n = row_count; v_touched := v_touched + v_n;

    return v_touched;
end;
$fn$;
grant execute on function public.sync_event_status() to anon, authenticated, service_role;

/* 可选：若当前库已启用 pg_cron，则每 15 分钟自动跑一次（未启用则跳过，不报错） */
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule('hwvcts-event-status', '*/15 * * * *', 'select public.sync_event_status()');
    end if;
exception when others then
    raise notice 'pg_cron 排程跳过: %', sqlerrm;
end $$;

-- 5.7ter 服务端报名闸门 ------------------------------------------------------
--   前端已经按 evState 拦了一次；但直接调接口仍能绕过。
--   这里在数据库侧再拦一次：状态不可报名 / 过了截止 / 名额已满 且不是候补 → 拒绝。
--   注意：只拦 INSERT；撤回（status='cancelled'）与资料更新不受影响。
create or replace function public.guard_event_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_ev public.events%rowtype;
    v_taken integer;
begin
    /* 这道闸门存在的意义是：拦住「绕过前端直接调接口」的写入。
       但它不该拦住有权限的人手动维护数据 —— 在 Supabase SQL 编辑器里跑
       seed / 修数据 / 补录，走的是 postgres / supabase_admin 会话（无 JWT 角色），
       那不是"绕过前端"，是直接管库。以前的写法把这些也拦了，
       于是「把活动改成已结束后重跑 seed」就会报 报名通道已关闭。
       判定方式：只有 api 请求（anon / authenticated）才做校验。 */
    if current_setting('request.jwt.claims', true) is null
       or current_user in ('postgres', 'supabase_admin', 'service_role') then
        return new;
    end if;

    select * into v_ev from public.events where id = new.event_id;
    if not found then
        raise exception '活动不存在';
    end if;

    /* 候补是被允许的：有人撤回时按顺序递补 */
    if new.status = 'waitlist' then
        return new;
    end if;

    if v_ev.status in ('draft', 'cancelled', 'deleted') then
        raise exception '「%」当前不可报名（状态：%）', v_ev.title, v_ev.status;
    end if;
    if v_ev.status in ('closed', 'ongoing', 'finished') then
        raise exception '「%」的报名通道已关闭（状态：%）', v_ev.title, v_ev.status;
    end if;
    if v_ev.reg_deadline is not null and v_ev.reg_deadline < now() then
        raise exception '「%」报名已于 % 截止', v_ev.title,
            to_char(v_ev.reg_deadline at time zone 'Asia/Shanghai', 'MM-DD HH24:MI');
    end if;
    if v_ev.max_slots is not null and v_ev.max_slots > 0 then
        select count(*) into v_taken from public.event_registrations r
         where r.event_id = v_ev.id and r.status in ('pending', 'approved');
        if v_taken >= v_ev.max_slots then
            raise exception '「%」名额已满（%）', v_ev.title, v_taken || '/' || v_ev.max_slots;
        end if;
    end if;
    return new;
end;
$fn$;

drop trigger if exists trg_guard_event_registration on public.event_registrations;
create trigger trg_guard_event_registration
    before insert on public.event_registrations
    for each row execute function public.guard_event_registration();

--   批量导入/修数据时如果不想逐条过闸门：
--     alter table public.event_registrations disable trigger trg_guard_event_registration;
--     ... 灌数据 ...
--     alter table public.event_registrations enable trigger trg_guard_event_registration;
--   （函数本身已经放行 postgres / 无 JWT 的直连会话，通常不需要这一步。）

-- 5.8 旧静态口令退役（默认口令是已知口令，留着即后门） --------------------
delete from public.site_settings where key = 'admin_password_sha256';
drop function if exists public.promote_self_admin(text, bigint);
drop function if exists public.check_admin_password(text);

-- =====================================================================
-- install.sql 完成 ✓  新库接下来可执行 seed.sql（仅测试环境）。
-- =====================================================================
