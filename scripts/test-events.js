#!/usr/bin/env node
/**
 * 活动大厅端到端测试（npm run test:events）
 * 复现用户报的那个 bug：卡片显示「报名中」，点进去却是「已截止」，
 * 而且「报名截止」写的时间明明已经过去了。
 * 断言：卡片徽章 === 详情徽章，且过了截止时间就必须是不可报名。
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const auth = fs.readFileSync('js/auth.js', 'utf8');
const layout = fs.readFileSync('js/layout.js', 'utf8');
let html = fs.readFileSync('events.html', 'utf8');

const now = Date.now();
const H = 3600 * 1000;
const iso = (ms) => new Date(now + ms).toISOString();

/* 六种真实场景：每一种都必须「卡片 = 详情」 */
const EVENTS = [
  { id: 1, title: '已过截止但仍标记报名中', status: 'registration', reg_deadline: iso(-3 * H), start_time: iso(48 * H), max_slots: 32,
    event_type: 'tournament', season: 'S6' },
  { id: 2, title: '正常报名中', status: 'registration', reg_deadline: iso(72 * H), start_time: iso(96 * H), max_slots: 32,
    event_type: 'tournament', season: 'S6' },
  { id: 3, title: '马上截止', status: 'registration', reg_deadline: iso(5 * H), start_time: iso(40 * H), max_slots: 32,
    event_type: 'scrim', season: 'S6' },
  { id: 4, title: '名额满', status: 'registration', reg_deadline: iso(72 * H), start_time: iso(96 * H), max_slots: 2,
    event_type: 'tournament', season: 'S6' },
  { id: 5, title: '已经打完了', status: 'registration', reg_deadline: iso(-96 * H), start_time: iso(-48 * H), end_time: iso(-2 * H),
    max_slots: 32, event_type: 'tournament', season: 'S6' },
  { id: 6, title: '正在打', status: 'registration', reg_deadline: iso(-24 * H), start_time: iso(-2 * H), end_time: iso(20 * H),
    max_slots: 32, event_type: 'tournament', season: 'S6' }
];
const REGS = [];
for (let i = 0; i < 2; i++) REGS.push({ id: 100 + i, event_id: 4, user_id: 900 + i, status: 'approved', created_at: iso(-H) });

const stub = `window.supabase={createClient:function(){return {
  from:function(table){var q={};['select','in','not','is','neq','order','limit','range','or','ilike','gte','lte','match'].forEach(function(m){q[m]=function(){return q}});
    q.eq=function(){return q};
    q.insert=q.update=q.delete=q.upsert=function(){return q};
    q.maybeSingle=q.single=function(){return Promise.resolve({data:null,error:null})};
    q.then=function(res){return Promise.resolve({data:(window.__data[table]||[]),error:null}).then(res)};
    return q},
  rpc:function(){return {then:function(r){return Promise.resolve({data:null,error:null}).then(r)}}},
  auth:{getSession:function(){return Promise.resolve({data:{session:null}})}}}}};`;

