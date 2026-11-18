/**
 * HWVCTS 统一账号模块 (auth.js)
 * ---------------------------------------------------------------
 * 全站唯一的登录/注册/会话入口，个人主页与活动报名都依赖它。
 *
 * 账号存储：
 *   - 首选 public.site_users（升级后的统一账号表，含资料字段）
 *   - 若尚未执行 supabase/schema.sql（表不存在），自动回退到
 *     旧的 public.s6_bet_users（竞猜账号表），保证现有功能可用
 *
 * 密码：
 *   - 新注册统一存 SHA-256 十六进制摘要（64 位）
 *   - 迁移脚本会把旧明文密码也转成摘要；校验时自动识别两种格式
 *
 * 会话：localStorage `hw_session`；兼容旧的 `betting-user` 键并自动收编。
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jvmwfjvedijeapnegmqd.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_iDpaoEOqjOK2WDcloYp69Q_UWUCwq-r';

  var SESSION_KEY = 'hw_session';
  var LEGACY_SESSION_KEY = 'betting-user';
  var PRIMARY_TABLE = 'site_users';
  var LEGACY_TABLE = 's6_bet_users';

  var client = null;
  var session = null;        // 当前登录用户（账号表整行）
  var accountSource = null;  // 'site_users' | 's6_bet_users'
  var listeners = [];

  /* ---------------- 基础工具 ---------------- */

  function getClient() {
    if (!client) {
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        throw new Error('Supabase SDK 未加载，请检查网络或 CDN 引用');
      }
      client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return client;
  }

  function sha256Hex(text) {
    if (!(window.crypto && window.crypto.subtle)) {
      return Promise.reject(new Error('当前环境不支持 Web Crypto（需 HTTPS 或 localhost）'));
    }
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function looksLikeHash(v) {
    return /^[a-f0-9]{64}$/i.test(v || '');
  }

  function verifyPassword(plain, stored) {
    if (looksLikeHash(stored)) {
      return sha256Hex(plain).then(function (h) {
        return h === stored.toLowerCase();
      });
    }
    // 旧数据为明文
    return Promise.resolve(plain === stored);
  }

  function isMissingTable(error) {
    if (!error) return false;
    return error.code === '42P01' ||
      error.code === 'PGRST205' ||
      /could not find the table|does not exist/i.test(error.message || '');
  }

  function emit(eventName, payload) {
    listeners.forEach(function (fn) {
      try { fn(eventName, payload); } catch (e) { console.error(e); }
    });
  }

  /* ---------------- 账号表探测与会话 ---------------- */

  function detectAccountSource() {
    if (accountSource) return Promise.resolve(accountSource);
    var sb = getClient();
    return sb.from(PRIMARY_TABLE).select('id').limit(1).then(function (res) {
      if (!res.error) {
        accountSource = PRIMARY_TABLE;
      } else if (isMissingTable(res.error)) {
        accountSource = LEGACY_TABLE; // 尚未执行升级脚本，回退旧表
      } else {
        throw res.error;
      }
      return accountSource;
    });
  }

  function accountTable() {
    return accountSource || PRIMARY_TABLE;
  }

  function saveSession(user) {
    session = user;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      localStorage.removeItem(LEGACY_SESSION_KEY); // 收编旧会话
    } catch (e) { /* ignore */ }
    emit('login', session);
  }

  function clearSession() {
    session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (e) { /* ignore */ }
    emit('logout', null);
  }

  /** 读取本地会话（不校验远端）。兼容旧 betting-user 键。 */
  function readLocalSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
      var legacy = localStorage.getItem(LEGACY_SESSION_KEY);
      if (legacy) {
        var u = JSON.parse(legacy);
        localStorage.setItem(SESSION_KEY, JSON.stringify(u));
        return u;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 按 id 从账号表刷新用户资料；用户被删除则退出登录。 */
  function refresh() {
    if (!session || !session.id) return Promise.resolve(session);
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('*').eq('id', session.id).maybeSingle();
    }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data) {
        clearSession();
        return null;
      }
      session = Object.assign({}, res.data);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
      emit('refresh', session);
      return session;
    });
  }

  /* ---------------- 对外 API ---------------- */

  function init() {
    var local = readLocalSession();
    if (local && local.id) {
      session = local;
      // 静默校验，失败不阻塞页面
      refresh().catch(function () { /* 离线时沿用本地会话 */ });
    }
    return session;
  }

  function getSession() { return session; }
  function isLoggedIn() { return !!session; }

  function on(cb) {
    if (typeof cb === 'function') listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /**
   * 登录（用户名不存在时自动注册，与旧竞猜页行为一致）
   * @returns {Promise<object>} 用户行
   */
  function login(username, password) {
    username = (username || '').trim();
    if (!username || !password) {
      return Promise.reject(new Error('请输入用户名和密码'));
    }
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('*').eq('username', username).maybeSingle().then(function (res) {
        if (res.error) throw res.error;

        if (!res.data) {
          // 自动注册
          var row = { username: username, password: password };
          if (table === PRIMARY_TABLE) {
            row.password = password; // 占位，下面统一哈希
            row.balance = 100;
            row.nickname = username;
            row.role = 'member';
          }
          var insertPwd = table === PRIMARY_TABLE ? password : password;
          var payload = Object.assign({}, row);
          return sha256Hex(insertPwd).then(function (hash) {
            payload.password = hash;
            return sb.from(table).insert([payload]).select().single();
          }).then(function (ins) {
            if (ins.error) throw ins.error;
            saveSession(ins.data);
            return ins.data;
          });
        }

        return verifyPassword(password, res.data.password).then(function (ok) {
          if (!ok) throw new Error('密码错误！');
          var patch = {};
          if (table === PRIMARY_TABLE && 'last_login_at' in res.data) {
            patch.last_login_at = new Date().toISOString();
            sb.from(table).update(patch).eq('id', res.data.id).then(function () { /* best effort */ });
          }
          var merged = Object.assign({}, res.data, patch);
          saveSession(merged);
          return merged;
        });
      });
    });
  }

  /** 显式注册（用户名已存在时报错，不静默覆盖） */
  function register(username, password, profile) {
    username = (username || '').trim();
    if (!username || !password) return Promise.reject(new Error('请输入用户名和密码'));
    if (password.length < 4) return Promise.reject(new Error('密码至少 4 位'));
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('id').eq('username', username).maybeSingle().then(function (res) {
        if (res.error) throw res.error;
        if (res.data) throw new Error('用户名已存在，请直接登录');
        return sha256Hex(password).then(function (hash) {
          var row = { username: username, password: hash };
          if (table === PRIMARY_TABLE) {
            row.balance = 100;
            row.role = 'member';
            row.nickname = (profile && profile.nickname) || username;
            row.game_id = (profile && profile.game_id) || '';
            row.bio = (profile && profile.bio) || '';
          }
          return sb.from(table).insert([row]).select().single();
        }).then(function (ins) {
          if (ins.error) throw ins.error;
          saveSession(ins.data);
          return ins.data;
        });
      });
    });
  }

  function logout() {
    clearSession();
  }

  /** 更新个人资料（仅升级到 site_users 后可用） */
  function updateProfile(patch) {
    if (!session) return Promise.reject(new Error('请先登录'));
    return detectAccountSource().then(function (table) {
      if (table !== PRIMARY_TABLE) {
        throw new Error('尚未执行账号升级脚本（supabase/schema.sql），暂无法保存资料');
      }
      var sb = getClient();
      var allowed = {};
      ['nickname', 'game_id', 'bio', 'role'].forEach(function (k) {
        if (k in patch) allowed[k] = patch[k];
      });
      return sb.from(table).update(allowed).eq('id', session.id).select().single().then(function (res) {
        if (res.error) throw res.error;
        session = Object.assign({}, session, res.data);
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
        emit('refresh', session);
        return session;
      });
    });
  }

  /** 修改密码（校验旧密码） */
  function changePassword(oldPwd, newPwd) {
    if (!session) return Promise.reject(new Error('请先登录'));
    if (!newPwd || newPwd.length < 4) return Promise.reject(new Error('新密码至少 4 位'));
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('password').eq('id', session.id).single();
    }).then(function (res) {
      if (res.error) throw res.error;
      return verifyPassword(oldPwd || '', res.data.password).then(function (ok) {
        if (!ok) throw new Error('原密码错误');
        return sha256Hex(newPwd);
      });
    }).then(function (hash) {
      var sb2 = getClient();
      return sb2.from(accountSource).update({ password: hash }).eq('id', session.id).select().single();
    }).then(function (res) {
      if (res.error) throw res.error;
      session = Object.assign({}, session, res.data);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
      return true;
    });
  }

  /** 未登录时打开登录/注册弹窗；opts.stay=true 表示登录后留在当前页 */
  function openModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (session) { resolve(session); return; }
      mountModal(opts, resolve, reject);
    });
  }

  /* ---------------- 注入式登录弹窗（自带样式，任何页面可用） ---------------- */

  var MODAL_HTML = [
    '<div class="hw-auth-backdrop" id="hw-auth-backdrop">',
    '  <div class="hw-auth-card">',
    '    <button class="hw-auth-close" id="hw-auth-close" aria-label="关闭">&times;</button>',
    '    <div class="hw-auth-badge">HWVCTS ACCOUNT</div>',
    '    <h3 id="hw-auth-title">登 录</h3>',
    '    <div class="hw-auth-tabs">',
    '      <button class="active" data-tab="login" type="button">登 录</button>',
    '      <button data-tab="register" type="button">注 册</button>',
    '    </div>',
    '    <form id="hw-auth-form" autocomplete="off">',
    '      <input type="text" id="hw-auth-username" placeholder="用户名（建议使用真名）" required>',
    '      <input type="password" id="hw-auth-password" placeholder="密码" required>',
    '      <input type="text" id="hw-auth-nickname" placeholder="昵称（注册时可选）" style="display:none">',
    '      <div class="hw-auth-error" id="hw-auth-error"></div>',
    '      <button type="submit" class="hw-auth-submit" id="hw-auth-submit">确 认</button>',
    '    </form>',
    '    <p class="hw-auth-hint">登录后进入个人主页，可报名参赛、管理我的活动</p>',
    '  </div>',
    '</div>'
  ].join('');

  var MODAL_CSS = [
    /* unified modal language — mirrors css/theme.css (vars with fallbacks so
       the login dialog also works on pages without the design system) */
    '.hw-auth-backdrop{position:fixed;inset:0;background:rgba(2,2,3,.78);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s;padding:20px}',
    '.hw-auth-backdrop.visible{opacity:1}',
    '.hw-auth-card{position:relative;width:100%;max-width:420px;background:var(--ink,#07080a);border:none;border-radius:20px;padding:28px;box-shadow:var(--panel-shadow,0 25px 60px rgba(0,0,0,.6));font-family:var(--font-inter,"Inter","Noto Sans SC",sans-serif);color:var(--mist,#e6e6e6)}',
    '.hw-auth-close{position:absolute;top:14px;right:16px;width:30px;height:30px;background:none;border:none;border-radius:8px;color:var(--ash,#9c9c9d);font-size:22px;cursor:pointer;line-height:1}',
    '.hw-auth-close:hover{background:var(--graphite,#1b1c1e);color:var(--pure-white,#fff)}',
    '.hw-auth-badge{display:block;font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--smoke,#6a6b6c);margin-bottom:8px;text-align:left}',
    '.hw-auth-card h3{margin:0 0 18px;padding-bottom:14px;border-bottom:1px solid var(--border,#363739);font-size:18px;letter-spacing:.02em;font-weight:500;text-align:left;color:var(--pure-white,#fff)}',
    '.hw-auth-tabs{display:flex;gap:6px;margin-bottom:16px;padding:3px;background:var(--obsidian,#111214);border:1px solid var(--border,#363739);border-radius:8px}',
    '.hw-auth-tabs button{flex:1;height:30px;border:none;background:transparent;color:var(--ash,#9c9c9d);border-radius:6px;cursor:pointer;font-size:13px;letter-spacing:.02em;transition:.15s;font-family:inherit;font-weight:500}',
    '.hw-auth-tabs button.active{background:var(--graphite,#1b1c1e);color:var(--pure-white,#fff);box-shadow:rgba(255,255,255,.06) 0 1px 0 0 inset}',
    '.hw-auth-card input{width:100%;height:38px;margin-bottom:12px;padding:0 12px;background:rgba(255,255,255,.05);border:1px solid var(--border,#363739);border-radius:8px;color:var(--pure-white,#fff);font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .15s}',
    '.hw-auth-card input:focus{border-color:var(--smoke,#6a6b6c)}',
    '.hw-auth-error{min-height:18px;font-size:12px;color:#ff8f8f;margin-bottom:6px;text-align:left}',
    '.hw-auth-submit{width:100%;height:38px;background:var(--mist,#e6e6e6);border:none;border-radius:8px;color:var(--iron,#454647);font-size:14px;letter-spacing:.02em;cursor:pointer;transition:background .15s,color .15s;font-family:inherit;font-weight:500}',
    '.hw-auth-submit:hover{background:var(--pure-white,#fff);color:var(--void-black,#040506)}',
    '.hw-auth-submit:disabled{opacity:.5;cursor:wait}',
    '.hw-auth-hint{margin:14px 0 0;font-size:12px;color:var(--smoke,#6a6b6c);text-align:left;line-height:1.6}',
    '[data-theme="light"] .hw-auth-backdrop{background:rgba(16,17,19,.42)}',
    '[data-theme="light"] .hw-auth-card{background:#fff}',
    '[data-theme="light"] .hw-auth-card input{background:rgba(0,0,0,.03);border-color:#dcdcde;color:#101113}',
    '[data-theme="light"] .hw-auth-tabs{background:#f7f7f8;border-color:#dcdcde}',
    '[data-theme="light"] .hw-auth-tabs button.active{background:#ececee;color:#101113;box-shadow:rgba(0,0,0,.06) 0 1px 0 0 inset}',
    '[data-theme="light"] .hw-auth-submit{color:#f6f6f7}',
    '[data-theme="light"] .hw-auth-submit:hover{background:#101113;color:#f6f6f7}'
  ].join('');

  function mountModal(opts, resolve, reject) {
    if (document.getElementById('hw-auth-backdrop')) return;

    if (!document.getElementById('hw-auth-style')) {
      var style = document.createElement('style');
      style.id = 'hw-auth-style';
      style.textContent = MODAL_CSS;
      document.head.appendChild(style);
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML;
    document.body.appendChild(wrap.firstChild);

    var backdrop = document.getElementById('hw-auth-backdrop');
    var form = document.getElementById('hw-auth-form');
    var errEl = document.getElementById('hw-auth-error');
    var submitBtn = document.getElementById('hw-auth-submit');
    var nickInput = document.getElementById('hw-auth-nickname');
    var mode = 'login';

    function close(rej) {
      backdrop.classList.remove('visible');
      setTimeout(function () {
        backdrop.remove();
        if (rej) reject(new Error('已取消登录'));
      }, 220);
    }

    backdrop.querySelectorAll('.hw-auth-tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        backdrop.querySelectorAll('.hw-auth-tabs button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        mode = btn.dataset.tab;
        document.getElementById('hw-auth-title').textContent = mode === 'login' ? '登 录' : '注 册';
        submitBtn.textContent = mode === 'login' ? '登 录' : '注 册';
        nickInput.style.display = mode === 'register' ? 'block' : 'none';
        errEl.textContent = '';
      });
    });

    document.getElementById('hw-auth-close').addEventListener('click', function () { close(true); });
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(true); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = document.getElementById('hw-auth-username').value.trim();
      var password = document.getElementById('hw-auth-password').value;
      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '处理中...';

      var action = mode === 'login'
        ? login(username, password)
        : register(username, password, { nickname: nickInput.value.trim() || username });

      action.then(function (user) {
        close();
        if (!opts.stay && opts.redirect !== false) {
          window.location.href = 'index.html'; // 登录落地：个人主页
        } else {
          resolve(user);
        }
      }).catch(function (err) {
        errEl.textContent = err.message || '操作失败，请重试';
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? '登 录' : '注 册';
      });
    });

    requestAnimationFrame(function () { backdrop.classList.add('visible'); });
  }

  /** 页面辅助：未登录则打开弹窗，已登录直接返回会话 */
  function requireLogin(opts) {
    if (session) return Promise.resolve(session);
    return openModal(opts || {});
  }

  window.HWAuth = {
    init: init,
    login: login,
    register: register,
    logout: logout,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    refresh: refresh,
    updateProfile: updateProfile,
    changePassword: changePassword,
    openModal: openModal,
    requireLogin: requireLogin,
    on: on,
    accountTable: accountTable,
    detectAccountSource: detectAccountSource,
    getClient: getClient,
    isMissingTable: isMissingTable
  };
})();
