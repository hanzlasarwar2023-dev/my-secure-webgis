/* PU WebGIS - map application (index.html) */
(function () {
  'use strict';
  if (!window.PU) return;

  var map, pointsGroup, linesGroup, polygonsGroup, drawControl;
  var store = {};
  var drawing = false;
  var watchId = null, lastState = null, meMarker = null;
  var onSaveCallback = null, lastFocused = null;

  function qs(id) { return PU.qs(id); }
  function esc(t) { return PU.esc(t); }
  function toast(m, k) { PU.toast(m, k); }

  // ---------- Map aur basemaps ----------
  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([31.5000, 74.3000], 15);

    var normal = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    });
    var satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
    );
    satellite.addTo(map);

    pointsGroup   = L.layerGroup().addTo(map);
    linesGroup    = L.layerGroup().addTo(map);
    polygonsGroup = L.layerGroup().addTo(map);

    L.control.layers(
      { 'Satellite': satellite, 'Normal Map': normal },
      { 'Points': pointsGroup, 'Lines': linesGroup, 'Polygons': polygonsGroup }
    ).addTo(map);
  }

  // ---------- Har feature ki details (Edit/Delete ke liye) ----------
  function popupHtml(layerName, p) {
    var date = p.created_at ? new Date(p.created_at).toLocaleString() : '';
    return '<b>' + esc(p.name) + '</b><br>' +
      'Category: ' + esc(p.category) + '<br>' +
      (p.description ? esc(p.description) + '<br>' : '') +
      (date ? '<small>Saved: ' + esc(date) + '</small><br>' : '') +
      '<button type="button" class="btn btn-edit" data-action="edit" ' +
        'data-layer="' + esc(layerName) + '" data-id="' + esc(p.id) + '">Edit</button> ' +
      '<button type="button" class="btn btn-del" data-action="delete" ' +
        'data-layer="' + esc(layerName) + '" data-id="' + esc(p.id) + '">Delete</button>';
  }

  // ---------- PostGIS se layers load karna ----------
  function loadLayer(layerName, group, style) {
    group.clearLayers();
    return PU.apiFetch('/api/features/' + layerName)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        L.geoJSON(data, {
          style: style,
          onEachFeature: function (f, layer) {
            store[layerName + ':' + f.properties.id] = f.properties;
            layer.bindTooltip(f.properties.name, { sticky: true });
            layer.bindPopup(popupHtml(layerName, f.properties));
          }
        }).eachLayer(function (l) { group.addLayer(l); });
      })
      .catch(function () { toast('Layer load nahi hua: ' + layerName, 'error'); });
  }

  function loadAll() {
    loadLayer('places', pointsGroup);
    loadLayer('lines', linesGroup, { color: '#d4a017', weight: 4 });
    loadLayer('polygons', polygonsGroup, { color: '#c05621', weight: 3, fillOpacity: 0.25 });
  }

  // ---------- Form kholna (focus trap ke sath) ----------
  function openForm(title, values, onSave) {
    lastFocused = document.activeElement;
    qs('formTitle').textContent = title;
    qs('fName').value = values.name || '';
    qs('fDesc').value = values.description || '';
    var sel = qs('fCategory');
    var cat = values.category || 'Department';
    // Agar purani category list mein nahi to add kar do
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === cat; })) {
      var o = document.createElement('option');
      o.text = cat;
      sel.appendChild(o);
    }
    sel.value = cat;
    onSaveCallback = onSave;
    qs('overlay').style.display = 'flex';
    qs('fName').focus();
  }

  function closeForm() {
    qs('overlay').style.display = 'none';
    onSaveCallback = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  // Modal ke andar Tab trap (keyboard users ke liye)
  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    var f = qs('form');
    var items = f.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function bindForm() {
    qs('fCancel').onclick = closeForm;
    qs('fSave').onclick = function () {
      var name = qs('fName').value.trim();
      if (!name) { toast('Naam likhna zaroori hai', 'error'); qs('fName').focus(); return; }
      if (onSaveCallback) {
        onSaveCallback({
          name: name,
          category: qs('fCategory').value,
          description: qs('fDesc').value.trim()
        });
      }
    };
    document.addEventListener('keydown', function (e) {
      if (qs('overlay').style.display === 'flex') {
        if (e.key === 'Escape') { closeForm(); return; }
        trapFocus(e);
      }
    });
    // Modal ke bahar click par band
    qs('overlay').addEventListener('mousedown', function (e) {
      if (e.target === qs('overlay')) closeForm();
    });
  }

  // ---------- Edit (database mein update) ----------
  function editFeature(layerName, id) {
    var p = store[layerName + ':' + id];
    if (!p) return;
    map.closePopup();
    openForm('Details badlein', p, function (vals) {
      PU.apiFetch('/api/features/' + layerName + '/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vals)
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { toast('Update nahi hua: ' + d.error, 'error'); return; }
        closeForm();
        loadAll();
        toast('Database mein update ho gaya');
      }).catch(function () { toast('Update nahi hua. Server tak nahi pahunch sake.', 'error'); });
    });
  }

  // ---------- Delete ----------
  function delFeature(layerName, id) {
    if (!confirm('Is feature ko database se delete karein?')) return;
    PU.apiFetch('/api/features/' + layerName + '/' + id, { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { toast('Delete nahi hua: ' + d.error, 'error'); return; }
        map.closePopup();
        loadAll();
        toast('Database se delete ho gaya', 'error');
      })
      .catch(function () { toast('Delete nahi hua. Server tak nahi pahunch sake.', 'error'); });
  }

  // ---------- Drawing tools ----------
  function initDraw() {
    drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        marker: true,
        polyline: { shapeOptions: { color: '#d4a017' } },
        polygon: { allowIntersection: false, shapeOptions: { color: '#c05621' } },
        rectangle: { shapeOptions: { color: '#c05621' } },
        circle: false,
        circlemarker: false
      },
      edit: false
    });
    map.addControl(drawControl);

    map.on('draw:drawstart', function () { drawing = true; });
    map.on('draw:drawstop', function () { setTimeout(function () { drawing = false; }, 300); });

    // Shape banne par form khulta hai, Save par database mein jata hai
    map.on('draw:created', function (e) {
      var geometry = e.layer.toGeoJSON().geometry;
      var layerName = 'polygons';
      if (e.layerType === 'marker') layerName = 'places';
      if (e.layerType === 'polyline') layerName = 'lines';

      openForm('Naya feature save karein', {}, function (vals) {
        vals.geometry = geometry;
        PU.apiFetch('/api/features/' + layerName, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vals)
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.error) { toast('Save nahi hua: ' + d.error, 'error'); return; }
          closeForm();
          loadAll();
          toast('Database mein save ho gaya (id: ' + d.id + ')');
        }).catch(function () { toast('Save nahi hua. Server tak nahi pahunch sake.', 'error'); });
      });
    });
  }

  // ---------- Popup ke Edit/Delete buttons (inline handler nahi, CSP safe) ----------
  function bindPopupActions() {
    map.on('popupopen', function (e) {
      var el = e.popup.getElement();
      if (!el) return;
      el.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null;
        if (!btn) return;
        var layerName = btn.getAttribute('data-layer');
        var id = btn.getAttribute('data-id');
        if (btn.getAttribute('data-action') === 'edit') editFeature(layerName, id);
        else delFeature(layerName, id);
      });
    });
  }

  // ---------- Geofence ----------
  function loadBoundary() {
    return PU.apiFetch('/api/boundary')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        L.geoJSON(data, {
          style: {
            color: '#ffffff', weight: 3, dashArray: '8 6',
            fillColor: '#ffffff', fillOpacity: 0.08
          },
          interactive: false
        }).addTo(map);
      })
      .catch(function () { /* boundary na ho to bhi app chalta hai */ });
  }

  function isInside(lon, lat) {
    return PU.apiFetch(
      '/api/check?lon=' + encodeURIComponent(lon) + '&lat=' + encodeURIComponent(lat)
    ).then(function (r) { return r.json(); })
      .then(function (d) { return d.inside === true; })
      .catch(function () { return false; });
  }

  function showStatus(inside) {
    var el = qs('status');
    if (!el) return;
    el.innerHTML = inside
      ? '<span class="in">Aap campus ke ANDAR hain</span>'
      : '<span class="out">Aap campus se BAHAR hain</span>';
  }

  function bindMapClick() {
    map.on('click', function (e) {
      if (drawing) return;
      var lon = e.latlng.lng, lat = e.latlng.lat;
      isInside(lon, lat).then(function (inside) {
        L.popup().setLatLng(e.latlng).setContent(
          '<b>Longitude:</b> ' + lon.toFixed(6) +
          '<br><b>Latitude:</b> ' + lat.toFixed(6) +
          '<br>' + (inside ? '<span class="in">Campus ke ANDAR</span>'
                           : '<span class="out">Campus se BAHAR</span>')
        ).openOn(map);
        showStatus(inside);
      });
    });
  }

  // ---------- Location tracking (HTTPS zaroori hai) ----------
  function bindTracking() {
    var btn = qs('trackBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!navigator.geolocation) {
        toast('Is browser mein location nahi hai.', 'error');
        return;
      }
      if (watchId !== null) return;

      var status = qs('status');
      if (status) status.textContent = 'Location dhoondh rahe hain...';

      watchId = navigator.geolocation.watchPosition(function (pos) {
        var lon = pos.coords.longitude, lat = pos.coords.latitude;
        if (meMarker) map.removeLayer(meMarker);
        meMarker = L.circleMarker([lat, lon], { radius: 8, color: '#0a58ca', fillOpacity: 0.9 })
          .bindTooltip('Main yahan hun').addTo(map);
        isInside(lon, lat).then(function (inside) {
          if (lastState !== null && lastState !== inside) {
            toast(inside ? 'Aap campus mein DAAKHIL hue' : 'Aap campus se BAHAR nikle', 'info');
          }
          lastState = inside;
          showStatus(inside);
        });
      }, function (err) {
        toast('Location nahi mili: ' + err.message, 'error');
        watchId = null;
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    });
  }

  // ---------- HTTPS check (geolocation ke liye zaroori) ----------
  function checkSecureContext() {
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname);
    if (location.protocol !== 'https:' && !isLocal) {
      var b = qs('httpsWarn');
      if (b) b.hidden = false;
    }
  }

  // ---------- Install button ----------
  function initInstall() {
    var btn = qs('installBtn');
    if (!btn) return;
    btn.hidden = true;
    document.addEventListener('pu:installable', function () { btn.hidden = false; });
    btn.addEventListener('click', function () {
      PU.install().then(function (ok) { if (ok) btn.hidden = true; });
    });
  }

  // ---------- Boot ----------
  function boot() {
    initMap();
    initDraw();
    bindPopupActions();
    bindForm();
    bindMapClick();
    bindTracking();
    initInstall();
    checkSecureContext();
    loadBoundary();
    loadAll();
  }

  PU.whenReady(function () {
    if (!PU.session) { boot(); return; }
    PU.session.then(function (user) { if (user) boot(); });
  });
})(window);

