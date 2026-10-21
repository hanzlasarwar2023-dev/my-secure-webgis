/* PU WebGIS - login / register page */
(function () {
  'use strict';
  if (!window.PU) return;

  var mode = 'login';

  function qs(id) { return PU.qs(id); }

  function setMode(m) {
    mode = m;
    var isLogin = m === 'login';
    qs('tLogin').className = isLogin ? 'on' : '';
    qs('tLogin').setAttribute('aria-pressed', isLogin ? 'true' : 'false');
    qs('tReg').className = isLogin ? '' : 'on';
    qs('tReg').setAttribute('aria-pressed', isLogin ? 'false' : 'true');
    qs('joinRow').hidden = isLogin;
    qs('go').textContent = isLogin ? 'Login' : 'Account banao';
    qs('msg').textContent = '';
    qs('msg').className = '';
  }

  function submit() {
    var btn = qs('go');
    var msg = qs('msg');
    btn.disabled = true;
    msg.textContent = 'Intezar karein...';
    msg.className = '';

    PU.apiFetch('/api/' + mode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: qs('u').value.trim(),
        password: qs('p').value,
        joinCode: qs('j').value.trim()
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) {
        msg.textContent = res.data.error || 'Kuch masla hua';
        msg.className = '';
        btn.disabled = false;
        qs('p').focus();
        return;
      }
      msg.textContent = 'Ho gaya, andar aa rahe hain...';
      msg.className = 'ok';
      PU.refreshCsrf();                       // naya CSRF token le lo
      setTimeout(function () { location.href = '/index.html'; }, 400);
    }).catch(function () {
      msg.textContent = 'Server tak nahi pahunch sake';
      msg.className = '';
      btn.disabled = false;
    });
  }

  function init() {
    qs('tLogin').addEventListener('click', function () { setMode('login'); });
    qs('tReg').addEventListener('click', function () { setMode('register'); });
    qs('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
    setMode('login');
  }

  PU.whenReady(function () {
    init();
    // Pehle se login hai? Seedha map par bhejo
    PU.apiFetch('/api/me').then(function (r) {
      if (r.ok) location.href = '/index.html';
    }).catch(function () { /* login hi rahe */ });
  });
})(window);
