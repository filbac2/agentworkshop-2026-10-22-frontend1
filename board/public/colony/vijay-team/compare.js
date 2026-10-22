// Meeting-point and reliability helpers on top of marlin's /t/marlin/isochrone answers.
// Pure client-side: no engine change. Works in the browser (window.VijayCompare) and in node (require).
//
//   const stops = await (await fetch('/t/vijay-team/stops')).json();
//   const a = await iso({ origin: A, ... }), b = await iso({ origin: B, ... });
//   VijayCompare.meeting(a, b, stops, { by: 'max' }).best      // fairest meeting station
//   VijayCompare.reliability(await VijayCompare.sample(iso, body, '08:00', 20, 5), stops, 0.8)
//
// Bands from marlin are cumulative; a station's time is the toMinutes of the smallest band that contains it.
// Use bandMinutes 1 or 2 for finer meeting-point ranking.
(function () {
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygon(x, y, poly) {
    if (!inRing(x, y, poly[0])) return false;
    for (var h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
    return true;
  }
  function inFeature(x, y, f) {
    var g = f.geometry;
    if (!g) return false;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (var i = 0; i < polys.length; i++) if (inPolygon(x, y, polys[i])) return true;
    return false;
  }

  // Minutes (band upper bound) at which a station is reached, or null.
  function stopMinutes(fc, s) {
    var best = null;
    (fc.features || []).forEach(function (f) {
      var t = f.properties.toMinutes;
      if ((best === null || t < best) && inFeature(s.lon, s.lat, f)) best = t;
    });
    return best;
  }

  // Stations reachable from both origins, ranked by the longer journey ('max', default) or the sum ('sum').
  function meeting(fcA, fcB, stops, opts) {
    var by = (opts && opts.by) || 'max';
    var limit = (opts && opts.limit) || 10;
    var rows = [];
    stops.forEach(function (s) {
      var a = stopMinutes(fcA, s);
      if (a === null) return;
      var b = stopMinutes(fcB, s);
      if (b === null) return;
      rows.push({ index: s.index, name: s.name, lat: s.lat, lon: s.lon, modes: s.modes, minutesA: a, minutesB: b, max: Math.max(a, b), sum: a + b });
    });
    rows.sort(function (x, y) { return x[by] - y[by] || x.sum - y.sum; });
    return { common: rows.length, best: rows[0] || null, top: rows.slice(0, limit) };
  }

  function hhmmAdd(start, minutes) {
    var p = start.split(':');
    var t = (Number(p[0]) * 60 + Number(p[1]) + minutes) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  // Runs iso(body) at start, start+step, ... over a window; iso is any function returning a Promise of a FeatureCollection.
  function sample(iso, body, startHHMM, windowMinutes, stepMinutes) {
    var times = [];
    for (var m = 0; m <= windowMinutes; m += stepMinutes) times.push(hhmmAdd(startHHMM, m));
    return Promise.all(times.map(function (t) {
      return iso(Object.assign({}, body, { startTime: t }));
    })).then(function (fcs) { return { times: times, results: fcs }; });
  }

  // Share of samples in which each station is reachable; "reliable" = at least minShare of the samples.
  function reliability(sampled, stops, minShare) {
    var share = minShare === undefined ? 0.8 : minShare;
    var n = sampled.results.length;
    var rows = [];
    stops.forEach(function (s) {
      var hit = 0;
      sampled.results.forEach(function (fc) { if (stopMinutes(fc, s) !== null) hit++; });
      if (hit) rows.push({ index: s.index, name: s.name, lat: s.lat, lon: s.lon, reached: hit, samples: n, share: hit / n });
    });
    var reliable = rows.filter(function (r) { return r.share >= share; });
    return {
      samples: n, times: sampled.times, anyCount: rows.length, reliableCount: reliable.length,
      luckyCount: rows.length - reliable.length, reliable: reliable, rows: rows,
    };
  }

  var api = { stopMinutes: stopMinutes, meeting: meeting, sample: sample, reliability: reliability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayCompare = api;
})();
