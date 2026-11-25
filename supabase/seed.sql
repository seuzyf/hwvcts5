-- =====================================================================
-- HWVCTS · seed.sql（仅测试数据，幂等可重跑）
-- ---------------------------------------------------------------------
-- ⚠️ 警告：本文件包含弱口令测试账号（含超级管理员 00588771/123456），
--    只能在测试/内部环境执行，正式库严禁执行本文件！
-- 前置：先执行 install.sql。账号密码为 SHA-256 旧格式，首次登录会
--    被 js/auth.js 自动升级为 PBKDF2。
-- =====================================================================

begin;

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
/* 幂等：code 或 title 任一已存在就跳过。
   以前只按 title 判，于是「同一个 code 换了标题」会撞 events_code_key。 */
where not exists (
    select 1 from public.events e where e.code = v.code or e.title = v.title
);


-- ---------------------------------------------------------------------
-- 1. 账号（12 个）
-- ---------------------------------------------------------------------
insert into public.site_users (username, password, nickname, game_id, role, balance)
values
  ('admin',      encode(sha256(convert_to('password123','UTF8')),'hex'), '站点管理员', 'HW-0001', 'superadmin', 0),
  ('00588771',   encode(sha256(convert_to('123456','UTF8')),'hex'),      '测试超级管理员', 'HW-0005', 'superadmin', 0),
  ('organizer',  encode(sha256(convert_to('password123','UTF8')),'hex'), '赛事组织者', 'HW-0002', 'organizer',  120),
  ('alice',      encode(sha256(convert_to('password123','UTF8')),'hex'), '爱丽丝',     'HW-1001', 'member',     260),
  ('bob',        encode(sha256(convert_to('password123','UTF8')),'hex'), '鲍勃',       'HW-1002', 'member',     180),
  ('carol',      encode(sha256(convert_to('password123','UTF8')),'hex'), '卡罗尔',     'HW-1003', 'member',      80),
  ('dave',       encode(sha256(convert_to('password123','UTF8')),'hex'), '戴夫',       'HW-1004', 'member',     140),
  ('erina',      encode(sha256(convert_to('password123','UTF8')),'hex'), '绘里奈',     'HW-1005', 'member',      60),
  ('frank',      encode(sha256(convert_to('password123','UTF8')),'hex'), '弗兰克',     'HW-1006', 'member',     200),
  ('grace',      encode(sha256(convert_to('password123','UTF8')),'hex'), '格蕾丝',     'HW-1007', 'member',     110),
  ('henry',      encode(sha256(convert_to('password123','UTF8')),'hex'), '亨利',       'HW-1008', 'member',      30),
  ('ivy',        encode(sha256(convert_to('password123','UTF8')),'hex'), '艾薇',       'HW-1009', 'member',     150),
  ('jack',       encode(sha256(convert_to('password123','UTF8')),'hex'), '杰克',       'HW-1010', 'member',      95)
on conflict (username) do nothing;

-- ---------------------------------------------------------------------
-- 2. 赛事（5 个：进行中 / 报名中 / 已结束 / 草稿 / 已取消）
-- ---------------------------------------------------------------------
insert into public.events (code, title, event_type, season, status, description, rules, format,
                           start_time, end_time, reg_deadline, max_slots, venue, cover_emoji, organizer_id)
values
  ('EVT-S6-01', 'HWVCTS 第六赛季正赛',   'tournament', 'S6', 'ongoing',
   '第六赛季正赛，三组单循环 + 淘汰赛。', 'BO1 小组赛，BO3 淘汰赛，禁止代打。', '5v5 · BO1',
   now() - interval '6 days', now() + interval '8 days', now() - interval '7 days', 24, '线上 · 训练赛房间 8801', '🏆',
   (select id from public.site_users where username = 'organizer')),
  ('EVT-S6-02', '第六赛季新人训练赛',     'scrim',      'S6', 'registration',
   '面向新人的训练赛，报名后由管理员分队。', 'BO1，允许跨组报名。', '5v5 · BO1',
   now() + interval '5 days', now() + interval '5 days', now() + interval '4 days', 40, '线上 · 新人房 8802', '🧪',
   (select id from public.site_users where username = 'organizer')),
  ('EVT-S5-01', '第五赛季收官赛',         'tournament', 'S5', 'finished',
   '第五赛季总决赛，已归档。', 'BO3', '5v5 · BO3',
   now() - interval '40 days', now() - interval '38 days', now() - interval '45 days', 16, '线上 · 总决赛房', '🏁',
   (select id from public.site_users where username = 'admin')),
  ('EVT-S6-DRAFT', '第七赛季筹备赛（草稿）', 'tournament', 'S6', 'draft',
   '尚未发布的测试赛事，普通用户不应看到。', 'TBD', 'TBD',
   now() + interval '20 days', now() + interval '22 days', now() + interval '19 days', 16, '待定', '✏️',
   (select id from public.site_users where username = 'admin')),
  ('EVT-S6-CANCEL', '已取消的表演赛',     'showmatch',   'S6', 'cancelled',
   '因故取消，仅用于验证筛选与状态展示。', '—', '5v5',
   now() + interval '1 day', now() + interval '1 day', now(), 8, '—', '🚫',
   (select id from public.site_users where username = 'organizer'))
