/* PU WebGIS - campus boundary drawing tool */
(function () {
  'use strict';
  if (!window.PU) return;

  var map, poly, dots, pts = [];

  function redraw() {
    poly.setLatLngs(pts.map(function (p) { return [p[1], p[0]]; }));
    dots.clearLayers();
    pts.forEach(function (p, i) {
      L.circleMarker([p[1], p[0]], { radius: 5, color: '#d4a017' })
        .bindTooltip(String(i + 1), { permanent: true, direction: 'top' })
        .addTo(dots);
    });
    PU.qs('count').textContent = 'Points: ' + pts.length;
    makeSql();
  }

  function makeSql() {
    var box = PU.qs('sql');
    if (pts.length < 3) {
      box.value = 'Kam az kam 3 points chahiye.';
      return;
    }
    var ring = pts.concat([pts[0]]);        // polygon band karne ke liye pehla point dobara
    var coords = ring.map(function (p) {
      return p[0].toFixed(6) + ' ' + p[1].toFixed(6);
    }).join(', ');
    box.value =
      'DELETE FROM public.campus_boundary;\n\n' +
      'INSERT INTO public.campus_boundary (name, geom) VALUES\n' +
      '(\'Punjab University New Campus\',\n' +
      ' ST_GeomFromText(\'POLYGON((' + coords + '))\', 4326));';
  }

  function copySql() {
    var box = PU.qs('sql');
    box.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value)
        .then(function () { PU.toast('SQL copy ho gayi. Ab pgAdmin mein paste karein.'); })
        .catch(function () { legacyCopy(box); });
    } else {
      legacyCopy(box);
    }
  }

  function legacyCopy(box) {
    try {
      document.execCommand('copy');
      PU.toast('SQL copy ho gayi. Ab pgAdmin mein paste karein.');
    } catch (e) {
      PU.toast('Copy nahi hua. Text ko manually select kar lein.', 'error');
    }
  }

  function init() {
    map = L.map('map').setView([31.5000, 74.3000], 15);
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
    ).addTo(map);

    poly = L.polygon([], { color: '#b02a37', weight: 2 }).addTo(map);
    dots = L.layerGroup().addTo(map);

    // Departments ke points (sirf nishani ke liye, click nahi rokte)
    PU.apiFetch('/api/places')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        L.geoJSON(data, {
          pointToLayer: function (f, ll) {
            return L.circleMarker(ll, { radius: 4, color: '#0891b2', interactive: false });
          }
        }).addTo(map);
      })
      .catch(function () { /* places na mile to koi baat nahi */ });

    map.on('click', function (e) {
      pts.push([e.latlng.lng, e.latlng.lat]);
      redraw();
    });

    PU.qs('undoBtn').addEventListener('click', function () { pts.pop(); redraw(); });
    PU.qs('clearBtn').addEventListener('click', function () { pts = []; redraw(); });
    PU.qs('copyBtn').addEventListener('click', copySql);

    redraw();
  }

  PU.whenReady(function () {
    if (!PU.session) { init(); return; }
    PU.session.then(function (user) { if (user) init(); });
  });
})(window);
