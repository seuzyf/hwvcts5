/**
 * HWVCTS · shared layout (Phase 3 — event-centric IA)
 *
 * Renders on every page:
 *   1. Theme boot (synchronous, before first paint): localStorage `hw_theme`
 *      → <html data-theme="dark|light">; nav holds the toggle button.
 *   2. Glass nav — TOP LEVEL IS ONLY 主页 / 活动 (matches, summary, betting,
 *      schedule, draft, admin are all EVENT-SCOPED, see eventBar below).
 *   3. Footer — 剧情模式 only (no first-level admin/draft/schedule links).
 *   4. Auth chip (+ admin indicator).
 *
 * Event context API (used by matches/summary/betting/schedule/draft/admin):
 *   HWLayout.resolveEvent()            → Promise<event|null>   (?event=<id>)
 *   HWLayout.access(seasonKey, ev?)     → Promise<{isAdmin,isCaptain,captainTeams,isEventCaptain}>
 *   HWLayout.eventBar({event, perms})  → renders #event-bar host
 *
 * Permission model:
 *   admin   = site_users.role='admin' OR in-browser password session
 *             (localStorage hw_admin_until, 15 min, marked via markAdmin())
 *   captain = logged-in user whose game_id/nickname/username matches a
 *             `{season}_player_stats` row with role='队长'
 *
 * Required script order: supabase CDN → js/auth.js → js/layout.js → page script
 * Mark the page: <body data-page="matches" data-crumb="events">
 */
