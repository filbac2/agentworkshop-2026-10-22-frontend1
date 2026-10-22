// tomfor walk-mode.js: drop-in walk-only mode for the group map (mareri). Classic script, no build step.
//   <script src="/colony/tomfor/walk-mode.js"></script>
// Exposes window.TomforWalk. Contract: projects/tomfor/WALK-CONTRACT.md
//
// fetchWalkBands asks filbac's gateway (POST /t/filbac/api/isochrone, modes []) for walking bands in marlin's band
// format. If the gateway has no walk mode (or is down) it builds the same bands itself from mareri's
// GET /t/mareri/walk (street network, max 30 min), with a straight-line estimate beyond 30 min, like the gateway.
(function (root) {
  'use strict';

  var GATEWAY = '/t/filbac/api/isochrone';
  var MARERI_WALK = '/t/mareri/walk';
  var STREET_MAX = 30;
  var DETOUR = 1.3;
  var MAX_BANDS = 24;
  var TIMEOUT_MS = 20000;

  // Fallback copy, same text as strings.js / mareri-adapter.js; used only if neither is loaded.
  var TEXT = {
    en: {
      'mode.walk': 'Walk',
      'legend.walkOnly': 'Walking only, along streets',
      'legend.walkOnly.note': 'Walking time from the pin along streets, no public transport.',
      'result.walkOnly': 'All transport types are off, so the map shows only how far you can walk in {max} min.',
      'error.walk_unavailable': 'The walking area could not be calculated right now.',
      'error.walk_unavailable.fix': 'Turn on at least one transport type, or try again in a minute.',
      'error.bad_request': 'The request could not be understood.',
      'error.bad_request.fix': 'Move the pin inside the Stockholm region and check the settings.',
      'error.timeout': 'The walking area took too long to calculate.',
      'error.timeout.fix': 'Try again in a moment.',
      'error.offline': 'You seem to be offline.',
      'error.offline.fix': 'Check your connection and try again.',
    },
    sv: {
      'mode.walk': 'Gång',
      'legend.walkOnly': 'Endast gång, längs gator',
      'legend.walkOnly.note': 'Gångtid från nålen längs gatorna, utan kollektivtrafik.',
      'result.walkOnly': 'Alla trafikslag är avstängda, så kartan visar bara hur långt du hinner gå på {max} min.',
      'error.walk_unavailable': 'Gångområdet kunde inte beräknas just nu.',
      'error.walk_unavailable.fix': 'Slå på minst ett trafikslag, eller försök igen om en minut.',
      'error.bad_request': 'Förfrågan kunde inte tolkas.',
      'error.bad_request.fix': 'Flytta nålen inom Stockholmsregionen och kontrollera inställningarna.',
      'error.timeout': 'Det tog för lång tid att beräkna gångområdet.',
      'error.timeout.fix': 'Försök igen om en stund.',
      'error.offline': 'Du verkar vara offline.',
      'error.offline.fix': 'Kontrollera anslutningen och försök igen.',
    },
  };

  function lang(l) {
    var s = String(l || (root.document && root.document.documentElement && root.document.documentElement.lang) || 'en');
    return s.toLowerCase().indexOf('sv') === 0 ? 'sv' : 'en';
  }

  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? String(vars[k]) : m;
    });
  }

  // strings.js keys. Uses window.TomforStrings.t if the integrator exposed it, else our copy.
  function text(l, key, vars) {
    l = lang(l);
    var S = root.TomforStrings;
    if (S && typeof S.t === 'function') {
      var v = S.t(l, key, vars || {});
      if (v && v !== key) return v;
    }
    return fill((TEXT[l] && TEXT[l][key]) || TEXT.en[key] || key, vars);
  }

  // Chip label: mareri's I18N (merged by mareri-adapter.js) wins, then strings.js keys.
  function chipLabel(l) {
    var I = root.I18N;
    var d = I && I[lang(l)];
    if (d && d['mode.walk']) return d['mode.walk'];
    return text(l, 'mode.walk');
  }

  function walkError(code, message, extra) {
    var e = new Error(message || code);
    e.name = 'WalkError';
    e.code = code;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  // One friendly sentence plus fix for a WalkError, via errors.js codes (TomforMareri.errorText when loaded).
  function errorText(l, err) {
    var code = (err && err.code) || 'walk_unavailable';
    var M = root.TomforMareri;
    if (M && typeof M.errorText === 'function') {
      try {
        var r = M.errorText(lang(l), { code: code });
        if (r) return r;
      } catch (e) { /* fall back to our copy */ }
    }
    var key = TEXT.en['error.' + code] ? code : 'walk_unavailable';
    return text(l, 'error.' + key) + ' ' + text(l, 'error.' + key + '.fix');
  }

  function validate(o) {
    var lat = Number(o.lat), lon = Number(o.lon);
    var max = Number(o.maxMinutes == null ? 30 : o.maxMinutes);
    var step = Number(o.stepMinutes == null ? 5 : o.stepMinutes);
    var speed = Number(o.speedKmh == null ? 4.8 : o.speedKmh);
    if (!(lat >= 58.5 && lat <= 60.5 && lon >= 17 && lon <= 19.5)) {
      return walkError('bad_request', 'origin must be a point in the Stockholm region.');
    }
    if (!Number.isInteger(max) || max < 5 || max > 120) {
      return walkError('bad_request', 'maxMinutes must be a whole number from 5 to 120.');
    }
    if (!Number.isInteger(step) || step < 1 || step > 30) {
      return walkError('bad_request', 'stepMinutes must be a whole number from 1 to 30.');
    }
    if (!(speed >= 1 && speed <= 10)) return walkError('bad_request', 'speedKmh must be between 1 and 10.');
    return { lat: lat, lon: lon, max: max, step: Math.max(step, Math.ceil(max / MAX_BANDS)), speed: speed };
  }

  function edgesFor(q) {
    var e = [];
    for (var m = q.step; m < q.max; m += q.step) e.push(m);
    e.push(q.max);
    return e;
  }

  function kmBetween(lat, lon, p) {
    var dy = (p[1] - lat) * 111.32;
    var dx = (p[0] - lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function farthestKm(lat, lon, geometry) {
    var polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    var max = 0;
    polys.forEach(function (poly) {
      (poly[0] || []).forEach(function (p) { max = Math.max(max, kmBetween(lat, lon, p)); });
    });
    return max;
  }

  // minKm: the circle must reach at least this far (keeps estimate bands around the last street band).
  function estimateCircle(lat, lon, minutes, speedKmh, minKm) {
    var km = (speedKmh * minutes) / 60 / DETOUR;
    if (minKm && minKm > km) km = minKm / Math.cos(Math.PI / 48);
    var dLat = km / 111.32;
    var dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    var ring = [];
    for (var i = 0; i <= 48; i++) {
      var a = (i / 48) * 2 * Math.PI;
      ring.push([+(lon + dLon * Math.cos(a)).toFixed(5), +(lat + dLat * Math.sin(a)).toFixed(5)]);
    }
    return { type: 'MultiPolygon', coordinates: [[ring]] };
  }

  function timed(fetchFn, url, init, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    var opts = Object.assign({}, init || {}, ctl ? { signal: ctl.signal } : {});
    return Promise.resolve(fetchFn(url, opts)).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // Straight-line bands beyond 30 min can be smaller than the 30-min street band (streets reach farther than
  // speed/1.3). Grow each estimate band so it reaches at least the last street band, scaled by minutes, so bands nest.
  function repairSeam(fc) {
    var meta = fc.meta || {};
    var o = meta.origin || {};
    var speed = meta.speedKmh || 4.8;
    var last = null;
    for (var i = fc.features.length - 1; i >= 0; i--) {
      var f = fc.features[i];
      var p = f.properties || {};
      var to = p.toMinutes != null ? p.toMinutes : p.to_min;
      if (!f.geometry) continue;
      var km = farthestKm(o.lat, o.lon, f.geometry);
      if (p.source === 'estimate' && last) {
        var need = last.km * (to / last.to);
        if (km < need) {
          f.geometry = estimateCircle(o.lat, o.lon, to, speed, need);
          p.seamRepaired = true;
          meta.seamRepaired = true;
          km = farthestKm(o.lat, o.lon, f.geometry);
        }
      }
      if (p.source === 'street' || (last && km > last.km)) last = { km: km, to: to };
    }
    return fc;
  }

  function isWalkBands(j) {
    return !!(j && j.type === 'FeatureCollection' && j.meta && j.meta.walkOnly === true && Array.isArray(j.features));
  }

  // Same wrapping as filbac's gateway walkOnly(): cumulative bands, outermost first.
  function wrap(q, edges, parts, t0) {
    var features = edges.map(function (to, i) {
      return {
        type: 'Feature',
        properties: {
          fromMinutes: i ? edges[i - 1] : 0, toMinutes: to,
          from_min: i ? edges[i - 1] : 0, to_min: to,
          bandIndex: i + 1, stops: 0, mode: 'walk', source: parts[i].source,
        },
        geometry: parts[i].geometry,
      };
    }).reverse();
    var sources = {};
    parts.forEach(function (p) { sources[p.source] = 1; });
    var keys = Object.keys(sources);
    return {
      type: 'FeatureCollection',
      meta: {
        origin: { lat: q.lat, lon: q.lon },
        bandMinutes: q.step, maxTravelMinutes: q.max, walkOnly: true, modes: ['walk'],
        speedKmh: q.speed, stopsReached: 0, computedMs: Date.now() - t0,
        source: keys.length > 1 ? 'mixed' : keys[0],
        algorithm: 'walk-only (mareri street network, straight-line estimate beyond ' + STREET_MAX + ' min)',
        cumulativeBands: true,
        via: 'tomfor-fallback',
      },
      features: features,
    };
  }

  function fallback(q, base, fetchFn, ms, opts) {
    var t0 = Date.now();
    var edges = edgesFor(q);
    var failures = 0;
    var streetTried = 0;
    return Promise.all(edges.map(function (m) {
      if (m > STREET_MAX) return { geometry: estimateCircle(q.lat, q.lon, m, q.speed), source: 'estimate' };
      streetTried++;
      var url = base + MARERI_WALK + '?lat=' + q.lat + '&lon=' + q.lon + '&minutes=' + m + '&speedKmh=' + q.speed;
      return timed(fetchFn, url, { headers: { accept: 'application/json' } }, ms).then(function (r) {
        if (!r.ok) throw new Error('mareri ' + r.status);
        return r.json();
      }).then(function (f) {
        if (!f || !f.geometry) throw new Error('mareri: no geometry');
        return { geometry: f.geometry, source: 'street' };
      }).catch(function () {
        failures++;
        return { geometry: estimateCircle(q.lat, q.lon, m, q.speed), source: 'estimate' };
      });
    })).then(function (parts) {
      if (streetTried > 0 && failures === streetTried) {
        throw walkError('walk_unavailable', 'Neither the gateway walk mode nor mareri /walk answered.');
      }
      var fc = wrap(q, edges, parts, t0);
      return opts.repairSeam === false ? fc : repairSeam(fc);
    });
  }

  // fetchWalkBands({lat, lon, maxMinutes=30, stepMinutes=5, speedKmh=4.8}, {base, fetch, timeoutMs, gateway=true})
  // Resolves to a FeatureCollection in marlin's band format with meta.walkOnly true.
  // Rejects with a WalkError whose .code is an errors.js code: bad_request, walk_unavailable, timeout, offline.
  function fetchWalkBands(o, opts) {
    o = o || {};
    opts = opts || {};
    var q = validate(o);
    if (q instanceof Error) return Promise.reject(q);
    var fetchFn = opts.fetch || (root.fetch && root.fetch.bind(root));
    var base = opts.base || '';
    var ms = opts.timeoutMs || TIMEOUT_MS;
    if (root.navigator && root.navigator.onLine === false) {
      return Promise.reject(walkError('offline', 'The browser is offline.'));
    }
    var body = {
      origin: { lat: q.lat, lon: q.lon }, modes: [], maxTravelMinutes: q.max, bandMinutes: Number(o.stepMinutes == null ? 5 : o.stepMinutes),
      walking: { speedKmh: q.speed },
    };
    var viaGateway = opts.gateway === false ? Promise.resolve(null) : timed(fetchFn, base + GATEWAY, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
    }, ms).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok && isWalkBands(j)) {
          j.meta.via = j.meta.via || 'gateway';
          return opts.repairSeam === false ? j : repairSeam(j);
        }
        return null;
      });
    }, function (e) {
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return 'timeout';
      return null;
    });
    return viaGateway.then(function (j) {
      if (j && j !== 'timeout') return j;
      return fallback(q, base, fetchFn, ms, opts).catch(function (e) {
        if (j === 'timeout') throw walkError('timeout', 'The walk request timed out.');
        throw e;
      });
    });
  }

  // Optional Walk chip. onToggle(on) is called on click; returns the button.
  function addWalkChip(container, onToggle, options) {
    options = options || {};
    var doc = (container && container.ownerDocument) || root.document;
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = options.className || 'chip tomfor-walk-chip';
    b.setAttribute('data-mode', 'walk');
    var on = !!options.on;
    function render() {
      var l = options.lang ? (typeof options.lang === 'function' ? options.lang() : options.lang) : undefined;
      b.textContent = chipLabel(l);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = text(l, 'legend.walkOnly.note');
    }
    b.addEventListener('click', function () {
      on = !on;
      render();
      if (typeof onToggle === 'function') onToggle(on);
    });
    b.refresh = render;
    render();
    if (container) container.appendChild(b);
    return b;
  }

  // Legend line and result sentence for a walk-only result.
  function legendText(l, fc) {
    var max = fc && fc.meta && fc.meta.maxTravelMinutes;
    return { title: text(l, 'legend.walkOnly'), note: text(l, 'legend.walkOnly.note'), result: text(l, 'result.walkOnly', { max: max }) };
  }

  root.TomforWalk = {
    version: 1,
    STREET_MAX: STREET_MAX,
    fetchWalkBands: fetchWalkBands,
    addWalkChip: addWalkChip,
    legendText: legendText,
    errorText: errorText,
    isWalkBands: isWalkBands,
    repairSeam: repairSeam,
    _edges: function (o) { var q = validate(o); return q instanceof Error ? q : edgesFor(q); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