/* 幂等：code 撞了就更新展示字段。
   注意不覆盖 status / reg_deadline / max_slots —— 重跑 seed 不该把
   管理员手工改过的状态或已产生的报名数据冲掉。 */
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  rules = excluded.rules,
  format = excluded.format,
  venue = excluded.venue,
  cover_emoji = excluded.cover_emoji,
  updated_at = now()
/* 只在标题真的变了才写：重跑 seed 不产生无意义的 UPDATE 噪音 */
where events.title is distinct from excluded.title;

-- ---------------------------------------------------------------------
-- 3. 选手花名册 + 权限/统计（每赛季同一批人）
-- ---------------------------------------------------------------------
insert into public.s6_player_ids (name, team, "group", honor)
values
  ('星野',     'Alpha',   '传奇组', 'S5 冠军'),
  ('阿澈',     'Alpha',   '传奇组', null),
  ('白露',     'Alpha',   '传奇组', null),
  ('长夜',     'Alpha',   '传奇组', null),
  ('小满',     'Alpha',   '传奇组', null),
  ('逐风',     'Bravo',   '传奇组', 'S4 冠军'),
  ('知更',     'Bravo',   '传奇组', null),
  ('拾荒者',   'Bravo',   '传奇组', null),
  ('南屿',     'Bravo',   '传奇组', null),
  ('青栀',     'Bravo',   '传奇组', null),
  ('墨鱼',     'Charlie', '中坚组', null),
  ('汽水',     'Charlie', '中坚组', null),
  ('三点几',   'Charlie', '中坚组', null),
  ('饼干',     'Charlie', '中坚组', null),
  ('小太阳',   'Charlie', '中坚组', null),
  ('风筝',     'Delta',   '中坚组', null),
  ('云雀',     'Delta',   '中坚组', null),
  ('不吃香菜', 'Delta',   '中坚组', null),
  ('阿呆',     'Delta',   '中坚组', null),
  ('奶油',     'Delta',   '中坚组', null),
  ('铁头',     'Echo',    '挑战组', null),
  ('橘子',     'Echo',    '挑战组', null),
  ('奶糖',     'Echo',    '挑战组', null),
  ('阿蛮',     'Echo',    '挑战组', null),
  ('小北',     'Echo',    '挑战组', null)
on conflict (name) do update set team = excluded.team, "group" = excluded."group";

insert into public.s6_player_stats (player_name, game_id, team, "group", pre_group, role)
select p.name, 'HW-' || (1000 + (row_number() over ())), p.team, p."group", p."group",
       case when p.name in ('星野','逐风','墨鱼','铁头') then '队长' else '队员' end
from public.s6_player_ids p
where not exists (
  select 1 from public.s6_player_stats s where s.player_name = p.name
);

-- S5 花名册沿用（第五赛季收官赛用）
insert into public.s5_player_ids (name, team, "group", honor)
select name, team, "group", honor from public.s6_player_ids
where not exists (select 1 from public.s5_player_ids s where s.name = s6_player_ids.name);

insert into public.s5_player_stats (player_name, game_id, team, "group", pre_group, role)
select player_name, game_id, team, "group", pre_group, role from public.s6_player_stats
where not exists (select 1 from public.s5_player_stats s where s.player_name = s6_player_stats.player_name);

-- ---------------------------------------------------------------------
-- 4. 赛程（已结束 / 未来 / 待定三种状态都要有）
-- ---------------------------------------------------------------------
insert into public.s6_match_schedule ("group", match_id, team_a, team_b, score_a, score_b,
                                      match_date, link, commentators)
