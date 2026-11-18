/**
 * HWVCTS · shared layout
 * Renders the floating glass navigation + footer on every page.
 * Kills the old "each page stacks its own row of links" navigation.
 *
 * Required script order in every page:
 *   supabase CDN → js/auth.js → js/layout.js → page script
 *
 * Mark the current page with: <body data-page="index">
 * Optional sub-page crumb:     <body data-page="schedule" data-crumb="比赛">
 */
(function () {
  'use strict';

  var NAV = [
    { id: 'index',    href: 'index.html',    label: '主页' },
    { id: 'events',   href: 'events.html',   label: '活动' },
    { id: 'matches',  href: 'matches.html',  label: '比赛' },
    { id: 'summary',  href: 'summary.html',  label: '数据' },
    { id: 'betting',  href: 'betting.html',  label: '竞猜' }
  ];

  var FOOTER_LINKS = [
    { href: 'schedule.html', label: '赛程中心' },
    { href: 'draft.html',    label: '分队系统' },
    { href: 'admin.html',    label: '管理后台' },
    { href: 'game.html',     label: '剧情模式' }
  ];

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
      '<div class="nav-auth" id="nav-auth"></div>';
    document.body.appendChild(nav);
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
      '    <span>S6</span><span class="pipe">|</span>' +
      '    <span>v2.0</span>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(footer);
  }

  function renderAuth() {
    var host = document.getElementById('nav-auth');
    if (!host) return;

    if (typeof HWAuth === 'undefined') {
      host.innerHTML = '';
      return;
    }

    var user = HWAuth.getSession();
    if (user) {
      var initial = esc((user.nickname || user.username || '?').charAt(0).toUpperCase());
      host.innerHTML =
        '<a class="nav-user" href="index.html" title="个人主页">' +
        '  <span class="nav-avatar">' + initial + '</span>' +
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HWLayout = { renderAuth: renderAuth, NAV: NAV, FOOTER_LINKS: FOOTER_LINKS };
})();