html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g, '<script>' + stub + '</script>');
html = html.replace(/<script src="js\/auth\.js"><\/script>/g, () => '<script>' + auth.replace(/<\/script/gi, '<\\/script') + '</script>');
html = html.replace(/<script src="js\/layout\.js"><\/script>/g, () => '<script>' + layout.replace(/<\/script/gi, '<\\/script') + '</script>');
html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/CSS/i.test(e.message)) errors.push(e.message); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  url: 'https://example.test/events.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.__data = { events: JSON.parse(JSON.stringify(EVENTS)), event_registrations: JSON.parse(JSON.stringify(REGS)),
      site_users: [], seasons: [{ season_key: 's6', status: 'active' }], notifications: [], event_captains: [] };
    w.fetch = () => Promise.reject(new Error('offline'));
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window;
const d = w.document;
let fails = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  ✓ ' + name);
  else { fails++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

setTimeout(() => {
  const cards = [...d.querySelectorAll('.event-card')];
  console.log('\n[活动大厅] 卡片与详情必须同源（共 ' + cards.length + ' 张卡）');
  ok('6 场全部渲染', cards.length === 6, 'got ' + cards.length);

  const expect = { 1: '报名已截止', 2: '报名中', 3: '即将截止', 4: '名额已满', 5: '已结束', 6: '进行中' };
  cards.forEach((card) => {
    const id = Number(card.dataset.id);
    const label = (card.querySelector('.badge[data-ev-phase]') || {}).textContent || '';
    ok('#' + id + ' 卡片状态 = ' + expect[id], label.trim() === expect[id], 'got「' + label + '」');

    /* 关键的原始 bug：过了截止时间，卡片上不能再说「报名中」 */
    if (id === 1) {
      ok('  #1 过了截止时间后不再显示「报名中」', !/报名中/.test(label), label);
      ok('  #1 报名截止那行被弱化（划掉）', !!card.querySelector('.ev-past'));
    }
    if (id === 4) ok('  #4 满员时卡片提示可候补', /可候补/.test(card.textContent));
  });

  console.log('\n[活动详情] 打开 #1，详情必须与卡片一致');
  const c1 = cards.find((c) => Number(c.dataset.id) === 1);
  c1.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  setTimeout(() => {
    const panel = d.querySelector('#detail-modal .modal-panel');
    ok('详情已打开', !!panel && d.getElementById('detail-modal').classList.contains('visible'));
    const detailLabel = (panel.querySelector('.badge[data-ev-phase]') || {}).textContent || '';
    ok('详情徽章 = 卡片徽章（都是「报名已截止」）', detailLabel.trim() === '报名已截止', 'got「' + detailLabel + '」');
    ok('详情给出具体截止时间而不是「当前状态不可报名」', /报名已于 .* 截止/.test(panel.textContent), 
       (panel.querySelector('.notice') || {}).textContent);
    ok('详情没有可报名的按钮', !panel.querySelector('a.btn-primary[href*="register.html"]'));

    console.log('\n[活动详情] 打开 #2，正常报名中必须能报名');
    d.getElementById('detail-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const c2 = cards.find((c) => Number(c.dataset.id) === 2);
    c2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      const p2 = d.querySelector('#detail-modal .modal-panel');
      const l2 = (p2.querySelector('.badge[data-ev-phase]') || {}).textContent || '';
      ok('#2 详情状态 = 报名中', l2.trim() === '报名中', 'got「' + l2 + '」');
      ok('#2 有「登录并报名」主按钮', /报名 →|报名→/.test(p2.textContent), '');

      /* 页签：指示条 + 无障碍属性 */
      const tabs = p2.querySelectorAll('[data-dtab]');
      ok('页签带 role=tab', tabs.length > 0 && tabs[0].getAttribute('role') === 'tab');
      const roster = [...tabs].find((t) => t.dataset.dtab === 'roster');
      roster.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      ok('切换页签后 aria-selected 正确', roster.getAttribute('aria-selected') === 'true');
      ok('页签内容有方向感动画类', /pane-in-[lr]/.test(p2.querySelector('.dt-pane[data-pane="roster"]').className));

      /* ★ 核心：时钟走过截止时间，界面必须自己翻面（用户挂机不该看到过期状态） */
      const c3 = cards.find((c) => Number(c.dataset.id) === 3);
      ok('#3 快进前是「即将截止」', /即将截止/.test(c3.textContent), '');
      /* 时间真的过去了：改页面自己持有的那份数据（jsdom 里是深拷贝） */
      const live = w.__data.events.find((e) => e.id === 3);
      live.reg_deadline = new Date(Date.now() - 60 * 1000).toISOString();
      w.__tick();
      ok('#3 快进后卡片自动变成「报名已截止」', /报名已截止/.test(c3.textContent), c3.querySelector('.badge[data-ev-phase]').textContent);
      ok('#3 截止那行自动弱化', !!c3.querySelector('[data-deadline].ev-past'));

      const inv = [...d.querySelectorAll('.event-card[data-id]')].find((c) => Number(c.dataset.id) === 2);
      ok('#2 未过期者不受影响（仍是报名中）', /报名中/.test(inv.textContent));

      /* ★ 筛选口径：静态按钮曾是库内状态值（finished），筛选逻辑比的是 phase（ended）
         → 点「已结束」永远空。这里逐个点一遍，断言能选出东西。 */
      d.getElementById('detail-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      const filterBtns = [...d.querySelectorAll('#status-filter button')];
      ok('筛选按钮用 phase 口径（不出现 registration/finished）',
         filterBtns.every((b) => ['all', 'open', 'live', 'ended', 'draft', 'cancelled', 'deleted'].includes(b.dataset.status)),
         filterBtns.map((b) => b.dataset.status).join(','));

      const clickFilter = (name) => {
        const b = [...d.querySelectorAll('#status-filter button')].find((x) => x.dataset.status === name);
        if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        return [...d.querySelectorAll('.event-card')].length;
      };
      /* 造一个「手工把状态改成已结束」的活动（用户的操作路径） */
      w.__data.events.push({ id: 7, title: '手工改为已结束', status: 'finished', start_time: now + 24 * H, end_time: now + 48 * H,
        max_slots: 16, event_type: 'tournament', season: 'S6' });
      w.__tick && w.__tick();

      const endedCount = clickFilter('ended');
      ok('点「已结束」能筛出已结束的活动', endedCount > 0, 'got ' + endedCount);
      const liveCount = clickFilter('live');
      ok('点「进行中」筛选正常', liveCount >= 1, 'got ' + liveCount);
      ok('点「报名中」包含已截止的场次（用户预期是"报名这事"）', clickFilter('open') >= 2, '');
      ok('点「全部」恢复全部', clickFilter('all') === d.querySelectorAll('.event-card').length, '');

      /* 「我的报名」不能因为 waitlistPos 位置错误而整块挂掉 */
      const mine = d.querySelector('[data-tab="mine"]') || d.querySelector('.tab-btn[data-tab="mine"]');
      if (mine) {
        mine.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        setTimeout(() => {
          ok('「我的报名」未登录时正常显示登录引导（无 ReferenceError）',
             /登录后查看我的报名/.test(d.getElementById('main-content').textContent), '');
          finish();
        }, 250);
      } else finish();
    }, 250);
  }, 300);

  function finish() {
    if (errors.length) { fails += errors.length; console.log('\n  运行时错误：\n   ' + errors.slice(0, 4).join('\n   ')); }
    console.log('\n活动大厅：' + (fails ? 'FAIL ' + fails + ' 项' : '全部通过 ✓'));
    process.exit(fails ? 1 : 0);
  }
}, 1300);