values
  ('传奇组', 'RR-1-1', 'Alpha',   'Bravo',   13, 9,  now() - interval '3 days', 'https://example.com/replay/rr-1-1', '解说小K, 解说阿柒'),
  ('传奇组', 'RR-1-2', 'Charlie', 'Delta',   13, 11, now() - interval '2 days', 'https://example.com/replay/rr-1-2', '解说小K'),
  ('传奇组', 'RR-2-1', 'Alpha',   'Charlie', null, null, now() + interval '2 days', null, '解说阿柒, 解说小鱼'),
  ('传奇组', 'P-WB1-1', null,     null,      null, null, null, null, ''),
  ('中坚组', 'RR-1-1', 'Echo',    'Alpha',   10, 13, now() - interval '1 day',  'https://example.com/replay/mr-1-1', ''),
  ('中坚组', 'RR-1-2', 'Bravo',   'Echo',    null, null, now() + interval '3 days', null, '解说小K'),
  ('挑战组', 'RR-1-1', 'Delta',   'Bravo',   13, 7,  now() - interval '4 days', null, '解说阿柒'),
  ('挑战组', 'P-WB1-1', null,     null,      null, null, null, null, '')
on conflict ("group", match_id) do update set
  team_a = excluded.team_a,
  team_b = excluded.team_b,
  score_a = excluded.score_a,
  score_b = excluded.score_b,
  match_date = excluded.match_date,
  link = excluded.link,
  commentators = excluded.commentators;

-- S5 归档赛程（验证赛季切换）
insert into public.s5_match_schedule ("group", match_id, team_a, team_b, score_a, score_b, match_date, commentators)
values
  ('传奇组', 'F-1', 'Alpha', 'Bravo', 13, 11, now() - interval '39 days', '解说小K'),
  ('中坚组', 'F-1', 'Echo',  'Delta', 13, 9,  now() - interval '39 days', '解说阿柒')
