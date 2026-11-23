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
    "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />\n  <path d=\"m9 12 2 2 4-4\" />"
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
    return sb.from('site_users').select('id').eq('role', 'admin')
      .then(function (res) {
        var ids = ((res && !res.error && res.data) || []).map(function (x) { return x.id; });
        if (!ids.length) return null;
        return sb.from('notifications').insert(ids.map(function (id) {
          return { user_id: id, title: String(title || ''), body: String(body || ''), link: String(link || '') };
        }));
      }).then(function (r) { refreshBell(); return r; }).catch(function () { return null; });
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
  function isRoleAdmin() {
    var u = typeof HWAuth !== 'undefined' ? HWAuth.getSession() : null;
    return !!(u && u.role === 'admin');
  }
  function isAdminNow() { return isRoleAdmin() || adminRemainingMs() > 0; }

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
    host.hidden = false;

    if (!ev) {
      host.innerHTML =
        '<div class="event-bar notice">' +
        '  <span class="ev-note">未绑定活动 — 请从 <a href="events.html">活动大厅</a> 选择一个活动进入，' +
        '赛程 / 比赛 / 数据 / 竞猜都会跟随该活动的赛季与状态。</span>' +
        '</div>';
      return;
    }

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

  /* ---------------- Auth chip ---------------- */
  function currentRole() {
    var u = (typeof HWAuth !== 'undefined') ? HWAuth.getSession() : null;
    if (isAdminNow()) return 'admin';
    if (!u) return 'guest';
    if (u.role === 'admin') return 'admin';
    if (u.role === 'organizer') return 'organizer';
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
        '<a class="nav-user" href="index.html" title="个人主页' + (admin ? ' · 管理员' : '') + '">' +
        (avUrl
          ? '<img class="nav-avatar nav-avatar-img' + (admin ? ' is-admin' : '') + '" src="' + esc(avUrl) + '" alt="">'
          : '<span class="nav-avatar' + (admin ? ' is-admin' : '') + '">' + initial + '</span>') +
        '  <span class="nav-username">' + esc(user.nickname || user.username) + '</span>' +
        '</a>';
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
    notifyUser: notifyUser,
    notifyAdmins: notifyAdmins,
    refreshBell: refreshBell
  };
})();
