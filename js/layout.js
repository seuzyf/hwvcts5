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
    { id: 'index',  href: 'index.html',  label: '主页' },
    { id: 'events', href: 'events.html', label: '活动' },
    { id: 'admin',  href: 'admin.html',  label: '管理后台' }
  ];

  var FOOTER_LINKS = [
    { href: 'game.html', label: '剧情模式' }
  ];

  var EV_TABS = [
    { page: 'events',   href: 'events.html?open={id}', label: '概况' },
    { page: 'schedule', href: 'schedule.html?event={id}', label: '赛程' },
    { page: 'matches',  href: 'matches.html?event={id}',  label: '比赛' },
    { page: 'summary',  href: 'summary.html?event={id}',  label: '数据' },
    { page: 'betting',  href: 'betting.html?event={id}',  label: '竞猜' },
    { page: 'draft',    href: 'draft.html?event={id}',    label: '分队', need: 'staff' },
    { page: 'manage',   href: 'manage.html?event={id}',   label: '管理', need: 'manage' }
  ];

  var SUN_SVG = '<svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON_SVG = '<svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildNav() {
    var page = document.body.dataset.page || '';
    var crumb = document.body.dataset.crumb || '';

    var linksHtml = NAV.map(function (item) {
      var active = item.id === page || (crumb && item.id === crumb);
      return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + item.href + '">' + item.label + '</a>';
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
      '  <button class="theme-toggle" id="nav-theme-btn" type="button" aria-label="切换浅色/深色模式" title="浅色 / 深色模式">' +
            SUN_SVG + MOON_SVG +
      '  </button>' +
      '  <span id="nav-auth"></span>' +
      '</div>';
    document.body.appendChild(nav);

    var themeBtn = document.getElementById('nav-theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        setTheme(getTheme() === 'light' ? 'dark' : 'light');
      });
    }
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
        isEventCaptain: admin
      };
      return attachEventCaptain(result);
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
        cell('形式', esc(ev.format || '')) +
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
      if (e.target === m || (e.target.closest && e.target.closest('[data-ov-close]'))) m.remove();
    });
  }

  /* ---------------- Auth chip ---------------- */
  function renderAuth() {
    var host = document.getElementById('nav-auth');
    if (!host) return;

    if (typeof HWAuth === 'undefined') { host.innerHTML = ''; return; }

    var user = HWAuth.getSession();
    if (user) {
      var initial = esc((user.nickname || user.username || '?').charAt(0).toUpperCase());
      var admin = isAdminNow();
      host.innerHTML =
        '<a class="nav-user" href="index.html" title="个人主页' + (admin ? ' · 管理员' : '') + '">' +
        '  <span class="nav-avatar' + (admin ? ' is-admin' : '') + '">' + initial + '</span>' +
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
  }

  /* ---------------- boot ---------------- */
  function init() {
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
    eventBar: eventBar
  };
})();