(function () {
  'use strict';

  /* ---------------- Theme (runs synchronously from <head>) ---------------- */
  var THEME_KEY = 'hw_theme';
  var THEME_EVENT = 'hw:theme';

  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function setTheme(mode) {
    var t = mode === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: t }));
  }
  setTheme(getTheme()); // boot: attribute applied before body renders

  /* ---------------- Navigation model ---------------- */
  var NAV = [
    { id: 'index',   href: 'index.html',   label: '主页' },
    { id: 'events',  href: 'events.html',  label: '活动' },
    { id: 'players', href: 'players.html', label: '数据中心' },
    { id: 'shop',    href: 'shop.html',    label: '积分商店' },
    { id: 'admin',   href: 'admin.html',   label: '管理后台' }
  ];

  var FOOTER_LINKS = [
    { href: 'game.html', label: '剧情模式' }
  ];

  var EV_TABS = [
    { page: 'events',   href: 'events.html?open={id}', label: '概况' },
    { page: 'register', href: 'register.html?event={id}', label: '报名' },
    { page: 'schedule', href: 'schedule.html?event={id}', label: '赛程' },
    { page: 'matches',  href: 'matches.html?event={id}',  label: '比赛' },
    { page: 'summary',  href: 'summary.html?event={id}',  label: '数据' },
    { page: 'betting',  href: 'betting.html?event={id}',  label: '竞猜' },
    { page: 'draft',    href: 'draft.html?event={id}',    label: '分队', need: 'staff' },
    { page: 'manage',   href: 'manage.html?event={id}',   label: '管理', need: 'manage' },
    { page: 'review',   href: 'review.html?event={id}',   label: '审核', need: 'admin' }
  ];

  var SUN_SVG = '<svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON_SVG = '<svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  var BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  /* Lucide 图标（coss.com/ui 所用图标库）内联集 */
  var ICONS = {
    "calendar": "<path d=\"M8 2v4\" />\n  <path d=\"M16 2v4\" />\n  <rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" />\n  <path d=\"M3 10h18\" />",
    "gamepad": "<line x1=\"6\" x2=\"10\" y1=\"12\" y2=\"12\" />\n  <line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\" />\n  <line x1=\"15\" x2=\"15.01\" y1=\"13\" y2=\"13\" />\n  <line x1=\"18\" x2=\"18.01\" y1=\"11\" y2=\"11\" />\n  <rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\" />",
    "chart-column": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" />\n  <path d=\"M18 17V9\" />\n  <path d=\"M13 17V5\" />\n  <path d=\"M8 17v-3\" />",
    "target": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <circle cx=\"12\" cy=\"12\" r=\"6\" />\n  <circle cx=\"12\" cy=\"12\" r=\"2\" />",
    "trophy": "<path d=\"M6 9H4.5a2.5 2.5 0 0 1 0-5H6\" />\n  <path d=\"M18 9h1.5a2.5 2.5 0 0 0 0-5H18\" />\n  <path d=\"M4 22h16\" />\n  <path d=\"M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22\" />\n  <path d=\"M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22\" />\n  <path d=\"M18 2H6v7a6 6 0 0 0 12 0V2Z\" />",
    "ban": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m4.9 4.9 14.2 14.2\" />",
    "clipboard-list": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" />\n  <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" />\n  <path d=\"M12 11h4\" />\n  <path d=\"M12 16h4\" />\n  <path d=\"M8 11h.01\" />\n  <path d=\"M8 16h.01\" />",
    "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" />\n  <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
    "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m9 12 2 2 4-4\" />",
    "circle-x": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m15 9-6 6\" />\n  <path d=\"m9 9 6 6\" />",
    "zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\" />",
    "pen-line": "<path d=\"M12 20h9\" />\n  <path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" />",
    "crown": "<path d=\"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z\" />\n  <path d=\"M5 21h14\" />",
    "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" />\n  <circle cx=\"9\" cy=\"9\" r=\"2\" />\n  <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
    "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" />\n  <path d=\"M12 9v4\" />\n  <path d=\"M12 17h.01\" />",
    "badge-check": "<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" />\n  <path d=\"m9 12 2 2 4-4\" />",
    "filter": "<polygon points=\"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3\" />",
    "list-checks": "<path d=\"m3 17 2 2 4-4\" />\n  <path d=\"m3 7 2 2 4-4\" />\n  <path d=\"M13 6h8\" />\n  <path d=\"M13 12h8\" />\n  <path d=\"M13 18h8\" />",
    "square-check": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"m9 12 2 2 4-4\" />",
    "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
    "fingerprint": "<path d=\"M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4\" />\n  <path d=\"M14 13.12c0 2.38 0 6.38-1 8.88\" />\n  <path d=\"M17.29 21.02c.12-.6.43-2.3.5-3.02\" />\n  <path d=\"M2 12a10 10 0 0 1 18-6\" />\n  <path d=\"M2 16h.01\" />\n  <path d=\"M21.8 16c.2-2 .131-5.354 0-6\" />\n  <path d=\"M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2\" />\n  <path d=\"M8.65 22c.21-.66.45-1.32.57-2\" />\n  <path d=\"M9 6.8a6 6 0 0 1 9 5.2v2\" />",
    "camera": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\" />\n  <circle cx=\"12\" cy=\"13\" r=\"3\" />",
    "upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />\n  <polyline points=\"17 8 12 3 7 8\" />\n  <line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\" />",
    "bell": "<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\" />\n  <path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" />",
    "plus": "<path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />",
    "x": "<path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />",
    "check": "<path d=\"M20 6 9 17l-5-5\" />",
    "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" />\n  <path d=\"m21 21-4.3-4.3\" />",
    "star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />",
    "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" />\n  <circle cx=\"9\" cy=\"7\" r=\"4\" />\n  <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" />\n  <path d=\"M16 3.13a4 4 0 0 1 0 7.75\" />",
    "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />\n  <path d=\"m9 12 2 2 4-4\" />",
    "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
    "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" />\n  <circle cx=\"12\" cy=\"7\" r=\"4\" />",
    "key": "<path d=\"m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4\" />\n  <path d=\"m21 2-9.6 9.6\" />\n  <circle cx=\"7.5\" cy=\"15.5\" r=\"5.5\" />",
    "log-out": "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />\n  <polyline points=\"16 17 21 12 16 7\" />\n  <line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\" />",
    "gift": "<rect x=\"3\" y=\"8\" width=\"18\" height=\"4\" rx=\"1\" />\n  <path d=\"M12 8v13\" />\n  <path d=\"M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7\" />\n  <path d=\"M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5\" />",
    "dices": "<rect width=\"12\" height=\"12\" x=\"2\" y=\"10\" rx=\"2\" ry=\"2\" />\n  <path d=\"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6\" />\n  <path d=\"M6 18h.01\" />\n  <path d=\"M10 14h.01\" />\n  <path d=\"M15 6h.01\" />\n  <path d=\"M18 9h.01\" />",
    "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />\n  <polyline points=\"7 10 12 15 17 10\" />\n  <line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />"
  };

  function ico(name, size) {
    var body = ICONS[name];
    if (!body) return '';
    var s = size || 18;
    return '<svg class="ico ico-' + name + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildNav() {
    var page = document.body.dataset.page || '';
    var crumb = document.body.dataset.crumb || '';

    var evCtx = null;
    try {
      var qpNav = new URLSearchParams(window.location.search);
      evCtx = qpNav.get('event') || qpNav.get('open'); /* 活动详情页 ?open= 同样携带上下文 */
    } catch (e) { evCtx = null; }
    var linksHtml = NAV.map(function (item) {
      var active = item.id === page || (crumb && item.id === crumb);
      var href = item.href;
      /* 活动页内跳转数据中心 → 直接筛选当前活动 */
      if (evCtx && item.href.indexOf('players.html') === 0) {
        href = 'players.html?event=' + encodeURIComponent(evCtx);
      }
      return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + href + '">' + item.label + '</a>';
    }).join('');

    var nav = document.createElement('nav');
    nav.className = 'glass-nav';
    nav.setAttribute('aria-label', '主导航');
    nav.innerHTML =
      '<a class="nav-brand" href="index.html" aria-label="HWVCTS 主页">' +
      '  <span class="brand-diamond"></span>' +
      '  <span class="brand-name">HWVCTS</span>' +
      '</a>' +
      '<div class="nav-links">' + linksHtml + '</div>' +
      '<div class="nav-auth">' +
      '  <button class="theme-toggle" id="nav-bell" type="button" aria-label="通知" title="通知">' +
            BELL_SVG + '<span class="bell-badge" id="nav-bell-badge" hidden>0</span>' +
      '  </button>' +
      '  <button class="theme-toggle" id="nav-theme-btn" type="button" aria-label="切换浅色/深色模式" title="浅色 / 深色模式">' +
            SUN_SVG + MOON_SVG +
      '  </button>' +
      '  <span id="nav-auth"></span>' +
      '</div>' +
      '<div class="bell-panel" id="nav-bell-panel" hidden></div>';
    document.body.appendChild(nav);

    var themeBtn = document.getElementById('nav-theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        setTheme(getTheme() === 'light' ? 'dark' : 'light');
      });
    }

    var bellBtn = document.getElementById('nav-bell');
    if (bellBtn) {
      bellBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var panel = document.getElementById('nav-bell-panel');
        if (!panel) return;
        if (panel.hidden) openBell(); else panel.hidden = true;
      });
    }
    document.addEventListener('click', function (e) {
      var panel = document.getElementById('nav-bell-panel');
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || (bellBtn && bellBtn.contains(e.target))) return;
      panel.hidden = true;
    });
  }

  /* ---------------- 通知中心（右上角铃铛） ---------------- */
  function toast(msg, type) {
    var host = document.getElementById('hw-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hw-toasts';
      document.body.appendChild(host);
    }
    if (!type) {
      var s = String(msg == null ? '' : msg);
      if (/失败|错误|请先|请输入|请填写|请选择|无法|不能|为空|未通过|已满|中止|报错|不可|不存在|口令|最多|只能|暂无/.test(s)) type = 'err';
      else if (/成功|已保存|已同步|已生成|已通过|已提交|已撤回|已设置|已更新|✓/.test(s)) type = 'ok';
      else type = 'info';
    }
    var t = document.createElement('div');
    t.className = 'hw-toast' + (type === 'err' ? ' err' : type === 'ok' ? '' : ' info');
    t.textContent = String(msg == null ? '' : msg);
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3000);
  }

  /** 给某位用户写站内通知（右上角铃铛） */
  function notifyUser(userId, title, body, link) {
    if (!userId) return Promise.resolve(null);
    var sb = supa();
    if (!sb) return Promise.resolve(null);
    return sb.from('notifications').insert([{
      user_id: userId, title: String(title || ''), body: String(body || ''), link: String(link || '')
    }]).then(function (r) { refreshBell(); return r; }).catch(function () { return null; });
  }

  /** 给全体管理员写站内通知 */
  function notifyAdmins(title, body, link) {
    var sb = supa();
    if (!sb) return Promise.resolve(null);
    return sb.from('site_users').select('id').in('role', ['admin', 'superadmin'])
      .then(function (res) {
        var ids = ((res && !res.error && res.data) || []).map(function (x) { return x.id; });
        if (!ids.length) return null;
        return sb.from('notifications').insert(ids.map(function (id) {
          return { user_id: id, title: String(title || ''), body: String(body || ''), link: String(link || '') };
        }));
      }).then(function (r) { refreshBell(); return r; }).catch(function () { return null; });
  }

  /* ===================================================================
   * P13c/e/f/g：积分重算 / 导出 / 封禁 / 候补递补 / 广播
   * =================================================================== */

  /** 积分权威重算：100 - 投注 + 赢利 + 签到×5 + 积分流水净额 → 写回 balance */
  function recalcBalance(userId) {
    var sb = supa();
    if (!sb || !userId) return Promise.resolve(null);
    return Promise.all([
      sb.from('site_users').select('id, balance, balance_synced_at').eq('id', userId).maybeSingle(),
      sb.from('s6_bet_bets').select('*'),
      sb.from('s6_match_schedule').select('id, team_a, team_b, score_a, score_b'),
      sb.from('points_ledger').select('delta').eq('user_id', userId),
      sb.from('goods_redemptions').select('cost').eq('user_id', userId)
    ]).then(function (rs) {
      if (!rs || rs.some(function (r) { return r && r.error; })) return null;
      var me = rs[0] && rs[0].data;
      if (!me) return null;
      var bets = rs[1].data || [], sched = rs[2].data || [], led = rs[3].data || [];
      var reds = (rs[4] && rs[4].data) || [];
      var matchMap = {};
      sched.forEach(function (m) { matchMap[m.id] = m; });
      var pools = {};
      bets.forEach(function (b) {
        if (!pools[b.match_id]) pools[b.match_id] = { a: 0, b: 0 };
        var m = matchMap[b.match_id];
        if (!m) return;
        if (b.predicted_winner === m.team_a) pools[b.match_id].a += b.amount;
        else pools[b.match_id].b += b.amount;
      });
      var staked = 0, winnings = 0;
      bets.filter(function (b) { return b.user_id === userId; }).forEach(function (b) {
        staked += b.amount;
        var m = matchMap[b.match_id];
        if (m && m.score_a != null && m.score_b != null && m.score_a !== m.score_b) {
          var winner = m.score_a > m.score_b ? m.team_a : m.team_b;
          if (b.predicted_winner === winner) {
            var pool = pools[b.match_id];
            var winnerPool = winner === m.team_a ? 100 + pool.a : 100 + pool.b;
            var loserPool = winner === m.team_a ? 100 + pool.b : 100 + pool.a;
            winnings += b.amount + Math.ceil((b.amount / winnerPool) * loserPool);
          }
        }
      });
      var ledgerNet = led.reduce(function (s, r) { return s + (r.delta || 0); }, 0);
      var redeemCost = reds.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
      /* 权威公式：100 − 投注 + 赢利 + 积分流水 − 商城兑换（redeem_goods 事实）；低保已下线 */
      var bal = Math.round(100 - staked + winnings + ledgerNet - redeemCost);
      return sb.from('site_users')
        .update({ balance: bal, balance_synced_at: new Date().toISOString() })
        .eq('id', userId)
        .then(function () { return bal; })
        .catch(function () { return null; });
    }).catch(function () { return null; });
  }

  /** .ics 日历导出（P13h）：items = [{title, start, end?, desc?, loc?}] */
  function exportIcs(filename, items) {
    try {
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var fmt = function (d) {
        var dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt.getTime())) return null;
        return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + 'T' +
          pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
      };
      var escIcs = function (v) { return String(v == null ? '' : v).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); };
      var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HWVCTS//Schedule//CN', 'CALSCALE:GREGORIAN'];
      var now = fmt(new Date());
      (items || []).forEach(function (it, i) {
        var s = fmt(it && it.start);
        if (!s) return;
        var e = fmt((it && it.end) || it.start) || s;
        lines.push('BEGIN:VEVENT');
        lines.push('UID:hwvcts-' + Date.now() + '-' + i + '@hwvcts');
        if (now) lines.push('DTSTAMP:' + now);
        lines.push('DTSTART:' + s);
        lines.push('DTEND:' + e);
        lines.push('SUMMARY:' + escIcs(it.title));
        if (it.desc) lines.push('DESCRIPTION:' + escIcs(it.desc));
        if (it.loc) lines.push('LOCATION:' + escIcs(it.loc));
        lines.push('END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('已导出 ' + filename);
    } catch (e) {
      toast('日历导出失败', 'err');
    }
    return true;
  }

  /** 赛果写入后：重算所有有投注记录的用户余额（池与派彩都会变） */
  function recalcAfterScoreChange() {
    var sb = supa();
    if (!sb) return Promise.resolve(0);
    return sb.from('s6_bet_bets').select('user_id')
      .then(function (res) {
        var rows = (res && !res.error && res.data) || [];
        var ids = {};
        rows.forEach(function (b) { if (b.user_id != null) ids[b.user_id] = 1; });
        var list = Object.keys(ids);
        return list.reduce(function (p, id) {
          return p.then(function (n) {
            return recalcBalance(id).then(function () { return n + 1; });
          });
        }, Promise.resolve(0));
      }).catch(function () { return 0; });
  }

  /** CSV 导出（BOM + RFC4180 转义），toast 提示 */
  function exportCsv(filename, header, rows) {
    try {
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var lines = [(header || []).map(q).join(',')];
      (rows || []).forEach(function (r) { lines.push((r || []).map(q).join(',')); });
      var blob = new Blob(['\\ufeff' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('已导出 ' + filename);
    } catch (e) {
      toast('导出失败', 'err');
    }
    return true;
  }

  /* ---- 封禁（P13f） ---- */
  function isBannedUser(u) {
    if (!u || !u.banned) return false;
    if (u.banned_until && new Date(u.banned_until).getTime() < Date.now()) return false;
    return true;
  }
  function bannedBadgeHtml() {
    return '<span class="badge badge-ban" title="已禁赛">' + ico('ban', 12) + ' 已禁赛</span>';
  }
  function fetchEventBan(eventId, userId) {
    var sb = supa();
    if (!sb || !eventId || !userId) return Promise.resolve(null);
    return sb.from('event_bans').select('*').eq('event_id', eventId).eq('user_id', userId).maybeSingle()
      .then(function (r) {
        var row = r && !r.error && r.data;
        if (!row) return null;
        if (row.until && new Date(row.until).getTime() < Date.now()) return null;
        return row;
      }).catch(function () { return null; });
  }
  function myBanState() {
    var u = (typeof HWAuth !== 'undefined') ? HWAuth.getSession() : null;
    var sb = supa();
    if (!u || !sb) return Promise.resolve(null);
    return sb.from('site_users').select('banned, banned_reason, banned_until').eq('id', u.id).maybeSingle()
      .then(function (r) { return (r && !r.error && r.data) || null; })
      .catch(function () { return null; });
  }

  /* ---- 候补递补（P13h）：撤销/退出后把 waitlist → pending 并双向通知 ---- */
  function promoteWaitlist(ev) {
    var sb = supa();
    if (!sb || !ev || !ev.id) return Promise.resolve(0);
    var maxSlots = parseInt(ev.max_slots, 10) || 0;
    if (!maxSlots) return Promise.resolve(0);
    return sb.from('event_registrations').select('*').eq('event_id', ev.id)
      .then(function (res) {
        var rows = (res && !res.error && res.data) || [];
        var approved = 0, pending = 0;
        rows.forEach(function (r) {
          if (r.status === 'approved') approved++;
          else if (r.status === 'pending') pending++;
        });
        var room = maxSlots - approved - pending;
        var wl = rows.filter(function (r) { return r.status === 'waitlist'; })
          .sort(function (a, b) { return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1; });
        var up = wl.slice(0, Math.max(0, room));
        if (!up.length) return 0;
        return Promise.all(up.map(function (r) {
          return sb.from('event_registrations').update({ status: 'pending' }).eq('id', r.id)
            .then(function () {
              notifyUser(r.user_id, '候补递补',
                '你在「' + (ev.title || '') + '」的候补已递补为「待审核」，请等待管理员处理。',
                'register.html?event=' + ev.id);
              return 1;
            }).catch(function () { return 0; });
        })).then(function (arr) {
          var n = arr.filter(Boolean).length;
          if (n) notifyAdmins('候补递补待审核', '「' + (ev.title || '') + '」有 ' + n + ' 名候补用户已递补为待审核。', 'admin.html');
          return n;
        });
      }).catch(function () { return 0; });
  }

  /* ---- 全员广播（P13b）：scope = all / members / organizers ---- */
  function broadcastNotifications(scope, title, body, link) {
    var sb = supa();
    if (!sb) return Promise.resolve(0);
    return sb.from('site_users').select('id, role').then(function (res) {
      var rows = (res && !res.error && res.data) || [];
      var ids = rows.filter(function (u) {
        if (scope === 'organizers') return u.role === 'organizer' || u.role === 'admin' || u.role === 'superadmin';
        if (scope === 'members') return !u.role || u.role === 'member';
        return true;
      }).map(function (u) { return u.id; });
      var payloads = ids.map(function (id) {
        return { user_id: id, title: String(title || ''), body: String(body || ''), link: String(link || '') };
      });
      var chunks = [];
      for (var i = 0; i < payloads.length; i += 200) chunks.push(payloads.slice(i, i + 200));
      return chunks.reduce(function (p, ch) {
        return p.then(function (n) {
          return sb.from('notifications').insert(ch)
            .then(function () { return n + ch.length; })
            .catch(function () { return n; });
        });
      }, Promise.resolve(0)).then(function (n) { refreshBell(); return n; });
    }).catch(function () { return 0; });
  }

  function refreshBell() {
    var badge = document.getElementById('nav-bell-badge');
    if (!badge) return;
    var user = (typeof HWAuth !== 'undefined') ? HWAuth.getSession() : null;
    if (!user) { badge.hidden = true; badge.textContent = '0'; return; }
    var sb = supa();
    if (!sb) return;
    sb.from('notifications').select('id').eq('user_id', user.id).eq('read', false)
      .then(function (res) {
        var rows = (res && !res.error && res.data) || [];
        var n = rows.length;
        badge.hidden = n === 0;
        badge.textContent = n > 99 ? '99+' : String(n);
      }).catch(function () {});
  }

  function bellTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function renderBellList(rows) {
    var list = document.getElementById('bell-list');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<div class="bell-empty">暂无通知</div>'; return; }
    list.innerHTML = rows.map(function (n) {
      var tag = n.link ? 'a' : 'div';
      var hrefAttr = n.link ? ' href="' + esc(n.link) + '"' : '';
      return '<' + tag + ' class="bell-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '"' + hrefAttr + '>' +
        '<div class="t">' + esc(n.title) + '</div>' +
        (n.body ? '<div class="b">' + esc(n.body) + '</div>' : '') +
        '<div class="time">' + bellTime(n.created_at) + '</div>' +
        '</' + tag + '>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.bell-item'), function (el) {
      el.addEventListener('click', function () {
        var sb = supa();
        if (sb) sb.from('notifications').update({ read: true }).eq('id', el.dataset.id)
          .then(function () { refreshBell(); }).catch(function () {});
      });
    });
  }

  function openBell() {
    var panel = document.getElementById('nav-bell-panel');
    if (!panel) return;
    panel.hidden = false;
    var user = (typeof HWAuth !== 'undefined') ? HWAuth.getSession() : null;
    if (!user) { panel.innerHTML = '<div class="bell-empty">登录后接收通知</div>'; return; }
    panel.innerHTML =
      '<div class="bell-head"><span>通知</span>' +
      '<button class="bell-read-all" id="bell-read-all" type="button">全部已读</button></div>' +
      '<div class="bell-list" id="bell-list"><div class="bell-empty">加载中…</div></div>';
    var sb = supa();
    if (!sb) return;
    sb.from('notifications').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(30)
      .then(function (res) {
        var rows = (res && !res.error && res.data) || [];
        renderBellList(rows);
        var all = document.getElementById('bell-read-all');
        if (all) all.addEventListener('click', function (e) {
          e.stopPropagation();
          sb.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
            .then(function () { refreshBell(); openBell(); }).catch(function () {});
        });
      }).catch(function () {
        var list = document.getElementById('bell-list');
        if (list) list.innerHTML = '<div class="bell-empty">加载失败</div>';
      });
  }

  function buildFooter() {
    var links = FOOTER_LINKS.map(function (l) {
      return '<a href="' + l.href + '">' + l.label + '</a>';
    }).join('');

    var footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="footer-inner">' +
      '  <div class="footer-links">' + links + '</div>' +
      '  <div class="footer-meta">' +
      '    <span>HWVCTS</span><span class="pipe">|</span>' +
      '    <span>VALORANT TOURNAMENT</span><span class="pipe">|</span>' +
      '    <span>v3.0</span>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(footer);
  }

  /* ---------------- Permissions ---------------- */
  var ADMIN_KEY = 'hw_admin_until';

  function adminRemainingMs() {
    try { return Math.max(0, +(localStorage.getItem(ADMIN_KEY) || 0) - Date.now()); }
    catch (e) { return 0; }
  }
  function markAdmin(minutes) {
    try { localStorage.setItem(ADMIN_KEY, String(Date.now() + (minutes || 15) * 60000)); } catch (e) {}
  }
  /* P13b：角色秩 guest0 member1 organizer2 admin3 superadmin4 */
  var ROLE_RANK = { guest: 0, member: 1, organizer: 2, admin: 3, superadmin: 4 };
  function roleRank(r) { return ROLE_RANK[r] || 0; }
  function sessionRole() {
    var u = typeof HWAuth !== 'undefined' ? HWAuth.getSession() : null;
    return (u && u.role) || 'guest';
  }
  /** 有效秩：临时管理员（markAdmin）按 admin 算，但永不超过 admin */
  function effectiveRank() {
    var r = roleRank(sessionRole());
    if (adminRemainingMs() > 0) r = Math.max(r, 3);
    return Math.min(r, 3 + (roleRank(sessionRole()) >= 4 ? 1 : 0));
  }
  function isRoleAdmin() { return roleRank(sessionRole()) >= 3; }
  function isAdminNow() { return isRoleAdmin() || adminRemainingMs() > 0; }
  function isSuperAdminNow() { return roleRank(sessionRole()) >= 4; }
  /** 至少某角色（组织者以上等判断；临时管理员=admin，不升 superadmin） */
  function atLeast(minRole) { return effectiveRank() >= roleRank(minRole); }

  function supa() {
    if (typeof supabase === 'undefined' || !supabase.createClient) return null;
    if (!supa._c) {
      supa._c = supabase.createClient(
        'https://odjmanvkhwiirswscrht.supabase.co',
        'sb_publishable_LVXTUDdXTQ8vlRS0U0G1xQ_qMnEiylO'
      );
    }
    return supa._c;
  }

  /** Best-effort: promote the logged-in account to role='admin' after a password verify. */
  function promoteRole() {
    var sb = supa();
    var u = typeof HWAuth !== 'undefined' ? HWAuth.getSession() : null;
    if (!sb || !u || u.role === 'admin') return Promise.resolve(false);
    return sb.from('site_users').update({ role: 'admin' }).eq('id', u.id)
      .then(function (res) {
        if (res.error) return false;
        u.role = 'admin';
        try {
          var raw = localStorage.getItem('hw_session');
          if (raw) { var s = JSON.parse(raw); s.role = 'admin'; localStorage.setItem('hw_session', JSON.stringify(s)); }
        } catch (e) {}
        renderAuth();
        return true;
      }).catch(function () { return false; });
  }

  var accessCache = {};
  /**
   * @param seasonKey 's6' | 's5'
   * @param ev 可选活动行；提供时额外解析该活动的 event_captains 绑定 → isEventCaptain
   * @returns Promise<{isAdmin, isCaptain, captainTeams, isEventCaptain}>
   */
  function access(seasonKey, ev) {
    seasonKey = (seasonKey || 's6').toLowerCase();
    if (seasonKey !== 's5' && seasonKey !== 's6') seasonKey = 's6';
    var u = typeof HWAuth !== 'undefined' ? HWAuth.getSession() : null;
    var admin = isAdminNow();
    var evId = ev && ev.id ? String(ev.id) : '';
    var userKey = u ? String(u.id) : 'anon';
    var cacheKey = seasonKey + '|' + evId + '|' + userKey + '|' + (admin ? 'a' : '');
    if (accessCache[cacheKey]) return Promise.resolve(accessCache[cacheKey]);

    var base = { isAdmin: admin, isCaptain: false, captainTeams: [], isEventCaptain: admin };
    if (!u) { accessCache[cacheKey] = base; return Promise.resolve(base); }

    var sb = supa();
    if (!sb) { accessCache[cacheKey] = base; return Promise.resolve(base); }

    /* 赛季队长：按 game_id / 昵称 / 用户名 匹配 {season}_player_stats（role='队长'） */
    function checkTable(table) {
      return sb.from(table).select('player_name, game_id, team, role')
        .eq('role', '队长')
        .then(function (res) {
          if (res.error || !res.data) return null;
          return res.data.filter(function (p) {
            return (u.game_id && p.game_id && String(p.game_id) === String(u.game_id)) ||
                   (u.nickname && p.player_name === u.nickname) ||
                   (u.username && p.player_name === u.username);
          });
        }).catch(function () { return null; });
    }

    /* 活动队长：event_captains 行与本人匹配（仅限传入的该活动；管理员直通） */
    function attachEventCaptain(result) {
      if (!evId) { accessCache[cacheKey] = result; return Promise.resolve(result); }
      if (admin) { result.isEventCaptain = true; accessCache[cacheKey] = result; return Promise.resolve(result); }
      return sb.from('event_captains').select('player_name, game_id').eq('event_id', ev.id)
        .then(function (res) {
          var rows = (res && res.data) || [];
          result.isEventCaptain = rows.some(function (c) {
            return (u.game_id && c.game_id && String(c.game_id) === String(u.game_id)) ||
                   (u.nickname && c.player_name === u.nickname) ||
                   (u.username && c.player_name === u.username);
          });
          accessCache[cacheKey] = result;
          return result;
        })
        .catch(function () { accessCache[cacheKey] = result; return result; });
    }

    return checkTable(seasonKey + '_player_stats').then(function (hits) {
      if (hits && hits.length) return hits;
      // 兼容：另一赛季兼任队长不锁死
      var other = seasonKey === 's6' ? 's5_player_stats' : 's6_player_stats';
      return checkTable(other);
    }).then(function (hits) {
      var result = {
        isAdmin: admin,
        isCaptain: !!(hits && hits.length),
        captainTeams: (hits || []).map(function (p) { return p.team; }).filter(Boolean),
        isEventCaptain: admin,
        isOrganizer: false
      };
      return attachEventCaptain(result).then(function (r2) {
        /* 活动组织者：在本活动下等同管理员（不授予全局 admin） */
        if (ev && u && ev.organizer_id != null && String(ev.organizer_id) === String(u.id)) {
          r2.isAdmin = true;
          r2.isOrganizer = true;
          r2.isEventCaptain = true;
        }
        return r2;
      });
    }).catch(function () {
      var fallback = { isAdmin: admin, isCaptain: false, captainTeams: [], isEventCaptain: admin };
      accessCache[cacheKey] = fallback;
      return fallback;
    });
  }

  /* ---------------- Event context ---------------- */
  var evCache = {};
  /** ?event=<numeric id> (or code) → events row, else null. */
  function resolveEvent() {
    var raw;
    try { raw = new URLSearchParams(window.location.search).get('event'); } catch (e) { raw = null; }
    if (!raw) return Promise.resolve(null);
    if (evCache.hasOwnProperty(raw)) return Promise.resolve(evCache[raw]);
    var sb = supa();
    if (!sb) { evCache[raw] = null; return Promise.resolve(null); }

    var q;
    if (/^\d+$/.test(raw)) q = sb.from('events').select('*').eq('id', Number(raw)).maybeSingle();
    else q = sb.from('events').select('*').eq('code', raw).maybeSingle();

    return q.then(function (res) {
      var ev = res.error ? null : (res.data || null);
      evCache[raw] = ev;
      return ev;
    }).catch(function () { evCache[raw] = null; return null; });
  }

  /** 'S6' → 's6' (table prefixes), '' → 's6'. */
  function seasonKey(ev) {
    var s = ev && ev.season ? String(ev.season) : 's6';
    return s.toLowerCase();
  }

  var EV_STATUS_ZH = { draft: '草稿', registration: '报名中', ongoing: '进行中', finished: '已结束', cancelled: '已取消' };

  /**
   * Renders the event context bar into #event-bar (pages place the host).
   * opts: { event, active, perms } — perms from access(); perms optional.
   */
  function eventBar(opts) {
    var host = document.getElementById('event-bar');
    if (!host) return;
    opts = opts || {};
    var ev = opts.event;
    if (!ev) {
      /* 无活动：整条隐藏（此刻没用的不出现） */
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;

    var perms = opts.perms || {};
    var id = ev.id;
    var tabs = EV_TABS.filter(function (t) {
      if (t.need === 'staff') return perms.isCaptain || perms.isAdmin;
      if (t.need === 'manage') return perms.isAdmin || perms.isEventCaptain;
      if (t.need === 'admin') return perms.isAdmin;
      return true;
    }).map(function (t) {
      if (t.page === 'events') return '<a class="ev-tab" href="#" data-ev-ov="1">概况</a>';
      var active = document.body.dataset.page === t.page ? ' active' : '';
      var href = t.href.replace('{id}', id);
      return '<a class="ev-tab' + active + '" href="' + href + '">' + t.label + '</a>';
    }).join('');

    var badge = perms.isAdmin ? '<span class="badge badge-coral">ADMIN</span>'
              : (perms.isCaptain || perms.isEventCaptain) ? '<span class="badge badge-blue">CAPTAIN</span>' : '';

    host.innerHTML =
      '<div class="event-bar">' +
      '  <a class="ev-back" href="events.html" title="返回活动大厅">← 活动</a>' +
      '  <span class="ev-identity">' +
      '    <span class="ev-title">' + esc(ev.title) + '</span>' +
      '    <span class="ev-sub">' + esc(String(ev.season || 'S6').toUpperCase()) + ' · ' + esc(EV_STATUS_ZH[ev.status] || ev.status) + '</span>' +
         badge +
      '  </span>' +
      '  <div class="ev-tabs">' + tabs + '</div>' +
      '</div>';

    var ovTab = host.querySelector('[data-ev-ov]');
    if (ovTab) ovTab.addEventListener('click', function (e) { e.preventDefault(); openEventOverview(ev); });
  }

  /* 概况浮层：当前页内展示活动概览（不再跳回活动大厅） */
  function openEventOverview(ev) {
    var old = document.getElementById('ev-overview');
    if (old) old.remove();

    function fmt(t) {
      if (!t) return '';
      var d = new Date(t);
      if (isNaN(d.getTime())) return esc(String(t));
      return esc(d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
    function cell(k, v) {
      if (!v) return '';
      return '<div style="background:var(--obsidian);border:1px solid var(--border);border-radius:10px;padding:10px 12px;">' +
        '<div style="font-family:var(--font-mono);font-size: 12px;letter-spacing:.06em;text-transform:uppercase;color:var(--smoke);">' + k + '</div>' +
        '<div style="margin-top:4px;font-size: 15px;color:var(--mist);">' + v + '</div></div>';
    }

    var typeZh = { tournament: '锦标赛', scrim: '训练赛', showmatch: '表演赛', activity: '活动' }[ev.event_type] || ev.event_type || '';
    var statusZh = EV_STATUS_ZH[ev.status] || ev.status || '';
    var cover = ev.cover_image
      ? '<div style="margin:-28px -28px 16px;overflow:hidden;border-radius:var(--r-card-lg) var(--r-card-lg) 0 0;">' +
        '<img src="' + esc(ev.cover_image) + '" alt="" style="width:100%;height:170px;object-fit:cover;display:block;"></div>'
      : '';

    var m = document.createElement('div');
    m.id = 'ev-overview';
    m.className = 'modal-backdrop';
    m.style.display = 'flex';
    m.style.opacity = '1';
    m.style.visibility = 'visible';
    m.innerHTML =
      '<div class="modal-panel" style="position:relative;">' +
      cover +
      '<button class="modal-close" data-ov-close type="button">&times;</button>' +
      '<span class="modal-eyebrow">Overview</span>' +
      '<h2 style="margin:8px 0 6px;font-size:20px;font-weight:600;color:var(--pure-white);">' + esc(ev.title) + '</h2>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">' +
        (typeZh ? '<span class="badge badge-quiet">' + esc(typeZh) + '</span>' : '') +
        (statusZh ? '<span class="badge badge-coral">' + esc(statusZh) + '</span>' : '') +
        (ev.season ? '<span class="badge badge-quiet">' + esc(String(ev.season).toUpperCase()) + '</span>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
        cell('开始时间', fmt(ev.start_time)) +
        cell('报名截止', fmt(ev.reg_deadline)) +
        cell('赛制', esc(ev.format || '')) +
        cell('分组', ev.group_count ? (ev.group_count + ' 组') : '') +
        cell('参赛队伍', esc(ev.teams || '')) +
        cell('地点 / 房间', esc(ev.venue || '')) +
      '</div>' +
      (ev.description ? '<p style="font-size: 15px;line-height:1.75;color:var(--ash);margin:14px 0 0;">' + esc(ev.description) + '</p>' : '') +
      (ev.rules
        ? '<div style="font-family:var(--font-mono);font-size: 12px;letter-spacing:.06em;text-transform:uppercase;color:var(--smoke);margin:16px 0 6px;">赛制 / 规则</div>' +
          '<div style="font-size: 15px;line-height:1.7;color:var(--mist);">' + esc(ev.rules) + '</div>'
        : '') +
      '<div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">' +
        '<a class="btn btn-ghost" href="events.html?open=' + ev.id + '">完整详情</a>' +
        '<button class="btn btn-primary" data-ov-close type="button">知道了</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      /* Phase 11：点空白不关闭，仅手动 ×/按钮 */
      if (e.target.closest && e.target.closest('[data-ov-close]')) m.remove();
    });
  }

  /** 赛程时间已过且未录赛果 → 通知双方队长填写（幂等：同场次只发一次） */
  function notifyMatchDue(match, evId) {
    var sb = supa();
    if (!sb || !match) return Promise.resolve(null);
    var title = '赛果待填写：' + (match.team_a || '') + ' vs ' + (match.team_b || '');
    var link = 'manage.html?event=' + (evId || '');
    /* 双方队长 = 该活动下两队报名记录的提交人 + 活动队长表中相关选手 */
    return Promise.all([
      sb.from('event_registrations').select('user_id, team_name')
        .eq('event_id', Number(evId)).in('status', ['approved', 'pending']),
      sb.from('event_captains').select('game_id').eq('event_id', Number(evId))
    ]).then(function (rs) {
      var regs = (rs[0] && !rs[0].error && rs[0].data) || [];
      var caps = (rs[1] && !rs[1].error && rs[1].data) || [];
      var ids = {};
      regs.forEach(function (r) {
        if (r.team_name === match.team_a || r.team_name === match.team_b) ids[r.user_id] = 1;
      });
      var gids = caps.map(function (c) { return c.game_id; }).filter(Boolean);
      if (!gids.length) return Object.keys(ids).map(Number);
      return sb.from('site_users').select('id').in('game_id', gids)
        .then(function (ur) {
          (ur && !ur.error && ur.data || []).forEach(function (u) {
            if (u.id) ids[u.id] = 1;
          });
          return Object.keys(ids).map(Number);
        });
    }).then(function (uids) {
      if (!uids.length) return null;
      return sb.from('notifications').select('id')
        .eq('title', title).in('user_id', uids).limit(1)
        .then(function (ex) {
          if (ex && !ex.error && ex.data && ex.data.length) return null; /* 已通知过 */
          return sb.from('notifications').insert(uids.map(function (id) {
            return { user_id: id, title: title, body: '预定比赛时间已过，尚未录入赛果，请尽快填写。', link: link };
          }));
        });
    }).catch(function () { return null; });
  }

  /* ---------------- Auth chip ---------------- */
  function currentRole() {
    var u = (typeof HWAuth !== 'undefined') ? HWAuth.getSession() : null;
    if (!u) return adminRemainingMs() > 0 ? 'admin' : 'guest';
    if (u.role === 'superadmin') return 'superadmin';
    if (u.role === 'admin') return 'admin';
    if (u.role === 'organizer') return 'organizer';
    if (adminRemainingMs() > 0) return 'admin';
    return 'member';
  }

  function renderAuth() {
    /* 全站鉴权标记：所有页面 body[data-role] = guest|member|organizer|admin */
    if (document.body) document.body.dataset.role = currentRole();
    var host = document.getElementById('nav-auth');
    if (!host) return;

    if (typeof HWAuth === 'undefined') { host.innerHTML = ''; return; }

    var user = HWAuth.getSession();
    if (user) {
      var initial = esc((user.nickname || user.username || '?').charAt(0).toUpperCase());
      var admin = isAdminNow();
      var avUrl = user.avatar || '';
      host.innerHTML =
        '<div class="nav-user-wrap">' +
        '  <button class="nav-user" id="nav-user-btn" type="button" aria-haspopup="true" aria-expanded="false" title="账号菜单' + (admin ? ' · 管理员' : '') + '">' +
        (avUrl
          ? '<img class="nav-avatar nav-avatar-img' + (admin ? ' is-admin' : '') + '" src="' + esc(avUrl) + '" alt="">'
          : '<span class="nav-avatar' + (admin ? ' is-admin' : '') + '">' + initial + '</span>') +
        '    <span class="nav-username">' + esc(user.nickname || user.username) + '</span>' +
        '    <span class="nav-caret">' + ico('chevron-down', 14) + '</span>' +
        '  </button>' +
        '  <div class="nav-menu" id="nav-menu" hidden>' +
        '    <div class="nav-menu-head">' +
        '      <span class="nav-menu-name">' + esc(user.nickname || user.username) + '</span>' +
        '      <span class="badge ' + roleBadgeClass(currentRole()) + '">' + esc(ROLE_ZH[currentRole()] || currentRole()) + '</span>' +
        '    </div>' +
        '    <button type="button" data-act="avatar">' + ico('image', 15) + '头像</button>' +
        '    <button type="button" data-act="account">' + ico('user', 15) + '账号</button>' +
        '    <button type="button" data-act="profile">' + ico('pen-line', 15) + '编辑资料</button>' +
        '    <button type="button" data-act="password">' + ico('key', 15) + '重置密码</button>' +
        '    <button type="button" data-act="logout" class="nav-menu-danger">' + ico('log-out', 15) + '退出登录</button>' +
        '  </div>' +
        '</div>';
      wireAvatarMenu();
    } else {
      host.innerHTML = '<button class="btn btn-primary" id="nav-login-btn" type="button">登录 / 注册</button>';
      var btn = document.getElementById('nav-login-btn');
      if (btn) {
        btn.addEventListener('click', function () {
          HWAuth.openModal({ stay: true })
            .then(function () { renderAuth(); document.dispatchEvent(new CustomEvent('hw:login')); })
            .catch(function () {});
        });
      }
    }
    refreshBell();
  }

  /* ---------------- 头像菜单 + 账号弹框 ---------------- */
  var ROLE_ZH = { guest: '未登录', member: '普通成员', organizer: '活动组织者', admin: '管理员', superadmin: '超级管理员' };
  function roleBadgeClass(r) {
    return r === 'superadmin' ? 'badge-gold'
         : r === 'admin' ? 'badge-coral'
         : r === 'organizer' ? 'badge-blue'
         : 'badge-quiet';
  }

  function wireAvatarMenu() {
    var user = typeof HWAuth !== 'undefined' ? HWAuth.getSession() : null;
    var btn = document.getElementById('nav-user-btn');
    var menu = document.getElementById('nav-menu');
    if (!btn || !menu) return;
    ensureAccountModals();
    /* P13f：本人被禁赛 → 头像角标 + body.user-banned */
    if (user && user.id) {
      myBanState().then(function (d) {
        if (!isBannedUser(d)) return;
        document.body.classList.add('user-banned');
        var chip = document.getElementById('nav-user-btn');
        if (chip && !chip.querySelector('.ban-dot')) {
          chip.insertAdjacentHTML('beforeend',
            '<span class="ban-dot" title="已禁赛' + (d.banned_reason ? '：' + esc(d.banned_reason) : '') + '">' + ico('ban', 12) + '</span>');
        }
      });
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = menu.hidden;
      menu.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        var closer = function (ev) {
          if (menu.hidden) { document.removeEventListener('click', closer); return; }
          var t = ev.target;
          if (menu.contains(t) || btn.contains(t)) return;
          menu.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          document.removeEventListener('click', closer);
        };
        document.addEventListener('click', closer);
      }
    });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      accountAction(b.dataset.act);
    });
  }

  function accountAction(act) {
    var u = HWAuth.getSession();
    if (!u) return;
    if (act === 'avatar') {
      var avFileInput = document.getElementById('hw-av-file');
      if (avFileInput) avFileInput.value = '';
      updateAvPreview(u.avatar || '');
      openModalById('hw-av-modal');
    } else if (act === 'account') {
      var rows = [
        ['头像', u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;vertical-align:middle;">' : esc(initialOf(u))],
        ['用户名', esc(u.username || '')],
        ['昵称', esc(u.nickname || '')],
        ['账号 ID', '<span class="mono">' + u.id + '</span>'],
        ['角色', esc(ROLE_ZH[currentRole()] || currentRole())],
        ['游戏 ID', u.game_id ? esc(u.game_id) : '—'],
        ['个人简介', u.bio ? esc(u.bio) : '—'],
        ['注册时间', esc(u.created_at ? String(u.created_at).slice(0, 10) : '—')]
      ];
      document.getElementById('hw-acct-rows').innerHTML = rows.map(function (r) {
        return '<div style="display:flex; justify-content:space-between; gap:12px; font-size:14px; border-bottom:1px solid var(--border); padding-bottom:8px;">' +
          '<span class="smoke">' + r[0] + '</span><span style="text-align:right; color:var(--mist); min-width:0; word-break:break-all;">' + r[1] + '</span></div>';
      }).join('');
      openModalById('hw-acct-modal');
    } else if (act === 'profile') {
      document.getElementById('hw-prof-nickname').value = u.nickname || '';
      document.getElementById('hw-prof-gameid').value = u.game_id || '';
      document.getElementById('hw-prof-bio').value = u.bio || '';
      openModalById('hw-prof-modal');
    } else if (act === 'password') {
      document.getElementById('hw-pwd-old').value = '';
      document.getElementById('hw-pwd-new').value = '';
      openModalById('hw-pwd-modal');
    } else if (act === 'logout') {
      try { HWAuth.logout(); } catch (e) { /* ignore */ }
      renderAuth();
      toast('已退出登录');
    }
  }

  function initialOf(u) {
    return esc(((u && (u.nickname || u.username)) || '?').charAt(0).toUpperCase());
  }

  function openModalById(id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('visible');
  }
  function closeModalById(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('visible');
  }
  function updateAvPreview(url) {
    var pv = document.getElementById('hw-av-preview');
    if (!pv) return;
    if (url) {
      pv.innerHTML = '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    } else {
      var u = HWAuth.getSession() || {};
      pv.textContent = initialOf(u);
    }
  }

  var modalsInjected = false;
  function ensureAccountModals() {
    if (modalsInjected && document.getElementById('hw-av-modal')) return;
    modalsInjected = true;
    var hostEl = document.createElement('div');
    hostEl.innerHTML =
      /* 头像 */
      '<div class="modal-backdrop" id="hw-av-modal">' +
      '  <div class="modal-panel" style="max-width:430px;">' +
      '    <button class="modal-close" id="hw-av-close" type="button">&times;</button>' +
      '    <span class="eyebrow">Avatar</span>' +
      '    <h3 class="modal-title" style="margin-top:8px;">头像</h3>' +
      '    <div style="display:flex; gap:16px; align-items:center; margin-top:18px;">' +
      '      <span id="hw-av-preview" style="width:64px;height:64px;border-radius:50%;background:var(--ember-hush);color:var(--coral-pulse);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:600;flex-shrink:0;overflow:hidden;"></span>' +
      '      <div style="flex:1; min-width:0;">' +
      '        <label class="form-label" for="hw-av-file">选择图片（≤5MB，PNG/JPG/WebP）</label>' +
      '        <input class="input" id="hw-av-file" type="file" accept="image/png,image/jpeg,image/webp" style="padding:8px 10px;">' +
      '      </div>' +
      '    </div>' +
      '    <div class="modal-actions">' +
      '      <button class="btn btn-ghost" id="hw-av-clear" type="button">清除</button>' +
      '      <button class="btn btn-primary" id="hw-av-save" type="button">上传头像</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      /* 账号 */
      '<div class="modal-backdrop" id="hw-acct-modal">' +
      '  <div class="modal-panel" style="max-width:430px;">' +
      '    <button class="modal-close" id="hw-acct-close" type="button">&times;</button>' +
      '    <span class="eyebrow">Account</span>' +
      '    <h3 class="modal-title" style="margin-top:8px;">账号</h3>' +
      '    <div id="hw-acct-rows" style="margin-top:16px;"></div>' +
      '    <div class="modal-actions"><button class="btn btn-ghost" id="hw-acct-close-btn" type="button">关闭</button></div>' +
      '  </div>' +
      '</div>' +
      /* 编辑资料 */
      '<div class="modal-backdrop" id="hw-prof-modal">' +
      '  <div class="modal-panel" style="max-width:430px;">' +
      '    <button class="modal-close" id="hw-prof-close" type="button">&times;</button>' +
      '    <span class="eyebrow">Profile</span>' +
      '    <h3 class="modal-title" style="margin-top:8px;">编辑资料</h3>' +
      '    <form id="hw-prof-form" style="margin-top:14px;">' +
      '      <label class="form-label" for="hw-prof-nickname">昵称</label>' +
      '      <input class="input" id="hw-prof-nickname" maxlength="20" placeholder="展示用昵称">' +
      '      <label class="form-label" for="hw-prof-gameid">无畏契约游戏 ID</label>' +
      '      <input class="input" id="hw-prof-gameid" maxlength="30" placeholder="例如 Player#CN1">' +
      '      <label class="form-label" for="hw-prof-bio">个人简介</label>' +
      '      <textarea class="textarea" id="hw-prof-bio" rows="3" maxlength="120" placeholder="常玩位置 / 段位 / 想组队的队友…"></textarea>' +
      '      <div class="modal-actions">' +
      '        <button class="btn btn-ghost" type="button" id="hw-prof-cancel">取消</button>' +
      '        <button class="btn btn-primary" type="submit">保存</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +
      /* 重置密码 */
      '<div class="modal-backdrop" id="hw-pwd-modal">' +
      '  <div class="modal-panel" style="max-width:430px;">' +
      '    <button class="modal-close" id="hw-pwd-close" type="button">&times;</button>' +
      '    <span class="eyebrow">Security</span>' +
      '    <h3 class="modal-title" style="margin-top:8px;">重置密码</h3>' +
      '    <form id="hw-pwd-form" style="margin-top:14px;">' +
      '      <label class="form-label" for="hw-pwd-old">原密码</label>' +
      '      <input class="input" id="hw-pwd-old" type="password" placeholder="原密码">' +
      '      <label class="form-label" for="hw-pwd-new">新密码</label>' +
      '      <input class="input" id="hw-pwd-new" type="password" placeholder="至少 4 位">' +
      '      <div class="modal-actions">' +
      '        <button class="btn btn-ghost" type="button" id="hw-pwd-cancel">取消</button>' +
      '        <button class="btn btn-primary" type="submit">确认修改</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';
    while (hostEl.firstChild) document.body.appendChild(hostEl.firstChild);

    /* 关闭：仅手动 ×/取消（Phase 11） */
    [['hw-av-close', 'hw-av-modal'], ['hw-acct-close', 'hw-acct-modal'], ['hw-acct-close-btn', 'hw-acct-modal'],
     ['hw-prof-close', 'hw-prof-modal'], ['hw-prof-cancel', 'hw-prof-modal'],
     ['hw-pwd-close', 'hw-pwd-modal'], ['hw-pwd-cancel', 'hw-pwd-modal']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.addEventListener('click', function () { closeModalById(pair[1]); });
    });
    document.getElementById('hw-av-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      try { updateAvPreview(URL.createObjectURL(f)); } catch (err) { /* ignore */ }
    });
    document.getElementById('hw-av-save').addEventListener('click', function () {
      var u = HWAuth.getSession();
      if (!u) { toast('请先登录', 'err'); return; }
      var fi = document.getElementById('hw-av-file');
      var f = fi && fi.files && fi.files[0];
      if (!f) { toast('请先选择图片', 'err'); return; }
      if (f.size > 5 * 1024 * 1024) { toast('图片不能超过 5MB', 'err'); return; }
      var sb = typeof HWAuth !== 'undefined' && HWAuth.getClient ? HWAuth.getClient() : null;
      if (!sb || !sb.storage) { toast('存储不可用', 'err'); return; }
      var ext = (String(f.name).match(/\\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
      var path = 'avatar-' + u.id + '-' + Date.now() + ext;
      sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type || 'image/png' })
        .then(function (res) {
          if (res && res.error) throw new Error(res.error.message || '上传失败');
          var pub = sb.storage.from('avatars').getPublicUrl(path);
          var url = pub && pub.data && pub.data.publicUrl ? pub.data.publicUrl : '';
          if (!url) throw new Error('无法获取图片地址');
          return HWAuth.updateProfile({ avatar: url }).then(function () {
            renderAuth(); toast('头像已更新'); closeModalById('hw-av-modal');
          });
        })
        .catch(function (err) { toast('上传失败：' + ((err && err.message) || '未知错误'), 'err'); });
    });
    document.getElementById('hw-av-clear').addEventListener('click', function () {
      HWAuth.updateProfile({ avatar: '' }).then(function () {
        renderAuth(); toast('头像已清除'); closeModalById('hw-av-modal');
      }).catch(function (err) { toast((err && err.message) || '保存失败', 'err'); });
    });
    document.getElementById('hw-prof-form').addEventListener('submit', function (e) {
      e.preventDefault();
      HWAuth.updateProfile({
        nickname: document.getElementById('hw-prof-nickname').value.trim(),
        game_id: document.getElementById('hw-prof-gameid').value.trim(),
        bio: document.getElementById('hw-prof-bio').value.trim()
      }).then(function () {
        renderAuth(); toast('资料已保存'); closeModalById('hw-prof-modal');
        try { document.dispatchEvent(new CustomEvent('hw:profile')); } catch (err) { /* ignore */ }
      }).catch(function (err) { toast((err && err.message) || '保存失败', 'err'); });
    });
    document.getElementById('hw-pwd-form').addEventListener('submit', function (e) {
      e.preventDefault();
      HWAuth.changePassword(
        document.getElementById('hw-pwd-old').value,
        document.getElementById('hw-pwd-new').value
      ).then(function () {
        toast('密码修改成功');
        document.getElementById('hw-pwd-old').value = '';
        document.getElementById('hw-pwd-new').value = '';
        closeModalById('hw-pwd-modal');
      }).catch(function (err) { toast((err && err.message) || '修改失败', 'err'); });
    });
  }

  /* ---------------- boot ---------------- */
  var layoutInited = false;
  function init() {
    if (layoutInited) return;
    layoutInited = true;
    if (typeof HWAuth !== 'undefined' && !HWAuth.getSession()) {
      try { HWAuth.init(); } catch (e) { /* offline */ }
    }
    buildNav();
    buildFooter();
    renderAuth();
    if (typeof HWAuth !== 'undefined' && HWAuth.on) {
      HWAuth.on(function (evt) {
        if (evt === 'login' || evt === 'logout') renderAuth();
      });
    }
    document.addEventListener('hw:admin', function () { renderAuth(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HWLayout = {
    renderAuth: renderAuth,
    NAV: NAV,
    FOOTER_LINKS: FOOTER_LINKS,
    getTheme: getTheme,
    setTheme: setTheme,
    access: access,
    isAdminNow: isAdminNow,
    markAdmin: markAdmin,
    promoteRole: promoteRole,
    resolveEvent: resolveEvent,
    seasonKey: seasonKey,
    eventBar: eventBar,
    toast: toast,
    ico: ico,
    getRole: currentRole,
    roleRank: roleRank,
    atLeast: atLeast,
    isSuperAdminNow: isSuperAdminNow,
    recalcBalance: recalcBalance,
    recalcAfterScoreChange: recalcAfterScoreChange,
    exportCsv: exportCsv,
    exportIcs: exportIcs,
    isBannedUser: isBannedUser,
    bannedBadgeHtml: bannedBadgeHtml,
    fetchEventBan: fetchEventBan,
    myBanState: myBanState,
    promoteWaitlist: promoteWaitlist,
    broadcastNotifications: broadcastNotifications,
    notifyUser: notifyUser,
    notifyAdmins: notifyAdmins,
    notifyMatchDue: notifyMatchDue,
    roleBadgeClass: roleBadgeClass,
    ROLE_ZH: ROLE_ZH,
    refreshBell: refreshBell
  };
})();
