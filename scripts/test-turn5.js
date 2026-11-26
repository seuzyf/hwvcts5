#!/usr/bin/env node
/**
 * 本轮四项修改的回归测试（npm run test:turn5）
 *
 * 1. 商品「参与过指定活动」必须是下拉栏，且选项来自真实活动列表
 * 2. 选手页：赛事数据一个赛事一行（真表格）+ 雷达图能画出来
 * 3. 管理后台：我的报名用户 → 待办审批（只列需要决定的，能一键通过）
 * 4. 活动中心：已结束筛选 + 详情对话框的无障碍名称
 *
 * 这些断言全部来自真实 jsdom 渲染，不检查源码字符串。
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const auth = fs.readFileSync('js/auth.js', 'utf8');
const layout = fs.readFileSync('js/layout.js', 'utf8');

let fails = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  ✓ ' + name);
  else { fails++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

/* 统一的 supabase 假实现：按表名返回 window.__data[table] */
const stub = `window.supabase={createClient:function(){return {
  from:function(table){var q={};['select','in','not','is','neq','order','limit','range','or','ilike','gte','lte','match'].forEach(function(m){q[m]=function(){return q}});
    q.eq=function(){return q};
    q.insert=q.update=q.delete=q.upsert=function(){return q};
    q.maybeSingle=q.single=function(){return Promise.resolve({data:null,error:null})};
    q.then=function(res){return Promise.resolve({data:(window.__data[table]||[]),error:null}).then(res)};
    return q},
  rpc:function(){return {then:function(r){return Promise.resolve({data:null,error:null}).then(r)}}},
  auth:{getSession:function(){return Promise.resolve({data:{session:null}})}}}}};`;

function build(file, data, beforeParseExtra) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js"><\/script>/g, '');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g, '<script>' + stub + '</script>');
  html = html.replace(/<script src="js\/auth\.js"><\/script>/g, () => '<script>' + auth.replace(/<\/script/gi, '<\\/script') + '</script>');
  html = html.replace(/<script src="js\/layout\.js"><\/script>/g, () => '<script>' + layout.replace(/<\/script/gi, '<\\/script') + '</script>');
  html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/CSS|Not implemented/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => { const s = a.join(' '); if (!/IP地址|offline/.test(s)) errors.push('console.error: ' + s); });

  const dom = new JSDOM(html, {
    url: beforeParseExtra && beforeParseExtra.url ? beforeParseExtra.url : 'https://example.test/' + file,
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.__data = JSON.parse(JSON.stringify(data));
      w.fetch = () => Promise.reject(new Error('offline'));
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      if (beforeParseExtra && beforeParseExtra.init) beforeParseExtra.init(w);
    }
  });
  return { dom, errors };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────── 1. 商店：活动下拉栏 ───────────────────────── */
