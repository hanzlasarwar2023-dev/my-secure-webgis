/* PU WebGIS - session guard + user bar
 * Token ab httpOnly cookie mein hota hai, JS usko dekh nahi sakta.
 */
(function () {
  'use strict';
  if (!window.PU) return;

  function goLogin() {
    window.location.href = '/login.html';
  }

  function buildUserBar(user) {
    var bar = document.createElement('div');
    bar.className = 'userbar';

    var name = document.createElement('span');
    name.className = 'userbar-name';
    name.textContent = user.username + ' (' + user.role + ')';

    var logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'btn btn-ghost btn-sm';
    logout.textContent = 'Logout';
    logout.addEventListener('click', function () {
      logout.disabled = true;
      PU.apiFetch('/api/logout', { method: 'POST' })
        .catch(function () { /* logout chahe fail ho jaye, wapas login par jao */ })
        .then(function () { goLogin(); });
    });

    bar.appendChild(name);
    bar.appendChild(logout);
    document.body.appendChild(bar);
  }

  /* 401 aaye to seedha login page par */
  PU.onUnauthorized = goLogin;

  /* App ko session batate hain - index.html is promise ka wait karta hai */
  PU.session = PU.apiFetch('/api/me')
    .then(function (r) {
      if (!r.ok) { goLogin(); return null; }
      return r.json();
    })
    .then(function (user) {
      if (user) PU.whenReady(function () { buildUserBar(user); });
      return user;
    })
    .catch(function () { goLogin(); return null; });
})();
