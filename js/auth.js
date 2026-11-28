/**
 * HWVCTS 统一账号模块 (auth.js)
 * ---------------------------------------------------------------
 * 全站唯一的登录/注册/会话入口，个人主页与活动报名都依赖它。
 *
 * 账号存储：
 *   - 首选 public.site_users（升级后的统一账号表，含资料字段）
 *   - 若尚未执行 supabase/install.sql（表不存在），自动回退到
 *     旧的 public.s6_bet_users（竞猜账号表），保证现有功能可用
 *
 * 密码：
 *   - 新注册统一存 PBKDF2-SHA-256（12 万轮 + 每用户随机盐）
 *   - 历史数据（SHA-256 摘要 / 明文）登录时自动校验并升级，用户无感
 *
 * 会话：localStorage `hw_session`；兼容旧的 `betting-user` 键并自动收编。
 */
(function () {
  'use strict';

  /* Supabase 连接配置已收敛到 js/layout.js 的 HWLayout.supa()（全站唯一出处），
     本模块不再自带 URL/KEY 副本。 */
  var SESSION_KEY = 'hw_session';
  var SESSION_META_KEY = 'hw_session_meta';   // {issued_at, last_seen}：7 天滑动 / 30 天强制重登
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
      if (typeof HWLayout !== 'undefined' && HWLayout.supa) {
        client = HWLayout.supa();
      } else if (typeof supabase !== 'undefined' && supabase.createClient && typeof HWLayout !== 'undefined' && HWLayout.SUPABASE_URL) {
        client = supabase.createClient(HWLayout.SUPABASE_URL, HWLayout.SUPABASE_KEY);
      } else {
        throw new Error('Supabase 客户端未就绪（js/layout.js 未加载）');
      }
    }
    return client;
  }

  /* ---------------- 登录限流与会话时效 ----------------
   * login_attempts 表不存在（未执行 install.sql）时静默跳过，不阻断登录。 */
  function recentLoginFails(sb, username) {
    try {
      var since = new Date(Date.now() - 10 * 60000).toISOString();
      return sb.from('login_attempts').select('id', { count: 'exact', head: true })
        .eq('scope', 'login').eq('username', username).eq('success', false)
        .gte('attempted_at', since)
        .then(function (r) { return r && typeof r.count === 'number' ? r.count : 0; }, function () { return 0; });
    } catch (e) { return Promise.resolve(0); }
  }
  function recordLoginAttempt(sb, username, userId, ok) {
    try {
      sb.from('login_attempts').insert([{ username: username, user_id: userId || null, scope: 'login', success: !!ok }])
        .then(function () {}, function () {});
      if (ok) {
        sb.from('login_attempts').delete().eq('scope', 'login').eq('username', username).eq('success', false)
          .then(function () {}, function () {});
      }
    } catch (e) { /* ignore */ }
  }
  function sessionMeta() {
    try { return JSON.parse(localStorage.getItem(SESSION_META_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeSessionMeta(issuedAt) {
    try {
      var now = Date.now();
      var meta = sessionMeta() || {};
      localStorage.setItem(SESSION_META_KEY, JSON.stringify({
        issued_at: issuedAt || meta.issued_at || now, last_seen: now
      }));
    } catch (e) { /* ignore */ }
  }
  /* 返回 'ok' | 'expired'（7 天未活动或满 30 天） */
  function sessionFreshness() {
    var meta = sessionMeta();
    if (!meta || !meta.issued_at) return 'ok';  // 旧会话无 meta：从本次起计
    var now = Date.now();
    if (now - meta.issued_at > 30 * 86400000) return 'expired';
    if (meta.last_seen && now - meta.last_seen > 7 * 86400000) return 'expired';
    return 'ok';
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

  /* ---------------- 密码哈希（PBKDF2-SHA-256，带随机盐） ----------------
   * 存储格式：pbkdf2$<iter>$<saltB64>$<hashHex>
   * 兼容历史数据：64 位十六进制 SHA-256、以及更早的明文。
   * 登录成功后自动把旧格式升级为新格式（用户无感）。
   */
  var PBKDF2_ITER = 120000;

  function randomB64(bytes) {
    var arr = new Uint8Array(bytes);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach(function (_, i) {
      arr[i] = Math.floor(Math.random() * 256);
    });
    return btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(arr)));
  }

  function pbkdf2Hex(plain, saltB64, iter) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.reject(new Error('no-webcrypto'));
    var enc = new TextEncoder();
    var salt = Uint8Array.from(atob(saltB64), function (c) { return c.charCodeAt(0); });
    return crypto.subtle.importKey('raw', enc.encode(plain), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, key, 256);
      })
      .then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      });
  }

  function hashPassword(plain) {
    if (!(window.crypto && window.crypto.subtle)) {
      return Promise.reject(new Error('当前环境不支持安全密码存储（需 HTTPS 或 localhost）'));
    }
    var salt = randomB64(16);
    return pbkdf2Hex(plain, salt, PBKDF2_ITER).then(function (hex) {
      return 'pbkdf2$' + PBKDF2_ITER + '$' + salt + '$' + hex;
    });
  }

  function needsRehash(stored) {
    return !/^\s*pbkdf2\$/i.test(stored || '');
  }

  /* 哨兵：账号密文已不可验证（历史二次哈希 / 管理员手动锁定）→ 必须重置，不是"密码错" */
  var LOCKED_SENTINEL = '!locked!';
  function isLockedRow(row) {
    return !!row && (row.must_reset === true || String(row.password || '') === LOCKED_SENTINEL);
  }

  function verifyPassword(plain, stored) {
    stored = stored == null ? '' : String(stored);
    var m = /^pbkdf2\$(\d+)\$([^$]+)\$([a-f0-9]+)$/i.exec(stored);
    if (m) {
      return pbkdf2Hex(plain, m[2], parseInt(m[1], 10)).then(function (h) {
        return h.toLowerCase() === m[3].toLowerCase();
      });
    }
    if (/^[a-f0-9]{64}$/i.test(stored)) {
      return sha256Hex(plain).then(function (h) { return h === stored.toLowerCase(); });
    }
    // 旧数据为明文
    return Promise.resolve(plain === stored);
  }

  /** 登录成功后把旧哈希升级为 PBKDF2（失败静默，下次再试） */
  function upgradeHashIfLegacy(table, row, plain) {
    if (!row || !row.id || !needsRehash(row.password)) return;
    if (!(window.crypto && window.crypto.subtle)) return;
    hashPassword(plain).then(function (next) {
      /* password 列已对 anon 收回直写权限（install.sql 5.7quater），
         只能通过这个 RPC 写回；失败就保持旧哈希，下次登录再试。 */
      return getClient().rpc('set_password_hash', { p_user_id: row.id, p_new_hash: next });
    }).then(function () { /* best effort */ }, function () { /* best effort */ });
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

  function saveSession(user, freshLogin) {
    session = user;
    try {
      /* 只持久化必要字段：绝不把密码哈希写进 localStorage */
      var pub = Object.assign({}, user);
      delete pub.password;
      localStorage.setItem(SESSION_KEY, JSON.stringify(pub));
      localStorage.removeItem(LEGACY_SESSION_KEY); // 收编旧会话
      writeSessionMeta(freshLogin ? Date.now() : undefined);
    } catch (e) { /* ignore */ }
    emit('login', session);
  }

  var sessionExpiredFlag = false;
  function clearSession() {
    session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      localStorage.removeItem(SESSION_META_KEY);
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
      try {
        var pub2 = Object.assign({}, session);
        delete pub2.password;
        localStorage.setItem(SESSION_KEY, JSON.stringify(pub2));
        writeSessionMeta();
      } catch (e) { /* ignore */ }
      emit('refresh', session);
      return session;
    });
  }

  /* ---------------- 对外 API ---------------- */

  function init() {
    var local = readLocalSession();
    if (local && local.id && sessionFreshness() === 'expired') {
      /* 7 天未活动或登录满 30 天：强制重登（页面可读 HWAuth.sessionExpired 提示并回跳） */
      sessionExpiredFlag = true;
      try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LEGACY_SESSION_KEY);
        localStorage.removeItem(SESSION_META_KEY);
      } catch (e) { /* ignore */ }
      return null;
    }
    if (local && local.id) {
      session = local;
      // 静默校验，失败不阻塞页面
      refresh().catch(function () { /* 离线时沿用本地会话 */ });
    }
    return session;
  }

  function getSession() { return session; }
  function wasSessionExpired() { return sessionExpiredFlag; }
  function isLoggedIn() { return !!session; }

  function on(cb) {
    if (typeof cb === 'function') listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /**
   * 登录。用户名不存在时**不再自动注册**（安全整改），
   * 注册必须显式走 register()（登录弹窗的「注册」页签）。
   * @returns {Promise<object>} 用户行
   */
  function login(username, password) {
    username = (username || '').trim();
    if (!username || !password) {
      return Promise.reject(new Error('请输入用户名和密码'));
    }
    var sb = getClient();
    return recentLoginFails(sb, username).then(function (fails) {
      if (fails >= 5) {
        throw new Error('密码错误次数过多，该账号已锁定 10 分钟，请稍后再试');
      }
      return detectAccountSource();
    }).then(function (table) {
      return sb.from(table).select('*').eq('username', username).maybeSingle().then(function (res) {
        if (res.error) throw res.error;

        if (!res.data) {
          recordLoginAttempt(sb, username, null, false);
          var err = new Error('用户名不存在，请先注册');
          err.code = 'USER_NOT_FOUND';
          throw err;
        }

        /* 账号处于"密文不可验证"状态：说清是什么问题，并给出唯一可行的一步，
           而不是让人反复试密码（那样只会把人锁在门外） */
        if (isLockedRow(res.data)) {
          var lerr = new Error('该账号的密码需要重置（历史升级导致），请点下方「重置密码」或联系管理员');
          lerr.code = 'PASSWORD_RESET_REQUIRED';
          throw lerr;
        }
        return verifyPassword(password, res.data.password).then(function (ok) {
          if (!ok) {
            recordLoginAttempt(sb, username, res.data.id, false);
            /* 连续失败 3 次后，提示里直接给出"忘记密码"的去处 */
            return recentLoginFails(sb, username).then(function (n) {
              var e = new Error(n >= 2
                ? '密码错误。如果确定没记错，可能是升级时密码失效了，试试「重置密码」。'
                : '密码错误！');
              e.code = 'BAD_PASSWORD';
              throw e;
            });
          }
          if (res.data.banned && (!res.data.banned_until || new Date(res.data.banned_until).getTime() > Date.now())) {
            throw new Error('该账号已被停用' + (res.data.banned_reason ? '：' + res.data.banned_reason : '') + '，请联系管理员');
          }
          recordLoginAttempt(sb, username, res.data.id, true);
          var patch = {};
          if (table === PRIMARY_TABLE && 'last_login_at' in res.data) {
            patch.last_login_at = new Date().toISOString();
          }
          var merged = Object.assign({}, res.data, patch);
          if (Object.keys(patch).length) {
            sb.from(table).update(patch).eq('id', res.data.id).then(function () { /* best effort */ }, function () {});
          }
          upgradeHashIfLegacy(table, res.data, password);
          saveSession(merged, true);
          return merged;
        });
      });
    });
  }

  /** 显式注册（用户名已存在时报错，不静默覆盖） */
  function register(username, password, profile) {
    username = (username || '').trim();
    if (!username || !password) return Promise.reject(new Error('请输入账户名和密码'));
    if (password.length < 6) return Promise.reject(new Error('密码至少 6 位'));
    if (profile && profile.password2 !== undefined && profile.password2 !== password) {
      return Promise.reject(new Error('两次输入的密码不一致'));
    }
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('id').eq('username', username).maybeSingle().then(function (res) {
        if (res.error) throw res.error;
        if (res.data) throw new Error('该账户名已注册，请直接登录');
        return hashPassword(password).then(function (hash) {
          var row = { username: username, password: hash };
          if (table === PRIMARY_TABLE) {
            row.balance = 100;
            row.role = 'member';
            row.nickname = (profile && (profile.realName || profile.nickname)) || username;
            row.game_id = (profile && profile.game_id) || '';
            row.bio = (profile && profile.bio) || '';
          }
          return sb.from(table).insert([row]).select().single();
        }).then(function (ins) {
          if (ins.error) throw ins.error;
          /* 工号/真名写入选手档案（reg_profiles 已有 staff_no 列，无需迁移） */
          var staffNo = (profile && profile.staff_no || '').trim();
          var realName = ((profile && (profile.realName || profile.nickname)) || username).trim();
          var profileWrite = (table === PRIMARY_TABLE)
            ? sb.from('reg_profiles').upsert({
                user_id: ins.data.id,
                real_name: realName,
                staff_no: staffNo
              }).then(function () { /* best-effort：档案表异常不阻断注册 */ }, function () {})
            : Promise.resolve();
          return profileWrite.then(function () {
            saveSession(ins.data, true);
            return ins.data;
          });
        });
      });
    });
  }

  function logout() {
    clearSession();
  }

  /** 二次确认：校验当前登录账号自己的密码（生成临时口令等敏感操作用） */
  function verifyOwnPassword(pwd) {
    if (!session || !session.id) return Promise.resolve(false);
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('password').eq('id', session.id).maybeSingle();
    }).then(function (res) {
      if (res.error || !res.data) return false;
      return verifyPassword(pwd || '', res.data.password);
    }).catch(function () { return false; });
  }

  /** 当前账号库中的密码哈希（供高危 RPC 证明"我持有该账号的凭据"）。
   *  这不是明文，但足以在服务端识别调用者身份 —— 站点是自建登录，
   *  auth.uid() 恒为空，没有别的办法让服务端确认"你是谁"。
   *  失败返回空字符串（调用方据此给出"请重新登录"提示）。 */
  function ownCredentialHash() {
    if (!session || !session.id) return Promise.resolve('');
    return detectAccountSource().then(function (table) {
      return getClient().from(table).select('password').eq('id', session.id).maybeSingle();
    }).then(function (res) {
      if (res.error || !res.data) return '';
      return String(res.data.password || '');
    }).catch(function () { return ''; });
  }

  /** 更新个人资料（仅升级到 site_users 后可用） */
  function updateProfile(patch) {
    if (!session) return Promise.reject(new Error('请先登录'));
    return detectAccountSource().then(function (table) {
      if (table !== PRIMARY_TABLE) {
        throw new Error('尚未执行账号升级脚本（supabase/install.sql），暂无法保存资料');
      }
      var sb = getClient();
      var allowed = {};
      ['nickname', 'game_id', 'bio', 'avatar'].forEach(function (k) {
        /* role 不允许自助修改：角色变更必须走 promoteRole() 的服务端校验 */
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

  /** 管理员重置他人密码：统一走 PBKDF2（旧实现调用了不存在的 sha256Hex） */
  function resetPassword(userId, newPassword) {
    if (!userId) return Promise.reject(new Error('缺少用户'));
    if (!newPassword || newPassword.length < 6) {
      return Promise.reject(new Error('新密码至少 6 位'));
    }
    return detectAccountSource().then(function (table) {
      return hashPassword(newPassword).then(function (hash) {
        /* 统一走 RPC：password 列已对 anon 收回直写权限（install.sql 5.7quater）。
           must_reset = false（重置即解锁）由 RPC 内部一并完成 —— 不能留在前端拼
           patch，否则列级权限会把它挡掉，被锁的账号重置后仍然打不开。 */
        return getClient().rpc('set_password_hash', { p_user_id: userId, p_new_hash: hash })
          .then(function (r) {
            if (r && r.error) throw r.error;
            var res = (r && r.data) || {};
            if (res.error) throw new Error(res.error);
            return true;
          });
      });
    });
  }

  /** 修改密码（校验旧密码） */
  function changePassword(oldPwd, newPwd) {
    if (!session) return Promise.reject(new Error('请先登录'));
    if (!newPwd || newPwd.length < 6) return Promise.reject(new Error('新密码至少 6 位'));
    var sb = getClient();
    return detectAccountSource().then(function (table) {
      return sb.from(table).select('password').eq('id', session.id).single();
    }).then(function (res) {
      if (res.error) throw res.error;
      return verifyPassword(oldPwd || '', res.data.password).then(function (ok) {
        if (!ok) throw new Error('原密码错误');
        return hashPassword(newPwd);
      });
    }).then(function (hash) {
      /* 走 RPC：password 列不可直写 */
      return getClient().rpc('set_password_hash', { p_user_id: session.id, p_new_hash: hash })
        .then(function (r) {
          if (r && r.error) throw r.error;
          var body = (r && r.data) || {};
          if (body.error) throw new Error(body.error);
          return true;
        });
    }).then(function () {
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
    '  <div class="hw-auth-card" role="dialog" aria-modal="true" aria-labelledby="hw-auth-title">',
    '    <button class="hw-auth-close" id="hw-auth-close" aria-label="关闭">&times;</button>',
    '    <div class="hw-auth-badge">HWVCTS ACCOUNT</div>',
    '    <h3 id="hw-auth-title">登 录</h3>',
    '    <div class="hw-auth-tabs">',
    '      <button class="active" data-tab="login" type="button">登 录</button>',
    '      <button data-tab="register" type="button">注 册</button>',
    '    </div>',
    '    <form id="hw-auth-form" autocomplete="off">',
    '      <label class="hw-auth-label" for="hw-auth-username">账户名（登录用）</label>',
    '      <input type="text" id="hw-auth-username" placeholder="账户名" autocomplete="username" required>',
    '      <label class="hw-auth-label" for="hw-auth-realname" id="hw-auth-realname-label" style="display:none">真实姓名</label>',
    '      <input type="text" id="hw-auth-realname" placeholder="真实姓名（同事间显示）" style="display:none" autocomplete="name">',
    '      <div class="hw-auth-pwrow">',
    '        <div class="hw-auth-pwcol"><label class="hw-auth-label" for="hw-auth-password">密码</label><input type="password" id="hw-auth-password" placeholder="密码" autocomplete="current-password" required></div>',
    '        <div class="hw-auth-pwcol" id="hw-auth-pw2col" style="display:none"><label class="hw-auth-label" for="hw-auth-password2">确认密码</label><input type="password" id="hw-auth-password2" placeholder="确认密码" autocomplete="new-password"></div>',
    '      </div>',
    '      <label class="hw-auth-plain"><input type="checkbox" id="hw-auth-plain-toggle"><span>明文显示</span></label>',
    '      <label class="hw-auth-label" for="hw-auth-staff" id="hw-auth-staff-label" style="display:none">工号（选填）</label>',
    '      <input type="text" id="hw-auth-staff" placeholder="工号" style="display:none" autocomplete="off">',
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
    '.hw-auth-badge{display:block;font-family:var(--font-mono,monospace);font-size: 12px;letter-spacing:.08em;text-transform:uppercase;color:var(--smoke,#6a6b6c);margin-bottom:8px;text-align:left}',
    '.hw-auth-card h3{margin:0 0 18px;padding-bottom:14px;border-bottom:1px solid var(--border,#363739);font-size:18px;letter-spacing:.02em;font-weight:500;text-align:left;color:var(--pure-white,#fff)}',
    '.hw-auth-tabs{display:flex;gap:6px;margin-bottom:16px;padding:3px;background:var(--obsidian,#111214);border:1px solid var(--border,#363739);border-radius:8px}',
    '.hw-auth-tabs button{flex:1;height:30px;border:none;background:transparent;color:var(--ash,#9c9c9d);border-radius:6px;cursor:pointer;font-size: 14px;letter-spacing:.02em;transition:.15s;font-family:inherit;font-weight:500}',
    '.hw-auth-tabs button.active{background:var(--graphite,#1b1c1e);color:var(--pure-white,#fff);box-shadow:rgba(255,255,255,.06) 0 1px 0 0 inset}',
    '.hw-auth-label{display:block;font-size:12px;color:var(--smoke,#6a6b6c);margin:0 0 5px;letter-spacing:.02em}',
    '.hw-auth-pwrow{display:flex;gap:10px}.hw-auth-pwrow .hw-auth-pwcol{flex:1;min-width:0}',
    '@media (max-width:480px){.hw-auth-pwrow{flex-direction:column;gap:0}}',
    '.hw-auth-card input{width:100%;height:38px;margin-bottom:12px;padding:0 12px;background:rgba(255,255,255,.05);border:1px solid var(--border,#363739);border-radius:8px;color:var(--pure-white,#fff);font-size: 15px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .15s}',
    '.hw-auth-card input:focus{border-color:var(--smoke,#6a6b6c)}',
    '.hw-auth-plain{display:flex;align-items:center;gap:7px;margin:-4px 0 10px;font-size:13px;color:var(--smoke,#6a6b6c);cursor:pointer;user-select:none;width:fit-content}',
    '.hw-auth-plain input{width:14px;height:14px;margin:0;accent-color:var(--mist,#e6e6e6);cursor:pointer}',
    '.hw-auth-error{min-height:18px;font-size: 13px;color:#ff8f8f;margin-bottom:6px;text-align:left}',
    '.hw-auth-submit{width:100%;height:38px;background:var(--mist,#e6e6e6);border:none;border-radius:8px;color:var(--iron,#454647);font-size: 15px;letter-spacing:.02em;cursor:pointer;transition:background .15s,color .15s;font-family:inherit;font-weight:500}',
    '.hw-auth-submit:hover{background:var(--pure-white,#fff);color:var(--void-black,#040506)}',
    '.hw-auth-submit:disabled{opacity:.5;cursor:wait}',
    '.hw-auth-hint{margin:14px 0 0;font-size: 13px;color:var(--smoke,#6a6b6c);text-align:left;line-height:1.6}',
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
    var staffInput = document.getElementById('hw-auth-staff');
    var realNameInput = document.getElementById('hw-auth-realname');
    var pw2Input = document.getElementById('hw-auth-password2');
    var plainToggle = document.getElementById('hw-auth-plain-toggle');
    var mode = 'login';

    function setRegisterOnly(visible) {
      staffInput.style.display = visible ? 'block' : 'none';
      document.getElementById('hw-auth-staff-label').style.display = visible ? 'block' : 'none';
      realNameInput.style.display = visible ? 'block' : 'none';
      document.getElementById('hw-auth-realname-label').style.display = visible ? 'block' : 'none';
      realNameInput.required = !!visible;
      document.getElementById('hw-auth-pw2col').style.display = visible ? 'block' : 'none';
      pw2Input.required = !!visible;
      if (!visible) { staffInput.value = ''; realNameInput.value = ''; pw2Input.value = ''; plainToggle.checked = false; }
      syncPlain();
    }
    function syncPlain() {
      var plain = plainToggle.checked;
      document.getElementById('hw-auth-password').type = plain ? 'text' : 'password';
      pw2Input.type = plain ? 'text' : 'password';
    }
    plainToggle.addEventListener('change', syncPlain);
    setRegisterOnly(false);   /* 初始登录态：注册专属字段不参与校验 */

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
        setRegisterOnly(mode === 'register');
        errEl.textContent = '';
      });
    });

    document.getElementById('hw-auth-close').addEventListener('click', function () { close(true); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = document.getElementById('hw-auth-username').value.trim();
      var password = document.getElementById('hw-auth-password').value;
      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '处理中...';

      var action;
      if (mode === 'login') {
        action = login(username, password);
      } else {
        var pw2 = pw2Input.value;
        if (password !== pw2) {
          errEl.textContent = '两次输入的密码不一致';
          submitBtn.disabled = false;
          submitBtn.textContent = '注 册';
          pw2Input.focus();
          return;
        }
        action = register(username, password, {
          realName: realNameInput.value.trim(),
          staff_no: staffInput.value.trim(),
          password2: pw2
        });
      }

      action.then(function (user) {
        close();
        if (!opts.stay && opts.redirect !== false) {
          window.location.href = 'index.html'; // 登录落地：个人主页
        } else {
          resolve(user);
        }
      }).catch(function (err) {
        /* 系统已经能判断「这个用户名没有账号」：直接切到注册页签，
           并保留刚输入的用户名/密码，省得用户重新敲一遍 */
        if (mode === 'login' && err && err.code === 'USER_NOT_FOUND') {
          mode = 'register';
          backdrop.querySelectorAll('.hw-auth-tabs button').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === 'register');
          });
          document.getElementById('hw-auth-title').textContent = '注 册';
          submitBtn.textContent = '注 册';
          setRegisterOnly(true);
          errEl.textContent = '该用户名还没有账号，已为你切到注册';
        } else {
          errEl.textContent = err.message || '操作失败，请重试';
        }
        submitBtn.disabled = false;
        if (mode === 'login') submitBtn.textContent = '登 录';
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
    resetPassword: resetPassword,
    openModal: openModal,
    requireLogin: requireLogin,
    on: on,
    accountTable: accountTable,
    detectAccountSource: detectAccountSource,
    getClient: getClient,
    sessionExpired: wasSessionExpired,
    verifyOwnPassword: verifyOwnPassword,
    ownCredentialHash: ownCredentialHash,
    isMissingTable: isMissingTable,
    isLockedRow: isLockedRow,
    LOCKED_SENTINEL: LOCKED_SENTINEL
  };
})();