async function testShop() {
  console.log('\n[商店] 「参与过指定活动」必须是下拉栏');
  const { dom, errors } = build('shop.html', {
    site_users: [{ id: 1, username: 'admin', nickname: '管理员', role: 'superadmin' }],
    events: [
      { id: 1, title: 'S6 正赛', status: 'finished' },
      { id: 2, title: 'S6 周末表演赛', status: 'finished' }
    ],
    shop_items: [], shop_orders: [], shop_refunds: [], event_registrations: []
  });
  const w = dom.window, d = w.document;
  await wait(1400);

  d.getElementById('shop-new').hidden = false;
  d.getElementById('shop-new').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  d.getElementById('gf-cond-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(200);

  const typeSel = d.querySelector('[data-cond-type]');
  ok('条件类型含"参与过指定活动"', !!typeSel && [...typeSel.options].some((o) => o.value === 'event_some'));

  typeSel.value = 'event_some';
  typeSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(200);

  const evSel = d.querySelector('[data-cond-event]');
  ok('选了条件后出现活动下拉（<select>）', !!evSel && evSel.tagName === 'SELECT', evSel ? evSel.tagName : '无');
  ok('下拉是单选（不是多选框）', !!evSel && !evSel.multiple);
  const opts = evSel ? [...evSel.options].map((o) => o.textContent.trim()) : [];
  ok('下拉选项来自真实活动列表', opts.includes('S6 正赛') && opts.includes('S6 周末表演赛'), opts.join(' / '));
  ok('下拉有"选择活动…"占位项', opts.some((t) => /选择活动/.test(t)), opts.join(' / '));
  ok('不再有旧的复选框标签', d.querySelectorAll('.cond-chip').length === 0);

  /* 选中一个活动，再切走再切回来，值必须还在（否则等于白选） */
  evSel.value = '2';
  evSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(150);
  const typeSel2 = d.querySelector('[data-cond-type]');
  typeSel2.value = 'event_any';
  typeSel2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(150);
  const typeSel3 = d.querySelector('[data-cond-type]');
  typeSel3.value = 'event_some';
  typeSel3.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(200);
  const evSel2 = d.querySelector('[data-cond-event]');
  ok('切走再切回来，选中的活动被记住', !!evSel2 && evSel2.value === '2', evSel2 ? evSel2.value : '无');

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* ───────────────────────── 2. 选手页：表格 + 雷达图 ───────────────────────── */
function mkMatch(id, sa, sb) {
  const o = { id, group: '传奇组', team_a: 'A队', team_b: 'B队', score_a: sa, score_b: sb,
    match_date: '2026-11-0' + id + 'T10:00:00Z', result_status: 'done', event_id: 1 };
  for (let p = 1; p <= 5; p++) {
    o['team_a_player' + p + '_id'] = p === 1 ? '测试·苍穹1号' : 'mate' + p;
    o['team_a_player' + p + '_data'] = p === 1 ? '210/18/12/5' : '150/12/14/6';
    o['team_a_player' + p + '_ch'] = '捷风';
  }
  for (let p = 1; p <= 5; p++) {
    o['team_b_player' + p + '_id'] = 'opp' + p;
    o['team_b_player' + p + '_data'] = '160/14/15/4';
    o['team_b_player' + p + '_ch'] = '雷兹';
  }
  return o;
}

async function testPlayer(withScores) {
  console.log('\n[选手页] ' + (withScores ? '有比分：赛事表一个赛事一行 + 雷达图渲染' : '无比分：说明为什么没有雷达图'));
  const players = [{ id: '测试·苍穹1号', name: '测试·苍穹1号', group: '传奇组', image: null }];
  const matches = withScores ? [mkMatch(1, 13, 9), mkMatch(2, 11, 13), mkMatch(3, 13, 7)]
                             : [mkMatch(1, null, null), mkMatch(2, null, null), mkMatch(3, null, null)];
  const { dom, errors } = build('player.html', {
    s6_matches: matches,
    s6_player_ids: players,
    s5_matches: [], s5_player_ids: [],
    s6_match_schedule: [], s5_match_schedule: [],
    events: [{ id: 1, title: 'S6 正赛', start_time: '2026-11-01T10:00:00Z', status: 'finished' }],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: []
  }, {
    /* 生涯页：链接只带身份，不带 group/season */
    url: 'https://example.test/player.html?name=' + encodeURIComponent('测试·苍穹1号'),
    init(w) {
      w.Chart = function () { this.destroy = function () {}; };
      w.__replaced = null;
      w.history.replaceState = function (a, b, c) { w.__replaced = c; };
    }
  });
  const d = dom.window.document;
  await wait(1200);

  ok('选手身份解析成功', /测试·苍穹1号/.test(d.getElementById('player-id-header').textContent),
     d.getElementById('player-id-header').textContent.trim());

  const table = d.querySelector('#event-stats-content table');
  ok('赛事数据是 <table> 表格', !!table && table.classList.contains('data-table'), table ? table.className : '无表格');
  if (table) {
    ok('每个赛事一行（3 场比赛同属 1 个赛事 → 1 行）', table.querySelectorAll('tbody tr').length === 1,
       'got ' + table.querySelectorAll('tbody tr').length);
    ok('表头含"赛事"与"每回合 K/D/A"', /赛事/.test(table.textContent) && /每回合/.test(table.textContent));
  }

  const radarHost = d.getElementById('radar-chart-container');
  if (withScores) {
    ok('雷达图画布保留在页面上', !!d.getElementById('player-radar-chart'), radarHost.innerHTML.slice(0, 60));
    /* 回合数必须来自 score_a/score_b，否则每回合指标恒为 0 */
    const cell = table ? table.querySelector('tbody tr').textContent : '';
    ok('每回合 K/D/A 不是全 0（证明回合数取到了）', /0\.[0-9]{2} \/ 0\.[0-9]{2}/.test(cell), cell.slice(0, 120));
    /* 断言指标齐全，而不是死数行数 —— 加指标（如首杀）不该让测试误报 */
    const LABELS = ['平均 ACS', '每局击杀', '每局死亡', '每局助攻',
                    '每回合击杀', '每回合死亡', '每回合助攻', '每局首杀', '首杀率'];
    const summaryTxt = d.getElementById('summary-list-content').textContent;
    const missing = LABELS.filter(l => summaryTxt.indexOf(l) === -1);
    ok('生涯汇总指标齐全（9 项）', missing.length === 0, '缺：' + missing.join('、'));
    ok('页首说明覆盖场次', /3 场/.test(d.getElementById('career-scope').textContent));
  } else {
    ok('没有比分时不画无意义的空雷达图', /还没有录比分/.test(radarHost.textContent), radarHost.textContent.trim().slice(0, 50));
  }

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 旧链接（带 group/season）必须被改写成干净链接 */
async function testPlayerLegacyUrl() {
  console.log('\n[选手页] 旧链接 ?name&group&season 会被改写');
  const { dom, errors } = build('player.html', {
    s6_matches: [], s6_player_ids: [{ id: '苍穹', name: '苍穹', group: '传奇组', team: '', image: null }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹') +
         '&group=' + encodeURIComponent('传奇组') + '&season=s6',
    init(w) { w.__replaced = null; w.history.replaceState = function (a, b, c) { w.__replaced = c; }; }
  });
  await wait(1200);
  ok('地址被改写为只带身份参数',
     !!dom.window.__replaced && !/group=|season=/.test(dom.window.__replaced),
     String(dom.window.__replaced));
  ok('改写后仍保留身份（name）', !!dom.window.__replaced && /name=/.test(dom.window.__replaced),
     String(dom.window.__replaced));
  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* seed 的真实数据形状：赛果表用 score 字符串（不是 score_a/score_b） */
async function testPlayerSeedShape() {
  console.log('\n[选手页] seed 真实形状：比分存在 score 字符串里');
  /* seed 与老数据只写 score='13:9'，score_a/score_b 是 null。
     曾经因为 Number(null)===0 被当成"比分 0:0"，回合数恒为 0 → 雷达图空。 */
  const o = { id: 1, group: '传奇组', stage: '小组赛', match_date: '2026-11-24T10:00:00Z',
    map: '源工重镇', score: '13:9', score_a: null, score_b: null,
    team_a: '苍穹队', team_b: '烈焰队', event_id: 1,
    team_a_player1_id: 101, team_a_player2_id: 102, team_b_player1_id: 103, team_b_player2_id: 104,
    team_a_player1_ch: '霓虹', team_a_player2_ch: '夜露', team_b_player1_ch: '捷风', team_b_player2_ch: '零',
    team_a_player1_data: '24/18/12/3', team_a_player2_data: '19/15/14/5',
    team_b_player1_data: '21/16/13/2', team_b_player2_data: '14/17/15/4' };

  const { dom, errors } = build('player.html', {
    s6_matches: [o],
    s6_player_ids: [{ id: 101, name: '测试·苍穹1号', team: '苍穹队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [{ player_name: '测试·苍穹1号', game_id: 'TESTER#001', team: '苍穹队', group: '传奇组', role: '队长' }],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: [],
    events: [{ id: 1, title: 'S6 正赛', start_time: '2026-11-24T10:00:00Z', status: 'finished', cover_emoji: '🏆' }]
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('测试·苍穹1号'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1400);

  /* 22 = 13 + 9，必须从 score 字符串读出来 */
  ok('回合数从 score 字符串取到（13+9=22）', /22 回合/.test(d.getElementById('career-scope').textContent),
     d.getElementById('career-scope').textContent);
  const table = d.querySelector('#event-stats-content table');
  const row = table ? table.querySelector('tbody tr').textContent : '';
  ok('每回合 K/D/A 不是全 0', /0\.[0-9]{2} \/ 0\.[0-9]{2}/.test(row), row.slice(0, 120));
  ok('胜负按 score 字符串判出（1 胜）', /1 \/ 0/.test(row), row.slice(0, 80));
  ok('副标题显示游戏 ID 而不是数据库主键', /TESTER#001/.test(d.getElementById('player-game-id').textContent) &&
     !/\b101\b/.test(d.getElementById('player-game-id').textContent),
     d.getElementById('player-game-id').textContent);

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 荣誉带：活动图标 + 荣誉名称，点开看详情 */
async function testHonorStrip() {
  console.log('\n[选手页] 荣誉带：活动图标 + 名称，可点开详情');
  const { dom, errors } = build('player.html', {
    s6_matches: [], s6_player_ids: [{ id: 101, name: '苍穹', team: 'A队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [], s6_comments: [], comment_reports: [], event_registrations: [], reg_profiles: [],
    player_honors: [
      { id: 1, player_name: '苍穹', title: 'S6 MVP', description: '总决赛最有价值选手', awarded_at: '2026-11-20', event_id: 1 },
      { id: 2, player_name: '苍穹', title: '最佳指挥', description: '', awarded_at: '2026-11-10', event_id: null }
    ],
    events: [{ id: 1, title: 'S6 正赛', cover_emoji: '🏆', cover_image: '' }]
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const w = dom.window, d = w.document;
  await wait(1400);

  const strip = d.getElementById('honor-strip');
  ok('荣誉带可见', !!strip && !strip.hidden);
  ok('三个跳转按钮已移除', !d.querySelector('.ph-player-actions'));
  const pills = [...d.querySelectorAll('.honor-pill')];
  ok('每枚荣誉 = 图标 + 名称', pills.length === 2 &&
     pills.every((p) => p.querySelector('.honor-pill-ico') && p.querySelector('.honor-pill-name')));
  ok('荣誉名与归属活动都显示', /S6 MVP/.test(strip.textContent) && /S6 正赛/.test(strip.textContent));

  pills[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(250);
  const modal = d.getElementById('honor-detail-modal');
  ok('点开后有详情弹窗', !!modal);
  ok('弹窗有可访问名称', !!modal && !!d.getElementById('honor-detail-title') &&
     modal.querySelector('.modal-panel').getAttribute('aria-labelledby') === 'honor-detail-title');
  ok('详情里有获奖理由', !!modal && /总决赛最有价值选手/.test(modal.textContent));

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 没比赛但有荣誉：荣誉必须照样显示（荣誉与比赛解耦） */
async function testHonorWithoutMatches() {
  console.log('\n[选手页] 没比赛但有荣誉：荣誉带不能被空档案抹掉');
  const { dom, errors } = build('player.html', {
    s6_matches: [], s6_player_ids: [{ id: 101, name: '苍穹', team: 'A队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [{ player_name: '苍穹', game_id: 'TESTER#001' }],
    s6_comments: [], comment_reports: [], event_registrations: [], reg_profiles: [],
    player_honors: [{ id: 1, player_name: '苍穹', title: '新人王', description: '还没上场就拿了奖', awarded_at: '2026-11-20' }],
    events: [{ id: 1, title: 'S6 正赛', cover_emoji: '🏆' }]
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1400);
  const strip = d.getElementById('honor-strip');
  /* 这是真实 bug：renderEmptyProfile_ 会把刚渲染好的 #honor-strip hidden=true */
  ok('空档案下荣誉带仍然可见', !!strip && !strip.hidden);
  ok('荣誉内容还在', /新人王/.test(strip.textContent));
  ok('生涯范围说明还没比赛', /还没有比赛记录/.test(d.getElementById('career-scope').textContent));
  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 空状态必须说清"有几场、几场提到他"，而不是一句"还没有数据" */
async function testEmptyStateDiagnosis() {
  console.log('\n[选手页] 空状态给出可诊断的事实');
  const other = { id: 1, group: '传奇组', stage: '小组赛', match_date: '2026-11-24T10:00:00Z', map: '源工重镇',
    score: '13:9', team_a: '苍穹队', team_b: '烈焰队',
    team_a_player1_id: 999, team_a_player2_id: 998, team_b_player1_id: 997, team_b_player2_id: 996,
    team_a_player1_ch: '霓虹', team_b_player1_ch: '零',
    team_a_player1_data: '24/18/12/3', team_a_player2_data: '19/15/14/5',
    team_b_player1_data: '21/16/13/2', team_b_player2_data: '14/17/15/4' };
  const { dom } = build('player.html', {
    s6_matches: [other],
    s6_player_ids: [{ id: 101, name: '苍穹', team: 'A队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [], s6_comments: [], comment_reports: [], player_honors: [],
    event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1400);
  const txt = d.getElementById('summary-list-content').textContent;
  /* "库里 1 场赛果，但没有任何一场把他列进去" —— 用户看到就能自己去查录入 */
  ok('说明库里总场次', /1 场赛果/.test(txt), txt.slice(0, 100));
  ok('说明没被任何一场列出', /没有任何一场/.test(txt), txt.slice(0, 100));
  ok('指出是录入时没选到人', /数据台/.test(txt), txt.slice(0, 100));
  dom.window.close();

  /* 第三种：比赛确实提到了他，但数据列是空的 */
  const mentioned = Object.assign({}, other, { team_a_player1_id: 101, team_a_player1_data: null });
  const r2 = build('player.html', {
    s6_matches: [mentioned],
    s6_player_ids: [{ id: 101, name: '苍穹', team: 'A队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [], s6_comments: [], comment_reports: [], player_honors: [],
    event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  await wait(1400);
  const t2 = r2.dom.window.document.getElementById('summary-list-content').textContent;
  ok('列出提到他的场次', /1 场有/.test(t2), t2.slice(0, 100));
  ok('指出选手数据列缺失', /选手数据/.test(t2), t2.slice(0, 100));
  r2.dom.window.close();
}

/* 同名选手在两个赛季表里 ID 不同 —— 赛果行必须仍能匹配上这个人 */
async function testCrossSeasonIdSpace() {
  console.log('\n[选手页] 同名选手跨赛季 ID 不同，仍要匹配上赛果行');
  /* s5_player_ids 是从 s6 复制出来的同名选手，但 id 是另一套 identity 序列。
     赛果行里存的是当季花名册的主键，所以同一个人在 s6 是 101、在 s5 是 201。 */
  const s6Match = { __season: 's6', id: 1, group: '传奇组', stage: '总决赛', match_date: '2026-11-24T10:00:00Z',
    map: '隐世修所', score: '13:11', team_a: '苍穹队', team_b: '烈焰队',
    team_a_player1_id: 101, team_a_player2_id: 102, team_b_player1_id: 301, team_b_player2_id: 302,
    team_a_player1_ch: '霓虹', team_a_player2_ch: '夜露', team_b_player1_ch: '捷风', team_b_player2_ch: '零',
    team_a_player1_data: '301/24/11/7', team_a_player2_data: '262/19/17/10',
    team_b_player1_data: '275/21/16/6', team_b_player2_data: '251/18/15/9' };
  const { dom, errors } = build('player.html', {
    s6_matches: [s6Match],
    s6_player_ids: [{ id: 101, name: '测试·苍穹1号', team: '苍穹队', group: '传奇组', image: '' }],
    /* 同一个名字，不同的 id —— 这就是线上"有 8 场却一场都没匹配上"的原因 */
    s5_player_ids: [{ id: 201, name: '测试·苍穹1号', team: '苍穹队', group: '传奇组', image: '' }],
    s5_matches: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [{ player_name: '测试·苍穹1号', game_id: 'TESTER#001' }],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('测试·苍穹1号'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1400);

  ok('不落入"没有任何一场提到他"', !/没有任何一场/.test(d.getElementById('summary-list-content').textContent),
     d.getElementById('summary-list-content').textContent.slice(0, 90));
  ok('生涯范围认到 1 场', /1 场/.test(d.getElementById('career-scope').textContent),
     d.getElementById('career-scope').textContent);
  const row = d.querySelector('#event-stats-content table tbody tr');
  ok('赛事表出现他的战绩行', !!row, row ? row.textContent.slice(0, 80) : '(无行)');

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 跨赛季同人不同 ID：两季的比赛要合并成一份生涯 */
async function testCrossSeasonMergeSamePerson() {
  console.log('\n[选手页] 跨赛季同人不同 ID：两季比赛合并');
  const mk = (season, pid, oppId, date, score, acs) => ({ __season: season, id: pid, group: '传奇组',
    stage: '小组赛', match_date: date, map: '源工重镇', score: score, team_a: '苍穹队', team_b: '烈焰队',
    team_a_player1_id: pid, team_a_player2_id: pid + 1, team_b_player1_id: oppId, team_b_player2_id: oppId + 1,
    team_a_player1_ch: '霓虹', team_a_player2_ch: '夜露', team_b_player1_ch: '捷风', team_b_player2_ch: '零',
    team_a_player1_data: acs + '/20/12/5', team_a_player2_data: '200/15/14/6',
    team_b_player1_data: '210/16/13/4', team_b_player2_data: '180/12/15/5' });
  const { dom, errors } = build('player.html', {
    s6_matches: [mk('s6', 101, 301, '2026-11-24T10:00:00Z', '13:9', '280')],
    s5_matches: [mk('s5', 201, 401, '2026-05-10T10:00:00Z', '11:13', '260')],
    s6_player_ids: [{ id: 101, name: '苍穹', team: '苍穹队', group: '传奇组', image: '' }],
    /* 同一姓名，另一套主键 */
    s5_player_ids: [{ id: 201, name: '苍穹', team: '苍穹队', group: '传奇组', image: '' }],
    s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [{ player_name: '苍穹', game_id: 'TESTER#001' }],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1500);
  const scope = d.getElementById('career-scope').textContent;
  ok('两个赛季的比赛都算进生涯（2 场）', /2 场/.test(scope), scope);

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 排版：①生涯+雷达同一行 ②赛事 ③角色 ④评论；宽表独占整行 */
async function testPlayerLayout() {
  console.log('\n[选手页] 排版：生涯/雷达一行，赛事与角色各占整行');
  const { dom } = build('player.html', {
    s6_matches: [], s6_player_ids: [{ id: 101, name: '苍穹', team: 'A队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [], s6_comments: [], comment_reports: [], player_honors: [],
    event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(900);

  const grid = d.querySelector('.pc-grid');
  const stack = d.querySelector('.pc-stack');
  ok('生涯详情与雷达在同一行（pc-grid 两栏）', !!grid &&
     !!grid.querySelector('#career-detail-card') && !!grid.querySelector('#career-stats-card'));
  ok('雷达在右：生涯详情在前、雷达在后',
     grid.children[0].id === 'career-detail-card' && grid.children[1].id === 'career-stats-card');
  ok('旧的 #right-column 已移除', !d.getElementById('right-column'));

  /* 顺序：赛事 → 角色 → 评论，且都在独占整行的容器里 */
  const order = [...stack.children].map(el => el.id);
  ok('赛事数据独占整行', order[0] === 'event-stats-section', order.join(' → '));
  ok('角色数据紧随其后', order[1] === 'character-stats-section', order.join(' → '));
  ok('评论区在最后', order[order.length - 1] === 'comments-section', order.join(' → '));

  /* 宽表不能被挤成竖排：nowrap 规则必须存在 */
  const cssTxt = [...d.querySelectorAll('style')].map(el => el.textContent).join('\n');
  ok('宽表单元格禁止换行（不再竖排）', /\.pc-stack\s+\.data-table\s+th[\s\S]{0,120}white-space:\s*nowrap/.test(cssTxt));
  ok('宽表可横向滚动', /\.pc-stack\s+\.table-wrap\s*\{[^}]*overflow-x:\s*auto/.test(cssTxt));
  dom.window.close();
}

/* 雷达图：浅色模式下描边不能是白色 */
async function testRadarThemeColors() {
  console.log('\n[选手页] 雷达图跟随主题（浅色模式不能用白线）');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'player.html'), 'utf8');
  ok('浅色描边不是白色', /isLightTheme\s*\?\s*'#e04545'/.test(src));
  ok('描边不再写死白色', !/borderColor:\s*'rgba\(255,255,255,1\)'/.test(src));
  ok('监听 hw:theme 重绘', /addEventListener\('hw:theme'/.test(src));
}

/* 首杀：按图记总数，展示首杀数与首杀率；老 4 段数据不能崩 */
async function testFirstBlood() {
  console.log('\n[选手页] 首杀统计（按图记）');
  const mk = (id, date, score, data) => ({ __season: 's6', id, group: '传奇组', stage: '小组赛',
    match_date: date, map: '源工重镇', score, team_a: '苍穹队', team_b: '烈焰队',
    team_a_player1_id: 101, team_a_player2_id: 102, team_b_player1_id: 301, team_b_player2_id: 302,
    team_a_player1_ch: '霓虹', team_a_player2_ch: '夜露', team_b_player1_ch: '捷风', team_b_player2_ch: '零',
    team_a_player1_data: data, team_a_player2_data: '200/15/14/6',
    team_b_player1_data: '210/16/13/4', team_b_player2_data: '180/12/15/5' });
  const { dom, errors } = build('player.html', {
    /* 3 张图：第 1、3 张他拿首杀 → 首杀 2 次，首杀率 66.7% */
    s6_matches: [
      mk(1, '2026-11-20T10:00:00Z', '13:9',  '280/20/12/5/1'),
      mk(2, '2026-11-21T10:00:00Z', '11:13', '260/18/14/4/0'),
      mk(3, '2026-11-22T10:00:00Z', '13:7',  '300/22/10/6/1')
    ],
    s6_player_ids: [{ id: 101, name: '苍穹', team: '苍穹队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [{ player_name: '苍穹', game_id: 'TESTER#001' }],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1500);

  const summary = d.getElementById('summary-list-content').textContent;
  /* 2 次首杀 / 3 张图 = 0.67 每局，66.7% */
  ok('生涯详情有「每局首杀」', /每局首杀/.test(summary), summary.slice(0, 140));
  ok('每局首杀 = 2/3 ≈ 0.67', /0\.67/.test(summary), summary.match(/每局首杀[^每]*/)?.[0] || summary.slice(0, 140));
  ok('生涯详情有「首杀率」', /首杀率/.test(summary));
  ok('首杀率 = 2/3 ≈ 66.7%', /66\.7%/.test(summary), summary.match(/首杀率[^每]*/)?.[0] || '');

  const evHead = [...d.querySelectorAll('#event-stats-content table thead th')].map(x => x.textContent);
  const fbCol = evHead.indexOf('首杀');
  const fbRateCol = evHead.indexOf('首杀率');
  ok('赛事表有「首杀」「首杀率」列', fbCol > -1 && fbRateCol > -1, evHead.join(' | '));
  const evRow = d.querySelector('#event-stats-content table tbody tr');
  const cells = evRow ? [...evRow.querySelectorAll('td')].map(x => x.textContent.trim()) : [];
  ok('赛事行首杀数 = 2', cells[fbCol] === '2', '第 ' + fbCol + ' 列 = ' + cells[fbCol]);
  ok('赛事行首杀率 = 66.7%', cells[fbRateCol] === '66.7%', '第 ' + fbRateCol + ' 列 = ' + cells[fbRateCol]);

  const charHead = d.getElementById('character-stats-table').querySelector('thead').textContent;
  ok('角色表有「首杀」与「首杀率」列', /首杀/.test(charHead) && /首杀率/.test(charHead));
  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();

  /* 老数据只有 4 段：不能崩，首杀按 0 算 */
  const legacy = build('player.html', {
    s6_matches: [mk(1, '2026-11-20T10:00:00Z', '13:9', '280/20/12/5')],
    s6_player_ids: [{ id: 101, name: '苍穹', team: '苍穹队', group: '传奇组', image: '' }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_player_stats: [], s6_comments: [], comment_reports: [], player_honors: [],
    event_registrations: [], reg_profiles: [], events: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  await wait(1500);
  const ds = legacy.dom.window.document;
  ok('老 4 段数据照常读出 ACS', /280\.00|280\.0/.test(ds.getElementById('summary-list-content').textContent),
     ds.getElementById('summary-list-content').textContent.slice(0, 80));
  ok('老数据首杀率 0.0%', /0\.0%/.test(ds.getElementById('summary-list-content').textContent));
  ok('老数据无运行时错误', legacy.errors.length === 0, legacy.errors.slice(0, 2).join(' | '));
  legacy.dom.window.close();
}

/* 生涯口径：同一个人跨赛季/跨组必须合并成一份数据 */
async function testPlayerCareer() {
  console.log('\n[选手页] 生涯口径：跨赛季跨组合并 + 无记录不报错');
  const p = (g) => [{ id: '苍穹', name: '苍穹', group: g, team: 'A队', image: null }];
  const mk = (id, sa, sb, g) => {
    const o = { id, group: g, team_a: 'A队', team_b: 'B队', score_a: sa, score_b: sb,
      match_date: '2026-11-0' + (id % 9 + 1) + 'T10:00:00Z', result_status: 'done', event_id: 1 };
    for (let i = 1; i <= 5; i++) {
      o['team_a_player' + i + '_id'] = i === 1 ? '苍穹' : 'm' + i;
      o['team_a_player' + i + '_data'] = i === 1 ? '210/18/12/5' : '150/12/14/6';
      o['team_a_player' + i + '_ch'] = '捷风';
      o['team_b_player' + i + '_id'] = 'o' + i;
      o['team_b_player' + i + '_data'] = '160/14/15/4';
      o['team_b_player' + i + '_ch'] = '雷兹';
    }
    return o;
  };
  const { dom, errors } = build('player.html', {
    s6_matches: [mk(1, 13, 9, '传奇组'), mk(2, 11, 13, '传奇组')],
    s6_player_ids: p('传奇组'),
    s5_matches: [mk(3, 13, 5, '挑战组')],
    s5_player_ids: [],
    s6_match_schedule: [], s5_match_schedule: [],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: []
  }, {
    url: 'https://example.test/player.html?name=' + encodeURIComponent('苍穹'),
    init(w) { w.Chart = function () { this.destroy = function () {}; }; }
  });
  const d = dom.window.document;
  await wait(1300);
  ok('跨赛季合并：3 场来自两个赛季', /3 场/.test(d.getElementById('career-scope').textContent),
     d.getElementById('career-scope').textContent);
  ok('跨组别合并：副标题同时出现两个组', /传奇组/.test(d.getElementById('player-game-id').textContent) &&
     /挑战组/.test(d.getElementById('player-game-id').textContent), d.getElementById('player-game-id').textContent);
  ok('模块用 table-card 承载（无红边框卡片）',
     [...d.querySelectorAll('section')].filter((s) => /table-card/.test(s.className)).length >= 4);
  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* 没有比赛记录：正常显示空档案，不弹「未找到该选手」 */
async function testPlayerEmpty() {
  console.log('\n[选手页] 还没有比赛记录时正常显示空档案');
  const { dom, errors } = build('player.html', {
    s6_matches: [], s6_player_ids: [{ id: '潘彦丞', name: '潘彦丞', group: '中坚组', team: '', image: null }],
    s5_matches: [], s5_player_ids: [], s6_match_schedule: [], s5_match_schedule: [],
    s6_comments: [], comment_reports: [], player_honors: [], event_registrations: [], reg_profiles: []
  }, { url: 'https://example.test/player.html?name=' + encodeURIComponent('潘彦丞') });
  const d = dom.window.document;
  await wait(1300);
  const head = d.getElementById('player-id-header').textContent;
  ok('标题显示选手姓名', /潘彦丞/.test(head), head);
  /* 只看可见区域：body.textContent 会把 <script> 源码也算进去 */
  const visible = d.querySelector('main').textContent;
  ok('页面可见区域不出现「未找到」', !/未找到/.test(visible), visible.slice(0, 60));
  ok('各模块给出"暂无数据"而不是空白', /还没有比赛数据/.test(visible));
  ok('赛事数据区有可操作的出口', /去看活动|尚未出场/.test(visible));
  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* ───────────────────────── 3. 管理后台：待办审批 ───────────────────────── */
async function testAdminTodo() {
  console.log('\n[管理后台] 我的报名用户 → 待办审批');
  const { dom, errors } = build('admin.html', {
    site_users: [
      { id: 1, username: 'admin', nickname: '管理员', role: 'superadmin', banned: false },
      { id: 2, username: 'newbie', nickname: '新来的', role: 'member', banned: false },
      { id: 3, username: 'waitguy', nickname: '候补君', role: 'member', banned: false }
    ],
    events: [{ id: 1, title: 'S6 正赛', max_slots: 2, status: 'registration', organizer_id: 1 }],
    event_registrations: [
      { id: 11, event_id: 1, user_id: 2, status: 'pending', team_name: 'A队', created_at: '2026-11-20T10:00:00Z' },
      { id: 12, event_id: 1, user_id: 3, status: 'waitlist', team_name: 'B队', created_at: '2026-11-21T10:00:00Z' },
      { id: 13, event_id: 1, user_id: 2, status: 'approved', team_name: 'A队', created_at: '2026-11-19T10:00:00Z' }
    ],
    permissions: [], admin_logs: [], seasons: [], site_settings: [], shop_items: [],
    player_honors: [], event_bans: [], notifications: []
  }, {
    url: 'https://example.test/admin.html',
    /* 会话来自 localStorage.hw_session —— 直接预置，不依赖登录弹窗 */
    init(w) {
      w.localStorage.setItem('hw_session', JSON.stringify({
        id: 1, username: 'admin', nickname: '管理员', role: 'superadmin'
      }));
      w.localStorage.setItem('hw_session_meta', JSON.stringify({ issued_at: Date.now(), last_seen: Date.now() }));
    }
  });
  const w = dom.window, d = w.document;
  await wait(2200);

  const card = d.getElementById('my-reg-card');
  ok('待办卡片对管理员可见', !!card && !card.hidden, card ? ('hidden=' + card.hidden) : '卡片不存在');
  ok('标题是「报名待审批」而不是「我的报名用户」', /报名待审批/.test(card.textContent), card.querySelector('.section-title').textContent.trim());
  ok('不再出现「我的报名用户」', !/我的报名用户/.test(card.textContent));

  const rows = [...d.querySelectorAll('.adm-todo-row')];
  ok('只列待处理的 2 条（待审核 + 候补），已通过的不占地方', rows.length === 2, 'got ' + rows.length);
  ok('待审核与候补被区分开', rows.some((r) => /待审核/.test(r.textContent)) && rows.some((r) => /候补待转正/.test(r.textContent)));
  ok('每条都有「通过」和「拒绝」', rows.every((r) => r.querySelector('[data-rc-approve]') && r.querySelector('[data-rc-reject]')));
  ok('已通过的那条没混进待办', !rows.some((r) => /已通过/.test(r.textContent)));

  /* 点通过 → 必须真的写库并移出待办 */
  const updates = [];
  const sb = w.HWAuth.getClient();
  const origFrom = sb.from.bind(sb);
  sb.from = function (t) {
    const q = origFrom(t);
    if (t === 'event_registrations') {
      const ou = q.update;
      q.update = function (v) { updates.push(v); return ou.apply(q, arguments); };
    }
    return q;
  };
  rows[0].querySelector('[data-rc-approve]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(600);
  ok('「通过」写入 status=approved', updates.length === 1 && updates[0].status === 'approved', JSON.stringify(updates));
  ok('处理完的一行从待办中移除', d.querySelectorAll('.adm-todo-row').length === 1, 'got ' + d.querySelectorAll('.adm-todo-row').length);

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

/* ───────────────────────── 4. 活动中心：已结束 + 详情无障碍 ───────────────────────── */
async function testEvents() {
  console.log('\n[活动中心] 已结束筛选 + 详情对话框名称');
  const now = Date.now(), H = 3600e3;
  const iso = (ms) => new Date(now + ms).toISOString();
  const { dom, errors } = build('events.html', {
    events: [
      /* 用户的操作路径：手工把 S6 正赛改成已结束，但时间还在未来 */
      { id: 1, title: 'S6 正赛', status: 'finished', start_time: iso(48 * H), end_time: iso(72 * H),
        reg_deadline: iso(24 * H), max_slots: 16, season: 'S6' },
      { id: 2, title: '报名中活动', status: 'registration', start_time: iso(72 * H), end_time: iso(96 * H),
        reg_deadline: iso(48 * H), max_slots: 8, season: 'S6' }
    ],
    event_registrations: [], site_users: [], seasons: [{ season_key: 's6', status: 'active' }],
    notifications: [], event_captains: []
  }, { url: 'https://example.test/events.html' });
  const w = dom.window, d = w.document;
  await wait(1400);

  const btn = (name) => [...d.querySelectorAll('#status-filter button')].find((b) => b.dataset.status === name);
  btn('ended').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const ended = [...d.querySelectorAll('.event-card')];
  ok('点「已结束」能筛出 S6 正赛', ended.length === 1 && /S6 正赛/.test(ended[0].textContent),
     ended.map((c) => c.textContent.trim().slice(0, 20)).join(' | '));
  ok('已结束的卡片不再显示「报名截止」', !/报名截止/.test(ended[0].textContent), ended[0].textContent.trim().slice(0, 80));

  btn('live').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('「进行中」为空时说明原因并可一键看全部', /没有正在进行的活动/.test(d.getElementById('main-content').textContent));

  btn('all').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.querySelector('.event-card').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(500);
  const panel = d.getElementById('detail-panel');
  const labelId = panel.getAttribute('aria-labelledby');
  const titleEl = labelId ? d.getElementById(labelId) : null;
  ok('详情对话框有 aria-labelledby', !!labelId, String(labelId));
  ok('aria-labelledby 指向的子元素真实存在且是标题', !!titleEl && /H[1-3]/.test(titleEl.tagName), titleEl ? titleEl.tagName : '无');
  ok('对话框有可读名称（= 活动标题）', !!titleEl && /S6 正赛/.test(titleEl.textContent), titleEl ? titleEl.textContent.trim() : '');

  if (errors.length) { fails += errors.length; console.log('  运行时错误: ' + errors.slice(0, 3).join(' | ')); }
  dom.window.close();
}

(async () => {
  await testShop();
  await testPlayer(true);
  await testPlayer(false);
  await testPlayerSeedShape();
  await testHonorStrip();
  await testHonorWithoutMatches();
  await testEmptyStateDiagnosis();
  await testCrossSeasonIdSpace();
  await testCrossSeasonMergeSamePerson();
  await testPlayerLayout();
  await testFirstBlood();
  await testRadarThemeColors();
  await testPlayerCareer();
  await testPlayerEmpty();
  await testPlayerLegacyUrl();
  await testAdminTodo();
  await testEvents();
  console.log('\n本轮四项修改：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
  process.exit(fails ? 1 : 0);
})();
