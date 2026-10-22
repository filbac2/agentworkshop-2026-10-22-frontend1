(function () {
  'use strict';

  var ENGINE_URL = '/t/mareri/isochrone';          // street-based walking
  var FALLBACK_ENGINE_URL = '/t/marlin/isochrone'; // straight-line walking
  var WALK_ENGINE_URL = '/t/filbac/api/isochrone'; // walking-only areas (no transport types)
  var TIMEOUT_MS = 20000;
  var MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
  var STOCKHOLM = [59.3293, 18.0686];
  var params = new URLSearchParams(location.search);

  var lang = localStorage.getItem('lang') ||
    ((navigator.language || '').toLowerCase().indexOf('sv') === 0 ? 'sv' : 'en');

  function t(key, vars) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }

  var $ = function (id) { return document.getElementById(id); };

  // ---- Map ----
  var map = L.map('map', { zoomControl: false }).setView(STOCKHOLM, 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var PIN_SVG = '<span class="pin-ring"></span>' +
    '<svg viewBox="0 0 36 44" aria-hidden="true"><path d="M18 1C9 1 2 8 2 17c0 12 16 26 16 26s16-14 16-26C34 8 27 1 18 1z" fill="#2563eb" stroke="#fff" stroke-width="2.5"/>' +
    '<circle cx="18" cy="17" r="6" fill="#fff"/></svg>';
  var pin = L.marker(STOCKHOLM, {
    draggable: true,
    autoPan: true,
    icon: L.divIcon({ className: 'pin', html: PIN_SVG, iconSize: [36, 44], iconAnchor: [18, 43] })
  }).addTo(map);
  pin.on('dragstart', function () { pin.getElement().classList.add('lifted'); });
  pin.on('dragend', function () { pin.getElement().classList.remove('lifted'); });

  // Solid-filled cumulative bands are made translucent as one layer, so they don't blend with each other.
  var isoPane = map.createPane('iso');
  isoPane.style.opacity = '0';
  var isoRenderer = L.canvas({ pane: 'iso' });
  var ISO_OPACITY = '0.6';
  var overlay = null;

  // Real street-network walking area from the pin, drawn above the bands.
  var walkPane = map.createPane('walk');
  walkPane.style.zIndex = 450;
  walkPane.style.pointerEvents = 'none';
  var walkLayer = null;
  var walkMinutes = null;
  var streetWalk = false;
  var walkToken = 0;

  function clearWalk() {
    walkToken++;
    if (walkLayer) { map.removeLayer(walkLayer); walkLayer = null; }
    walkMinutes = null;
    streetWalk = false;
    $('walk-note').hidden = true;
  }

  function showWalkNote() {
    var note = $('walk-note');
    if (streetWalk) {
      $('walk-text').textContent = t('walkStreet');
      note.classList.add('street');
      note.hidden = false;
      return;
    }
    note.classList.remove('street');
    if (walkMinutes === null) { note.hidden = true; return; }
    $('walk-text').textContent = t('walkReal', { n: walkMinutes });
    note.hidden = false;
  }

  function markStreetWalk() {
    clearWalk();
    streetWalk = true;
    showWalkNote();
  }

  async function loadWalkArea(p, minutes) {
    clearWalk();
    if (params.get('stub') === '1' || !(minutes >= 1)) return;
    var token = walkToken;
    try {
      var res = await fetch('/t/mareri/walk?lat=' + p.lat + '&lon=' + p.lng + '&minutes=' + minutes);
      if (!res.ok) return;
      var feature = await res.json();
      if (token !== walkToken) return;
      walkLayer = L.geoJSON(feature, {
        pane: 'walk',
        interactive: false,
        style: { color: '#0f172a', weight: 2.5, dashArray: '6 5', fillColor: '#ffffff', fillOpacity: 0.12 }
      }).addTo(map);
      walkMinutes = minutes;
      showWalkNote();
    } catch (e) { /* optional layer: the isochrone stays valid without it */ }
  }

  function showOrigin() {
    var p = pin.getLatLng();
    $('origin-out').textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
  }
  pin.on('drag', showOrigin);
  var suppressClickUntil = 0;
  map.on('click', function (e) {
    if (Date.now() < suppressClickUntil) return;
    pin.setLatLng(e.latlng);
    showOrigin();
    setJourneyBody(null);
  });
  showOrigin();

  // ---- Form setup ----
  var maxTravel = $('max-travel');
  function syncTravel() {
    var v = parseInt(maxTravel.value, 10);
    var pct = ((v - 5) / (120 - 5)) * 100;
    maxTravel.style.setProperty('--pct', pct + '%');
    $('travel-out').textContent = t('minutes', { n: v });
    maxTravel.setAttribute('aria-valuetext', t('minutes', { n: v }));
  }
  maxTravel.addEventListener('input', syncTravel);

  var MODE_ICONS = { bus: '\uD83D\uDE8C', metro: '\uD83D\uDE87', tram: '\uD83D\uDE8A', train: '\uD83D\uDE86', commuter_rail: '\uD83D\uDE89', boat: '\u26F4\uFE0F' };
  var modesBox = $('modes');
  MODES.forEach(function (mode) {
    var label = document.createElement('label');
    label.className = 'chip';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = mode;
    cb.checked = true;
    var face = document.createElement('span');
    face.className = 'face';
    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = MODE_ICONS[mode];
    var text = document.createElement('span');
    text.setAttribute('data-i18n', 'mode.' + mode);
    face.appendChild(ico);
    face.appendChild(text);
    label.appendChild(cb);
    label.appendChild(face);
    modesBox.appendChild(label);
  });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowLocalValue() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  $('start-time').value = nowLocalValue();

  // ---- i18n ----
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    if (typeof checkFeed === 'function') checkFeed();
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
    });
    if (lastBands) renderLegend(lastBands);
    showWalkNote();
    syncTravel();
    if (journeyBody) $('journey-hint').textContent = t(canHover ? 'jHint' : 'jHintTouch');
    rerenderJourney();
  }
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      localStorage.setItem('lang', lang);
      applyLang();
    });
  });

  // ---- Mobile sheet ----
  var panel = $('panel');
  var toggle = $('sheet-toggle');
  toggle.addEventListener('click', function () {
    var collapsed = panel.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  // Keep the OSM attribution visible above the bottom sheet on small screens.
  function syncSheetHeight() {
    var small = window.matchMedia('(max-width: 700px)').matches;
    document.documentElement.style.setProperty('--sheet-h', small ? panel.offsetHeight + 'px' : '0px');
  }
  if (window.ResizeObserver) new ResizeObserver(syncSheetHeight).observe(panel);
  window.addEventListener('resize', syncSheetHeight);
  syncSheetHeight();

  // ---- Status ----
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = isError ? 'error' : '';
  }

  // ---- Overlay rendering ----
  var lastBands = null;

  // Teal (near) -> lime -> yellow -> orange -> red -> magenta -> purple (far)
  var STOPS = [[25, 211, 162], [125, 220, 59], [242, 209, 43], [255, 154, 31], [255, 90, 77], [224, 53, 155], [122, 44, 191]];
  function bandColor(i, n) {
    var f = n <= 1 ? 0 : i / (n - 1);
    var pos = f * (STOPS.length - 1);
    var lo = Math.min(Math.floor(pos), STOPS.length - 2);
    var k = pos - lo;
    var a = STOPS[lo], b = STOPS[lo + 1];
    return 'rgb(' + [0, 1, 2].map(function (c) { return Math.round(a[c] + (b[c] - a[c]) * k); }).join(',') + ')';
  }

  function renderLegend(bands) {
    var box = $('legend');
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = t('legend');
    var bar = document.createElement('div');
    bar.className = 'legend-bar';
    bands.forEach(function (b, i) {
      var seg = document.createElement('span');
      seg.style.background = bandColor(i, bands.length);
      seg.title = b.from + '–' + b.to + ' min';
      bar.appendChild(seg);
    });
    var last = bands[bands.length - 1].to;
    var scale = document.createElement('div');
    scale.className = 'legend-scale';
    [0, Math.round(last / 2), last].forEach(function (v) {
      var s = document.createElement('span');
      s.textContent = v;
      scale.appendChild(s);
    });
    box.appendChild(title);
    box.appendChild(bar);
    box.appendChild(scale);
    box.hidden = false;
  }

  function hasArea(g) {
    return !!(g && g.coordinates && g.coordinates.length);
  }

  function renderIsochrones(fc) {
    var feats = (fc && fc.features) || [];
    var bands = feats.map(function (f) {
      var p = f.properties || {};
      return { from: p.fromMinutes, to: p.toMinutes, feature: f };
    }).filter(function (b) {
      return typeof b.from === 'number' && typeof b.to === 'number';
    }).sort(function (a, b) { return a.from - b.from; });

    if (overlay) { map.removeLayer(overlay); overlay = null; }
    var drawn = bands.filter(function (b) { return hasArea(b.feature.geometry); });
    if (!drawn.length) { lastBands = null; $('legend').hidden = true; clearWalk(); return false; }

    var group = L.featureGroup();
    // Bands are cumulative: paint the outermost first so nearer bands cover it.
    bands.slice().reverse().forEach(function (b) {
      if (!hasArea(b.feature.geometry)) return;
      L.geoJSON(b.feature, {
        pane: 'iso',
        renderer: isoRenderer,
        interactive: false,
        style: {
          stroke: true,
          color: '#ffffff',
          weight: 0.8,
          opacity: 0.75,
          fillColor: bandColor(bands.indexOf(b), bands.length),
          fillOpacity: 1
        }
      }).addTo(group);
    });
    overlay = group.addTo(map);
    lastBands = bands;
    renderLegend(bands);

    var small = window.matchMedia('(max-width: 700px)').matches;
    var bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, small
        ? { paddingTopLeft: [24, 24], paddingBottomRight: [24, Math.min(panel.offsetHeight, window.innerHeight * 0.4) + 24], maxZoom: 14 }
        : { paddingTopLeft: [panel.offsetWidth + 36, 36], paddingBottomRight: [60, 36], maxZoom: 14 });
    }
    isoPane.style.opacity = '0';
    requestAnimationFrame(function () { requestAnimationFrame(function () { isoPane.style.opacity = ISO_OPACITY; }); });
    return true;
  }

  // ---- Request ----
  function intVal(id) { return parseInt($(id).value, 10); }

  function readSettings() {
    var modes = Array.prototype.slice.call(modesBox.querySelectorAll('input:checked'))
      .map(function (cb) { return cb.value; });
    var start = new Date($('start-time').value);
    if (isNaN(start.getTime())) throw new Error(t('err.badTime'));

    var checks = [
      ['max-wait', 0, 60, t('maxWait')],
      ['max-transfers', 0, 8, t('maxTransfers')],
      ['walk-dest', 0, 30, t('walkDest')],
      ['walk-transfer', 0, 30, t('walkTransfer')]
    ];
    checks.forEach(function (c) {
      var v = intVal(c[0]);
      if (isNaN(v) || v < c[1] || v > c[2]) throw new Error(t('err.badNumber', { field: c[3] }));
    });

    var p = pin.getLatLng();
    return {
      origin: { lat: p.lat, lon: p.lng },
      startTime: start.toISOString(),
      maxTravelMinutes: intVal('max-travel'),
      maxWaitMinutes: intVal('max-wait'),
      maxTransfers: intVal('max-transfers'),
      modes: modes,
      walking: {
        accessMinutes: intVal('walk-dest'),
        egressMinutes: intVal('walk-dest'),
        transferMinutes: intVal('walk-transfer')
      },
      bandMinutes: 5
    };
  }

  function errorMessage(err) {
    if (err.name === 'AbortError') return t('err.timeout');
    if (err.engineMessage) return lang === 'sv' && err.engineMessageSv ? err.engineMessageSv : err.engineMessage;
    if (err.status === 404 || err.status === 502 || err.status === 503) return t('err.unavailable');
    if (err.isNetwork) return t('err.network');
    return t('err.unknown', { detail: err.message || err.status || '?' });
  }

  var inflight = null;

  // Posts to one engine. Returns {data} or throws an Error with .status / .isNetwork.
  async function postEngine(url, body, ctrl) {
    var res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      if (e.name !== 'AbortError') e.isNetwork = true;
      throw e;
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      var err = new Error((data && data.message) || ('HTTP ' + res.status));
      err.status = res.status;
      if (data && data.message) {
        err.engineMessage = data.message;
        err.engineMessageSv = data.message_sv;
      }
      throw err;
    }
    return data;
  }

  // The street-based engine is preferred; marlin's straight-line engine answers when it is missing or broken.
  function streetEngineDown(e) {
    return e.isNetwork || e.status === 404 || e.status === 405 || e.status >= 500;
  }

  async function callEngine(body) {
    if (params.get('stub') === '1' && window.StubEngine) return window.StubEngine(body);
    if (inflight) inflight.abort();
    var ctrl = new AbortController();
    inflight = ctrl;
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    try {
      try {
        if (!body.modes.length) return await postEngine(WALK_ENGINE_URL, body, ctrl);
        return await postEngine(ENGINE_URL, body, ctrl);
      } catch (e) {
        if (e.name === 'AbortError' || !streetEngineDown(e)) throw e;
        return await postEngine(FALLBACK_ENGINE_URL, body, ctrl);
      }
    } finally {
      clearTimeout(timer);
      if (inflight === ctrl) inflight = null;
    }
  }

  // ---- Journey: hover (or long-press) a point to see how you get there ----
  var JOURNEY_URL = '/t/mareri/journey';
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var journeyPane = map.createPane('journey');
  journeyPane.style.zIndex = 470;
  journeyPane.style.pointerEvents = 'none';
  var journeyLayer = L.layerGroup().addTo(map);
  var journeyBody = null;      // request behind the bands that are on screen
  var journeyShown = null;     // {data, latlng}
  var journeyTimer = null;
  var journeyCtrl = null;
  var journeyToken = 0;
  var journeyCache = {};
  var journeyCacheKeys = [];
  var mapBusy = false;
  var METRO_COLORS = { 10: '#1b6fd1', 11: '#1b6fd1', 13: '#d9261c', 14: '#d9261c', 17: '#1f9d55', 18: '#1f9d55', 19: '#1f9d55' };
  var MODE_COLORS = { bus: '#1d4ed8', metro: '#d9261c', tram: '#7c3aed', train: '#d97706', commuter_rail: '#db2777', boat: '#0891b2' };

  function legColor(leg) {
    if (leg.mode === 'metro' && METRO_COLORS[leg.line]) return METRO_COLORS[leg.line];
    return MODE_COLORS[leg.mode] || '#334155';
  }

  function hideJourney() {
    journeyToken++;
    clearTimeout(journeyTimer);
    if (journeyCtrl) { journeyCtrl.abort(); journeyCtrl = null; }
    journeyLayer.clearLayers();
    journeyShown = null;
  }

  function journeyEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function journeyContent(d) {
    var box = journeyEl('div', 'j-card');
    var head = journeyEl('div', 'j-head');
    head.appendChild(journeyEl('strong', 'j-total', t('minutes', { n: d.totalMinutes })));
    var changes = d.transfers === 0 ? t('jDirect') : d.transfers === 1 ? t('jChange1') : t('jChanges', { n: d.transfers });
    head.appendChild(journeyEl('span', 'j-sub', t('jArrive', { t: d.arriveTime }) + ' · ' + changes));
    box.appendChild(head);
    d.legs.forEach(function (leg, i) {
      var row = journeyEl('div', 'j-row ' + leg.type);
      if (leg.type === 'walk') {
        row.appendChild(journeyEl('span', 'j-ico', '\uD83D\uDEB6'));
        var txt = journeyEl('div', 'j-txt');
        var last = i === d.legs.length - 1;
        txt.appendChild(journeyEl('div', 'j-main', last || !leg.to.name
          ? t('jWalkHere', { n: leg.minutes })
          : t('jWalkTo', { n: leg.minutes, name: leg.to.name })));
        txt.appendChild(journeyEl('div', 'j-meta', leg.meters + ' m' + (leg.street ? '' : ' · ' + t('jEstimatedWalk'))));
        row.appendChild(txt);
      } else {
        var badge = journeyEl('span', 'j-badge', (MODE_ICONS[leg.mode] || '') + (leg.line ? ' ' + leg.line : ''));
        badge.style.background = legColor(leg);
        row.appendChild(badge);
        var rt = journeyEl('div', 'j-txt');
        rt.appendChild(journeyEl('div', 'j-main', leg.from.name + ' \u2192 ' + leg.to.name));
        var meta = leg.depart + '\u2013' + leg.arrive + ' \u00B7 ' + t(leg.stops === 1 ? 'jStop1' : 'jStops', { n: leg.stops });
        if (leg.waitMinutes > 0) meta += ' \u00B7 ' + t('jWait', { n: leg.waitMinutes });
        rt.appendChild(journeyEl('div', 'j-meta', meta));
        row.appendChild(rt);
      }
      box.appendChild(row);
    });
    if (d.legs.some(function (leg) { return leg.type === 'ride' && !leg.shapePath; })) {
      box.appendChild(journeyEl('div', 'j-meta', t('jSchematic')));
    }
    return box;
  }

  function journeyTooltip(content, latlng) {
    var at = map.latLngToContainerPoint(latlng);
    var tip = L.tooltip({
      permanent: true, direction: at.x < map.getSize().x / 2 ? 'right' : 'left',
      offset: [12, 0], opacity: 1, className: 'journey-tip', interactive: false
    }).setLatLng(latlng).setContent(content).addTo(journeyLayer);
    var rect = tip.getElement().getBoundingClientRect();
    var bounds = map.getContainer().getBoundingClientRect();
    var bottom = Math.min(bounds.bottom, window.innerHeight - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h') || 0));
    var dx = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
    var dy = Math.max(bounds.top + 8 - rect.top, Math.min(0, bottom - 8 - rect.bottom));
    tip.setLatLng(map.containerPointToLatLng([at.x + dx, at.y + dy]));
  }

  function journeyNotice(latlng, key) {
    journeyLayer.clearLayers();
    journeyShown = null;
    journeyTooltip(journeyEl('div', 'j-card', t(key)), latlng);
  }

  // Ride legs are drawn along the real line geometry (vijay-team /shape) when it can be matched to the stops.
  var shapeCache = {};
  function loadShape(mode, line) {
    var key = mode + '/' + line;
    if (!shapeCache[key]) {
      shapeCache[key] = fetch('/t/vijay-team/shape/' + encodeURIComponent(mode) + '/' + encodeURIComponent(line))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (f) { return f && f.geometry && f.geometry.coordinates; })
        .catch(function () { return null; });
    }
    return shapeCache[key];
  }
  function nearestVertex(line, p) {
    var k = Math.cos(p.lat * Math.PI / 180), best = -1, bd = Infinity;
    for (var i = 0; i < line.length; i++) {
      var dx = (line[i][0] - p.lon) * k, dy = line[i][1] - p.lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, m: Math.sqrt(bd) * 111320 };
  }
  function sliceShape(lines, a, b) {
    var best = null;
    lines.forEach(function (line) {
      var s = nearestVertex(line, a), e = nearestVertex(line, b);
      if (s.m > 250 || e.m > 250 || s.i === e.i) return;
      var cost = s.m + e.m + (s.i < e.i ? 0 : 1000);
      if (!best || cost < best.cost) best = { cost: cost, line: line, s: s.i, e: e.i };
    });
    if (!best) return null;
    var seg = best.s < best.e ? best.line.slice(best.s, best.e + 1) : best.line.slice(best.e, best.s + 1).reverse();
    var pts = seg.map(function (c) { return [c[1], c[0]]; });
    pts[0] = [a.lat, a.lon];
    pts[pts.length - 1] = [b.lat, b.lon];
    return pts;
  }
  function refineRides(d, latlng) {
    var pending = d.legs.filter(function (leg) {
      return leg.type === 'ride' && leg.line && !leg.shapePath && leg.shapeTried !== true;
    });
    if (!pending.length) return;
    Promise.all(pending.map(function (leg) {
      leg.shapeTried = true;
      return loadShape(leg.mode, leg.line).then(function (lines) {
        var pts = lines && sliceShape(lines, leg.from, leg.to);
        if (pts) leg.shapePath = pts;
      });
    })).then(function () {
      if (journeyShown && journeyShown.data === d && pending.some(function (l) { return l.shapePath; })) {
        drawJourney(d, latlng);
      }
    });
  }

  function drawJourney(d, latlng) {
    journeyLayer.clearLayers();
    journeyShown = { data: d, latlng: latlng };
    refineRides(d, latlng);
    d.legs.forEach(function (leg) {
      var pts = leg.shapePath || leg.path;
      var base = { pane: 'journey', interactive: false, lineCap: 'round', lineJoin: 'round' };
      if (leg.type === 'walk') {
        L.polyline(pts, L.extend({ color: '#ffffff', weight: 7, opacity: 0.9 }, base)).addTo(journeyLayer);
        L.polyline(pts, L.extend({ color: '#0f172a', weight: 3.5, dashArray: '1 6', opacity: 1 }, base)).addTo(journeyLayer);
      } else {
        L.polyline(pts, L.extend({ color: '#ffffff', weight: 9, opacity: 0.95 }, base)).addTo(journeyLayer);
        L.polyline(pts, L.extend({ color: legColor(leg), weight: 5, opacity: 1 }, base)).addTo(journeyLayer);
        [pts[0], pts[pts.length - 1]].forEach(function (p) {
          L.circleMarker(p, { pane: 'journey', interactive: false, radius: 6, weight: 3, color: legColor(leg), fillColor: '#ffffff', fillOpacity: 1 }).addTo(journeyLayer);
        });
      }
    });
    var end = L.circleMarker([d.target.lat, d.target.lon], {
      pane: 'journey', interactive: false, radius: 7, weight: 3, color: '#ffffff', fillColor: '#0f172a', fillOpacity: 1
    });
    end.addTo(journeyLayer);
    journeyTooltip(journeyContent(d), latlng);
  }

  function rerenderJourney() {
    if (journeyShown) drawJourney(journeyShown.data, journeyShown.latlng);
  }

  async function fetchJourney(latlng) {
    if (!journeyBody) return;
    var key = latlng.lat + ',' + latlng.lng;
    var token = ++journeyToken;
    if (journeyCtrl) journeyCtrl.abort();
    if (journeyCache[key]) { drawJourney(journeyCache[key], latlng); return; }
    var ctrl = new AbortController();
    journeyCtrl = ctrl;
    var timer = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var body = Object.assign({}, journeyBody, { target: { lat: latlng.lat, lon: latlng.lng } });
      var res = await fetch(JOURNEY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal
      });
      if (token !== journeyToken) return;
      if (!res.ok) {
        journeyNotice(latlng, res.status === 404 ? 'jUnreachable' : 'jUnavailable');
        return;
      }
      var data = await res.json();
      if (token !== journeyToken) return;
      journeyCache[key] = data;
      journeyCacheKeys.push(key);
      if (journeyCacheKeys.length > 60) delete journeyCache[journeyCacheKeys.shift()];
      drawJourney(data, latlng);
    } catch (e) {
      if (token === journeyToken) journeyNotice(latlng, 'jUnavailable');
    } finally {
      clearTimeout(timer);
      if (journeyCtrl === ctrl) journeyCtrl = null;
    }
  }

  function setJourneyBody(body) {
    hideJourney();
    journeyCache = {};
    journeyCacheKeys = [];
    journeyBody = body && params.get('stub') !== '1' ? body : null;
    $('journey-hint').hidden = !journeyBody;
    $('journey-hint').textContent = t(canHover ? 'jHint' : 'jHintTouch');
  }

  if (canHover) {
    map.on('mousemove', function (e) {
      if (!journeyBody || mapBusy) return;
      hideJourney();
      journeyTimer = setTimeout(function () { fetchJourney(e.latlng); }, 140);
    });
    map.on('mouseout', hideJourney);
  }
  map.on('dragstart zoomstart movestart', function () { mapBusy = true; hideJourney(); });
  map.on('dragend zoomend moveend', function () { mapBusy = false; });
  pin.on('dragstart', function () { setJourneyBody(null); });

  // Touch: press and hold shows the journey; a tap elsewhere hides it again.
  (function () {
    var holdTimer = null;
    var startX = 0, startY = 0;
    var el = map.getContainer();
    function cancel() { clearTimeout(holdTimer); holdTimer = null; }
    el.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType !== 'touch' || !journeyBody || ev.target.closest('.leaflet-control, .leaflet-marker-icon')) return;
      startX = ev.clientX; startY = ev.clientY;
      var latlng = map.mouseEventToLatLng(ev);
      cancel();
      holdTimer = setTimeout(function () {
        holdTimer = null;
        suppressClickUntil = Date.now() + 700;
        fetchJourney(latlng);
      }, 450);
    });
    el.addEventListener('pointermove', function (ev) {
      if (holdTimer && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
  })();
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideJourney(); });

  // Screen-reader sentence ("Within 30 min: 1027 stations") from vijay-team's summary module.
  var stopsPromise = null;
  function speakSummary(fc) {
    var el = $('summary');
    el.textContent = '';
    if (!window.VijaySummary || (fc.meta && fc.meta.walkOnly)) return;
    if (!stopsPromise) {
      stopsPromise = fetch('/t/vijay-team/stops').then(function (r) { return r.json(); })
        .catch(function () { stopsPromise = null; return null; });
    }
    stopsPromise.then(function (stops) {
      if (!stops) return;
      try { el.textContent = VijaySummary.describe(VijaySummary.summarize(fc, stops), lang); } catch (e) { /* optional */ }
    });
  }

  $('form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var body;
    try {
      body = readSettings();
    } catch (e) {
      setStatus(e.message, true);
      return;
    }
    var btn = $('update');
    btn.disabled = true;
    btn.classList.add('loading');
    setStatus(t('calculating'));
    setJourneyBody(null);
    var started = performance.now();
    try {
      var fc = await callEngine(body);
      if (!renderIsochrones(fc)) {
        setStatus(t('err.empty'), true);
      } else {
        setStatus(t('done', { s: ((performance.now() - started) / 1000).toFixed(1) }));
        speakSummary(fc);
        setJourneyBody(fc && fc.meta && fc.meta.walkingModel === 'street' ? body : null);
        if (fc && fc.meta && fc.meta.walkingModel === 'street') markStreetWalk();
        else if (!(fc && fc.meta && fc.meta.walkOnly)) loadWalkArea(pin.getLatLng(), body.walking.accessMinutes);
        if (window.matchMedia('(max-width: 700px)').matches) {
          panel.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    } catch (e) {
      setStatus(errorMessage(e), true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  if (params.get('stub') === '1') {
    var s = document.createElement('script');
    s.src = 'stub.js';
    document.head.appendChild(s);
  } else {
    fetch('/t/marlin/health').then(function (r) { return r.json(); }).then(function (h) {
      $('banner').hidden = h.source !== 'fixture';
    }).catch(function () { /* the Update call reports engine problems */ });
  }

  // ---- Share link: pin and settings live in the URL hash ----
  var HASH_FIELDS = { t: 'max-travel', w: 'max-wait', x: 'max-transfers', d: 'walk-dest', r: 'walk-transfer' };
  function writeHash() {
    var p = pin.getLatLng();
    var h = new URLSearchParams();
    h.set('ll', p.lat.toFixed(5) + ',' + p.lng.toFixed(5));
    Object.keys(HASH_FIELDS).forEach(function (k) { h.set(k, $(HASH_FIELDS[k]).value); });
    h.set('m', Array.prototype.slice.call(modesBox.querySelectorAll('input:checked'))
      .map(function (cb) { return cb.value; }).join(','));
    history.replaceState(null, '', '#' + h.toString());
  }
  function readHash() {
    if (location.hash.length < 2) return false;
    var h = new URLSearchParams(location.hash.slice(1));
    var ll = (h.get('ll') || '').split(',').map(Number);
    if (ll.length !== 2 || ll.some(isNaN) || Math.abs(ll[0]) > 90 || Math.abs(ll[1]) > 180) return false;
    pin.setLatLng(ll);
    map.setView(ll, 12);
    showOrigin();
    Object.keys(HASH_FIELDS).forEach(function (k) {
      var v = parseInt(h.get(k), 10);
      if (!isNaN(v)) $(HASH_FIELDS[k]).value = v;
    });
    if (h.has('m')) {
      var on = h.get('m').split(',');
      modesBox.querySelectorAll('input').forEach(function (cb) { cb.checked = on.indexOf(cb.value) !== -1; });
    }
    syncTravel();
    return true;
  }
  $('form').addEventListener('submit', writeHash);
  var fromHash = readHash();

  // vijay-team's /meta says which dates the timetable covers; warn when the chosen date is outside.
  var feed = null;
  function dayKey(v) { return String(v).replace(/-/g, '').slice(0, 8); }
  function checkFeed() {
    var el = $('feed-warn');
    var d = $('start-time').value;
    var out = !!(feed && d) && (dayKey(d) < dayKey(feed.validFrom) || dayKey(d) > dayKey(feed.validTo));
    el.hidden = !out;
    if (out) el.textContent = t('warn.feed', { from: feed.validFrom, to: feed.validTo });
  }
  $('start-time').addEventListener('change', checkFeed);
  fetch('/t/vijay-team/meta').then(function (r) { return r.json(); }).then(function (m) {
    if (m && m.feed && m.feed.validFrom && m.feed.validTo) { feed = m.feed; checkFeed(); }
  }).catch(function () { /* optional */ });

  applyLang();
  if (fromHash) $('form').requestSubmit();
})();
