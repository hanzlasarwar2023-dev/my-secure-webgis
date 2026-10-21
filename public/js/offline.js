/* PU WebGIS - offline fallback page */
(function () {
  'use strict';
  var btn = document.getElementById('retryBtn');
  if (btn) {
    btn.addEventListener('click', function () { location.reload(); });
  }
  window.addEventListener('online', function () { location.reload(); });
})();