on conflict ("group", match_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. 比赛明细（含每队 5 个位置，供数据中心 / 选手页统计）
-- ---------------------------------------------------------------------
do $$
declare
    v_alpha  bigint[];
    v_bravo  bigint[];
    v_charlie bigint[];
    v_delta  bigint[];
    v_echo   bigint[];
    v_ev     bigint;
begin
    select array_agg(id order by id) into v_alpha   from public.s6_player_ids where team = 'Alpha';
    select array_agg(id order by id) into v_bravo   from public.s6_player_ids where team = 'Bravo';
    select array_agg(id order by id) into v_charlie from public.s6_player_ids where team = 'Charlie';
    select array_agg(id order by id) into v_delta   from public.s6_player_ids where team = 'Delta';
    select array_agg(id order by id) into v_echo    from public.s6_player_ids where team = 'Echo';
    select id into v_ev from public.events where code = 'EVT-S6-01';

    if not exists (select 1 from public.s6_matches where "group" = '传奇组' and stage = '小组赛' and map = '避风港') then
        insert into public.s6_matches
        ("group", stage, match_date, map, score, team_a, team_b, event_id,
         team_a_player1_id, team_a_player2_id, team_a_player3_id, team_a_player4_id, team_a_player5_id,
         team_b_player1_id, team_b_player2_id, team_b_player3_id, team_b_player4_id, team_b_player5_id,
         team_a_player1_ch, team_a_player2_ch, team_a_player3_ch, team_a_player4_ch, team_a_player5_ch,
         team_b_player1_ch, team_b_player2_ch, team_b_player3_ch, team_b_player4_ch, team_b_player5_ch,
         team_a_player1_data, team_a_player2_data, team_a_player3_data, team_a_player4_data, team_a_player5_data,
         team_b_player1_data, team_b_player2_data, team_b_player3_data, team_b_player4_data, team_b_player5_data)
        values
        ('传奇组', '小组赛', now() - interval '3 days', '避风港', '13:9', 'Alpha', 'Bravo', v_ev,
         v_alpha[1], v_alpha[2], v_alpha[3], v_alpha[4], v_alpha[5],
         v_bravo[1], v_bravo[2], v_bravo[3], v_bravo[4], v_bravo[5],
         '一突','二突','先锋','控场','哨位','一突','二突','先锋','控场','哨位',
         '268/19/14','241/16/18','232/15/12','219/12/20','205/10/16',
         '244/17/13','228/15/15','210/12/11','198/10/14','186/8/12');
    end if;

    if not exists (select 1 from public.s6_matches where "group" = '中坚组' and stage = '小组赛' and map = '源工重镇') then
        insert into public.s6_matches
        ("group", stage, match_date, map, score, team_a, team_b, event_id,
         team_a_player1_id, team_a_player2_id, team_a_player3_id, team_a_player4_id, team_a_player5_id,
         team_b_player1_id, team_b_player2_id, team_b_player3_id, team_b_player4_id, team_b_player5_id,
         team_a_player1_ch, team_a_player2_ch, team_a_player3_ch, team_a_player4_ch, team_a_player5_ch,
         team_b_player1_ch, team_b_player2_ch, team_b_player3_ch, team_b_player4_ch, team_b_player5_ch,
         team_a_player1_data, team_a_player2_data, team_a_player3_data, team_a_player4_data, team_a_player5_data,
         team_b_player1_data, team_b_player2_data, team_b_player3_data, team_b_player4_data, team_b_player5_data)
        values
        ('中坚组', '小组赛', now() - interval '1 day', '源工重镇', '10:13', 'Echo', 'Alpha', v_ev,
         v_echo[1], v_echo[2], v_echo[3], v_echo[4], v_echo[5],
         v_alpha[1], v_alpha[2], v_alpha[3], v_alpha[4], v_alpha[5],
         '一突','二突','先锋','控场','哨位','一突','二突','先锋','控场','哨位',
         '231/16/11','214/13/15','198/11/12','186/9/14','175/8/10',
         '252/18/13','238/15/16','224/13/11','210/11/15','196/9/12');
    end if;

    if not exists (select 1 from public.s6_matches where "group" = '挑战组' and stage = '小组赛' and map = '霓虹町') then
        insert into public.s6_matches
        ("group", stage, match_date, map, score, team_a, team_b, event_id,
         team_a_player1_id, team_a_player2_id, team_a_player3_id, team_a_player4_id, team_a_player5_id,
         team_b_player1_id, team_b_player2_id, team_b_player3_id, team_b_player4_id, team_b_player5_id,
         team_a_player1_ch, team_a_player2_ch, team_a_player3_ch, team_a_player4_ch, team_a_player5_ch,
         team_b_player1_ch, team_b_player2_ch, team_b_player3_ch, team_b_player4_ch, team_b_player5_ch,
         team_a_player1_data, team_a_player2_data, team_a_player3_data, team_a_player4_data, team_a_player5_data,
         team_b_player1_data, team_b_player2_data, team_b_player3_data, team_b_player4_data, team_b_player5_data)
        values
        ('挑战组', '小组赛', now() - interval '4 days', '霓虹町', '13:7', 'Delta', 'Bravo', v_ev,
         v_delta[1], v_delta[2], v_delta[3], v_delta[4], v_delta[5],
         v_bravo[1], v_bravo[2], v_bravo[3], v_bravo[4], v_bravo[5],
         '一突','二突','先锋','控场','哨位','一突','二突','先锋','控场','哨位',
         '245/17/12','226/14/14','208/12/10','192/10/13','178/9/11',
         '219/14/12','201/12/13','187/10/10','170/8/12','158/7/9');
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. 报名（覆盖待审核 / 已通过 / 未通过 / 已撤回）
-- ---------------------------------------------------------------------
insert into public.event_registrations (event_id, user_id, team_name, members, contact, note, status, new_team)
select e.id, u.id, v.team_name, v.members::jsonb, v.contact, v.note, v.status, v.new_team
from (values
  ('alice',  'EVT-S6-02', '星野战队',   '["alice","bob"]',        '微信: alice_01',  '想和 bob 一队',          'approved', true),
  ('carol',  'EVT-S6-02', '卡罗尔',     '["carol"]',              'QQ: 100203',      '第一次参赛，求带',        'pending',  false),
  ('dave',   'EVT-S6-02', '戴夫',       '["dave"]',               '游戏内: Dave#123', null,                    'pending',  false),
  ('erina',  'EVT-S6-02', '绘里奈',     '["erina"]',              '微信: erina',     '时间可能晚到 10 分钟',    'rejected', false),
  ('frank',  'EVT-S6-02', '弗兰克',     '["frank","grace"]',      'QQ: 889900',      '和 grace 双排',          'approved', false),
  ('grace',  'EVT-S6-02', '格蕾丝',     '["grace"]',              '微信: grace',     null,                     'cancelled',false)
) as v(username, code, team_name, members, contact, note, status, new_team)
join public.events e on e.code = v.code
join public.site_users u on u.username = v.username
on conflict (event_id, user_id) do update set
  status = excluded.status,
  team_name = excluded.team_name,
  note = excluded.note;

-- 队长绑定（新建队伍审核通过后自动绑定）
insert into public.event_captains (event_id, player_name, game_id, added_by)
select e.id, v.player_name, v.game_id, 'seed'
from (values
  ('EVT-S6-01', '星野', 'HW-1001'),
  ('EVT-S6-01', '逐风', 'HW-1002'),
  ('EVT-S6-01', '墨鱼', 'HW-1003'),
  ('EVT-S6-01', '铁头', 'HW-1004')
) as v(code, player_name, game_id)
join public.events e on e.code = v.code
on conflict (event_id, player_name) do nothing;

-- ---------------------------------------------------------------------
-- 7. 竞猜（已结算场次 + 未结算场次，覆盖盈亏两种方向）
-- ---------------------------------------------------------------------
insert into public.s6_bet_bets (user_id, match_id, amount, predicted_winner)
select u.id, m.id, v.amount, v.winner
from (values
  ('alice', '传奇组', 'RR-1-1', 20, 'Alpha'),
  ('bob',   '传奇组', 'RR-1-1', 15, 'Bravo'),
  ('carol', '传奇组', 'RR-1-1', 10, 'Alpha'),
  ('dave',  '传奇组', 'RR-1-1', 30, 'Bravo'),
  ('erina', '传奇组', 'RR-1-2', 25, 'Delta'),
  ('frank', '传奇组', 'RR-1-2', 20, 'Charlie'),
  ('grace', '传奇组', 'RR-2-1', 40, 'Alpha'),
  ('henry', '传奇组', 'RR-2-1', 15, 'Charlie'),
  ('ivy',   '中坚组', 'RR-1-1', 35, 'Alpha'),
  ('jack',  '中坚组', 'RR-1-2', 10, 'Bravo'),
  ('alice', '中坚组', 'RR-1-2', 25, 'Echo'),
  ('bob',   '挑战组', 'RR-1-1', 20, 'Delta'),
  ('carol', '挑战组', 'RR-1-1', 20, 'Bravo')
) as v(username, grp, mid, amount, winner)
join public.site_users u on u.username = v.username
join public.s6_match_schedule m on m."group" = v.grp and m.match_id = v.mid
where not exists (
  select 1 from public.s6_bet_bets b
  where b.user_id = u.id and b.match_id = m.id and b.amount = v.amount
);

-- 积分流水（与 balance 大致对得上，便于验证重算）
insert into public.points_ledger (user_id, delta, balance_after, reason, operator_id, source)
select u.id, v.delta, v.after, v.reason, null, v.source
from (values
  ('alice',  100, 100, '初始积分',     'system'),
  ('alice',   40, 260, 'S5 冠军奖励',  'admin'),
  ('alice',  -50, 210, '兑换：外设礼盒','shop'),
  ('bob',    100, 100, '初始积分',     'system'),
  ('bob',    -20, 180, '兑换：鼠标垫', 'shop'),
  ('carol', -100,  80, '兑换：队服',   'shop'),
  ('dave',   100, 140, '训练赛奖励',   'admin'),
  ('erina', -100,  60, '兑换：键盘',   'shop'),
  ('frank',  100, 200, 'S5 亚军奖励',  'admin')
) as v(username, delta, after, reason, source)
join public.site_users u on u.username = v.username
where not exists (
  select 1 from public.points_ledger l where l.user_id = u.id and l.reason = v.reason
);

-- ---------------------------------------------------------------------
-- 8. 积分商店商品 + 兑换记录（覆盖售罄 / 下架 / 有条件）
-- ---------------------------------------------------------------------
insert into public.goods (title, description, stock, cost, conditions, status, created_by)
values
  ('定制鼠标垫', '官方周边，320×270mm，锁边工艺。', 12, 50,
   '[{"type":"reg_min","conn":"and","value":1}]'::jsonb, 'active',
   (select id from public.site_users where username = 'organizer')),
  ('队服外套', 'S6 赛季队服，码数 S-XXL，兑换后请联系组织者。', 3, 180,
   '[{"type":"reg_min","conn":"and","value":3},{"type":"balance_min","conn":"and","value":150}]'::jsonb, 'active',
   (select id from public.site_users where username = 'organizer')),
  ('机械键盘', '87 键热插拔，红轴。', 0, 300,
   '[{"type":"match_min","conn":"and","value":5}]'::jsonb, 'active',
   (select id from public.site_users where username = 'admin')),
  ('外设礼盒', '鼠标 + 耳机 + 桌垫套装。', 5, 260, '[]'::jsonb, 'active',
   (select id from public.site_users where username = 'admin')),
  ('冠军纪念杯', 'S5 冠军纪念，限量。', 2, 500,
   '[{"type":"reg_min","conn":"and","value":5}]'::jsonb, 'draft',
   (select id from public.site_users where username = 'admin'))
on conflict do nothing;

insert into public.goods_redemptions (goods_id, user_id, cost)
select g.id, u.id, g.cost
from (values
  ('alice', '外设礼盒'),
  ('bob',   '定制鼠标垫'),
  ('carol', '队服外套'),
  ('erina', '机械键盘'),
  ('frank', '定制鼠标垫'),
  ('grace', '定制鼠标垫')
) as v(username, title)
join public.goods g on g.title = v.title
join public.site_users u on u.username = v.username
where not exists (
  select 1 from public.goods_redemptions r where r.goods_id = g.id and r.user_id = u.id
);

-- ---------------------------------------------------------------------
-- 9. 通知 / 组织者申请 / 封禁（验证铃铛与权限链路）
-- ---------------------------------------------------------------------
insert into public.notifications (user_id, title, body, link, read)
select u.id, v.title, v.body, v.link, v.read
from (values
  ('alice', '报名已通过', '你在「第六赛季新人训练赛」的报名已通过。', 'register.html', true),
  ('alice', '赛程提醒',   '你关注的 Alpha vs Bravo 将于 2 天后开赛。', 'schedule.html', false),
  ('carol', '报名待审核', '你的报名正在等待管理员审核。', 'register.html', false),
  ('erina', '报名未通过', '很遗憾，本次报名未通过，可查看原因后重新报名。', 'register.html', true),
  ('grace', '比赛提醒',   '你报名的比赛即将开始，请提前 10 分钟入场。', 'schedule.html', false),
  ('frank', '积分到账',   'S5 亚军奖励 100 积分已到账。', 'index.html', true)
) as v(username, title, body, link, read)
join public.site_users u on u.username = v.username
where not exists (
  select 1 from public.notifications n where n.user_id = u.id and n.title = v.title and n.body = v.body
);

insert into public.organizer_requests (user_id, reason, status)
select u.id, v.reason, v.status
from (values
  ('frank',  '希望组织线下训练赛，有场地资源。', 'pending'),
  ('grace',  '有赛事运营经验，申请组织者权限。', 'approved'),
  ('henry',  '测试申请，可驳回。', 'rejected')
) as v(username, reason, status)
join public.site_users u on u.username = v.username
where not exists (
  select 1 from public.organizer_requests o where o.user_id = u.id and o.reason = v.reason
);

insert into public.event_bans (event_id, user_id, reason, until)
select e.id, u.id, '测试封禁（seed）', now() + interval '7 days'
from public.events e, public.site_users u
where e.code = 'EVT-S6-02' and u.username = 'henry'
  and not exists (
    select 1 from public.event_bans b where b.event_id = e.id and b.user_id = u.id
  );

-- ---------------------------------------------------------------------
-- 10. 报名资料（数据中心 / 审核页的完整度）
-- ---------------------------------------------------------------------
insert into public.reg_profiles (user_id, game_id, real_name, staff_no, positions, cur_rank, cur_acs, cur_kda, cur_kast, cur_adr, playtime, shots_verified)
select u.id, v.game_id, v.real_name, v.staff_no, v.positions, v.cur_rank, v.cur_acs, v.cur_kda, v.cur_kast, v.cur_adr, v.playtime, v.verified
from (values
  ('alice', 'HW-1001', '李知恩', 'S2019', '一突,二突', '超凡入圣', '268', '1.42', '78%', '158', '2100 小时', true),
  ('bob',   'HW-1002', '王振',   'S2020', '控场',     '不朽三',   '241', '1.21', '74%', '149', '1600 小时', true),
  ('carol', 'HW-1003', '陈曦',   'S2021', '哨位',     '钻石一',   '232', '1.10', '71%', '141', '900 小时',  false),
  ('dave',  'HW-1004', '刘畅',   'S2022', '先锋',     '超凡入圣', '252', '1.35', '77%', '154', '2300 小时', true),
  ('erina', 'HW-1005', '林绘里', 'S2023', '二突',     '铂金二',   '205', '0.98', '66%', '132', '400 小时',  false),
  ('frank', 'HW-1006', '周明',   'S2024', '一突',     '神话',     '281', '1.51', '81%', '166', '3100 小时', true)
) as v(username, game_id, real_name, staff_no, positions, cur_rank, cur_acs, cur_kda, cur_kast, cur_adr, playtime, verified)
join public.site_users u on u.username = v.username
on conflict (user_id) do update set
  real_name = excluded.real_name,
  staff_no = excluded.staff_no,
  positions = excluded.positions,
  cur_rank = excluded.cur_rank,
  cur_acs = excluded.cur_acs;


-- =====================================================================
-- 验证：
--   select count(*) from site_users;                       -- 12
--   select status, count(*) from events group by status;   -- 5 种状态
--   select "group", match_id, score_a, score_b from s6_match_schedule;
--   select u.username, count(*) from s6_bet_bets b join site_users u on u.id=b.user_id group by 1;
--   select * from recalc_balance((select id from site_users where username='alice'));
-- =====================================================================

-- ── 以下为原 bootstrap.sql 第 ⑩ 节测试数据 ──
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
  where not exists (
      select 1 from public.events e where e.code = v.code or e.title = v.title
  );
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

-- ⑩-10 竞猜：组别状态 + 下注 + 低保领取
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

exception when others then raise notice '⑩-10 竞猜数据 跳过: %', sqlerrm; end $$;

-- ─────────────────────────────────────────────────────────────
-- ⑪ 选手页测试数据：让「测试·苍穹1号」有足够多的数据可测
--    原来他只有 1 场比赛、0 个荣誉 —— 生涯趋势、雷达图、荣誉墙都测不出来。
--    这里补到 5 场（跨组别，用来验证生涯合并）+ 4 枚荣誉（带活动归属与详情）。
--    全部幂等：按 (group, stage, map, team_a, team_b) 判重，重复跑不会翻倍。
-- ─────────────────────────────────────────────────────────────
do $$
declare
    v_p1 bigint; v_p2 bigint; v_p3 bigint; v_p4 bigint; v_p5 bigint;
    v_o1 bigint; v_o2 bigint; v_o3 bigint; v_o4 bigint; v_o5 bigint;
    v_ev1 bigint; v_ev2 bigint;
    v_src record;
begin
    select id into v_p1 from public.s6_player_ids where name = '测试·苍穹1号';
    select id into v_p2 from public.s6_player_ids where name = '测试·苍穹2号';
    select id into v_p3 from public.s6_player_ids where name = '测试·苍穹3号';
    select id into v_p4 from public.s6_player_ids where name = '测试·苍穹4号';
    select id into v_p5 from public.s6_player_ids where name = '测试·烈焰1号';
    select id into v_o1 from public.s6_player_ids where name = '测试·烈焰2号';
    select id into v_o2 from public.s6_player_ids where name = '测试·烈焰3号';
    select id into v_o3 from public.s6_player_ids where name = '测试·雷霆1号';
    select id into v_o4 from public.s6_player_ids where name = '测试·雷霆2号';
    select id into v_o5 from public.s6_player_ids where name = '测试·雷霆3号';
    select id into v_ev1 from public.events where code = 'EVT-S6-01';
    select id into v_ev2 from public.events where code = 'EVT-S6-02';

    /* 只有关键选手都存在时才补，避免插入一堆指向 null 的脏行 */
    if v_p1 is not null and v_p2 is not null and v_o1 is not null then
        for v_src in
            select * from (values
                /* 组别, 阶段, 距今, 地图, 比分, 我方队, 敌方队, 我方数据(A), 敌方数据(B) */
                ('传奇组','四分之一决赛', 12, '亚海悬城',  '13:7',  '苍穹队','雷霆队',
                 array['289/22/13/6','241/17/19/8','225/15/11/12','198/12/16/7','176/9/14/9'],
                 array['211/15/17/5','205/14/16/6','188/12/18/4','170/11/15/5','152/8/13/7']),
                ('传奇组','半决赛',        8, '莲华古城',  '11:13','苍穹队','烈焰队',
                 array['256/19/21/4','233/16/15/9','219/14/12/14','187/11/19/6','165/9/17/5'],
                 array['268/20/14/7','249/18/13/11','231/16/15/8','203/13/17/6','181/10/14/9']),
                ('传奇组','总决赛',        5, '隐世修所',  '13:11','苍穹队','烈焰队',
                 array['301/24/11/7','262/19/17/10','238/15/13/15','206/13/18/8','179/10/15/11'],
                 array['275/21/16/6','251/18/15/9','224/15/17/7','196/12/19/5','172/9/16/8']),
                ('挑战组','小组赛',        3, '极地寒港',  '13:4',  '苍穹队','雷霆队',
                 array['312/26/9/5','244/18/13/6','221/15/10/13','192/12/14/9','168/9/12/11'],
                 array['182/12/18/4','171/10/16/6','158/9/17/3','144/8/15/5','131/6/13/6'])
            ) as t(grp, stg, ago, mp, sc, ta, tb, da, db)
        loop
            if not exists (
                select 1 from public.s6_matches m
                 where m."group" = v_src.grp and m.stage = v_src.stg
                   and m.map = v_src.mp and m.team_a = v_src.ta and m.team_b = v_src.tb
            ) then
                insert into public.s6_matches
                    ("group", stage, match_date, map, score,
                     team_a, team_b, event_id,
                     team_a_player1_id, team_a_player2_id, team_a_player3_id,
                     team_a_player4_id, team_a_player5_id,
                     team_b_player1_id, team_b_player2_id, team_b_player3_id,
                     team_b_player4_id, team_b_player5_id,
                     team_a_player1_ch, team_a_player2_ch, team_a_player3_ch,
                     team_a_player4_ch, team_a_player5_ch,
                     team_b_player1_ch, team_b_player2_ch, team_b_player3_ch,
                     team_b_player4_ch, team_b_player5_ch,
                     team_a_player1_data, team_a_player2_data, team_a_player3_data,
                     team_a_player4_data, team_a_player5_data,
                     team_b_player1_data, team_b_player2_data, team_b_player3_data,
                     team_b_player4_data, team_b_player5_data)
                values
                    (v_src.grp, v_src.stg, now() - (v_src.ago || ' days')::interval,
                     v_src.mp, v_src.sc,
                     v_src.ta, v_src.tb, v_ev1,
                     v_p1, v_p2, v_p3, v_p4, v_p5,
                     v_o1, v_o2, v_o3, v_o4, v_o5,
                     '捷风','猎枭','炼狱','幽影','零',
                     '雷兹','斯凯','夜露','贤者','铁臂',
                     v_src.da[1], v_src.da[2], v_src.da[3], v_src.da[4], v_src.da[5],
                     v_src.db[1], v_src.db[2], v_src.db[3], v_src.db[4], v_src.db[5]);
            end if;
        end loop;

        /* 荣誉：4 枚，覆盖"有活动归属 + 有详情"与"无活动归属"两种情况 */
        for v_src in
            select * from (values
                ('S6 总决赛 MVP', '总决赛 24/11/7，带领苍穹队 13:11 拿下决胜图。', 5,  v_ev1),
                ('S6 单场最高 ACS', '单场 312 ACS，本赛季联赛纪录。',              3,  v_ev1),
                ('S6 最佳指挥',     '（无活动归属的荣誉样式验证）',                  20, null::bigint),
                ('S6 新人王',       '赛季前半程表现最突出的新人。',                  30, v_ev2)
            ) as t(ttl, descr, ago, evid)
        loop
            if not exists (
                select 1 from public.player_honors h
                 where h.player_name = '测试·苍穹1号' and h.title = v_src.ttl
            ) then
                insert into public.player_honors
                    (player_name, game_id, event_id, title, description, awarded_at)
                values
                    ('测试·苍穹1号', 'TESTER#001', v_src.evid, v_src.ttl,
                     v_src.descr, (now() - (v_src.ago || ' days')::interval)::date);
            end if;
        end loop;
    end if;
exception when others then
    raise notice '⑪ 选手页测试数据 跳过: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────
do $$ begin
  raise notice '✅ 引导完成：若上方无「…跳过」 NOTICE，全部表与测试数据已就绪。';
end $$;

commit;
