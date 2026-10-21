/* PU WebGIS - shared helpers (CSP-safe: koi inline script nahi) */
(function (global) {
  'use strict';

  var CSRF_COOKIE = 'pu_csrf';
  var csrfToken = null;

  function getCookie(name) {
    if (!document.cookie) return null;
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].trim();
      if (c.indexOf(name + '=') === 0) {
        return decodeURIComponent(c.substring(name.length + 1));
      }
    }
    return null;
  }

  /* Server se naya CSRF token maangta hai */
  function refreshCsrf() {
    return fetch('/api/csrf', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.csrfToken) csrfToken = d.csrfToken;
        return csrfToken;
      })
      .catch(function () { return csrfToken; });
  }

  /* Cookie hamesha fresh hoti hai - token rotate hone par bhi sahi chalta hai */
  function ensureCsrf(force) {
    var fromCookie = getCookie(CSRF_COOKIE);
    if (fromCookie) {
      csrfToken = fromCookie;
      return Promise.resolve(csrfToken);
    }
    if (force) return refreshCsrf();
    return refreshCsrf();
  }

  /* Har API call: session cookie jaati hai + CSRF header lagta hai */
  function apiFetch(url, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var isApi = typeof url === 'string' && url.indexOf('/api/') === 0;
    var ready;
    if (isApi && method !== 'GET' && method !== 'HEAD') {
      ready = ensureCsrf().then(function (token) {
        if (!token) return null;
        opts.headers = Object.assign({}, opts.headers, { 'X-CSRF-Token': token });
        return token;
      });
    } else {
      ready = Promise.resolve(null);
    }
    return ready.then(function () {
      opts.credentials = 'same-origin';
      return fetch(url, opts);
    }).then(function (res) {
      if (isApi && res.status === 401 && global.PU && global.PU.onUnauthorized) {
        global.PU.onUnauthorized();
      }
      return res;
    });
  }

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function qs(id) { return document.getElementById(id); }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* Toast - screen readers ko bhi bata deta hai (aria-live) */
  function toast(msg, kind) {
    var t = qs('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.display = 'none'; }, 3200);
  }

  global.PU = {
    getCookie: getCookie,
    refreshCsrf: refreshCsrf,
    ensureCsrf: ensureCsrf,
    apiFetch: apiFetch,
    esc: esc,
    qs: qs,
    whenReady: whenReady,
    toast: toast,
    session: null,          // auth.js isay Promise se bharta hai
    onUnauthorized: null
  };

  /* Page load hote hi CSRF cookie le lo (login form ke liye zaroori) */
  ensureCsrf();

  /* ---- Service worker: PWA ke liye ---- */
  if ('serviceWorker' in navigator) {
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) {
        console.warn('[pwa] service worker register nahi hua:', e);
      });
    });
  }

  /* ---- Install prompt (Android / Chrome) ---- */
  var deferredPrompt = null;
  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    document.dispatchEvent(new CustomEvent('pu:installable'));
  });
  global.PU.isInstallable = function () { return !!deferredPrompt; };
  global.PU.install = function () {
    if (!deferredPrompt) return Promise.resolve(false);
    deferredPrompt.prompt();
    var choice = deferredPrompt.userChoice;
    deferredPrompt = null;
    return choice.then(function (c) { return !!(c && c.outcome === 'accepted'); });
  };
})(window);
