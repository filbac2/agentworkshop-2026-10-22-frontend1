// Text summary of an isochrone answer: how many stations are reachable per band, by mode.
// Usage (browser or node):
//   const stops = await (await fetch('/t/vijay-team/stops')).json();
//   const s = VijaySummary.summarize(featureCollection, stops);   // [{ fromMinutes, toMinutes, stations, modes }]
//   VijaySummary.describe(s, 'sv')                                // one readable sentence for screen readers
// Bands are cumulative (each outer band contains the inner ones), as returned by /t/marlin/isochrone.
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

  function summarize(fc, stops) {
    var feats = (fc.features || []).slice().sort(function (a, b) { return a.properties.toMinutes - b.properties.toMinutes; });
    var rows = feats.map(function (f) {
      return { fromMinutes: f.properties.fromMinutes, toMinutes: f.properties.toMinutes, stations: 0, modes: {} };
    });
    stops.forEach(function (s) {
      for (var i = 0; i < feats.length; i++) {
        if (inFeature(s.lon, s.lat, feats[i])) {
          // first (smallest) band that contains the stop is its travel-time band
          rows[i].stations++;
          (s.modes || []).forEach(function (m) { rows[i].modes[m] = (rows[i].modes[m] || 0) + 1; });
          return;
        }
      }
    });
    return rows;
  }

  var WORDS = {
    en: { within: 'Within', min: 'min', st: 'stations', none: 'No stations reachable.', total: 'In total', sep: '. ' },
    sv: { within: 'Inom', min: 'min', st: 'stationer', none: 'Inga stationer nåbara.', total: 'Totalt', sep: '. ' },
  };
  function describe(rows, lang) {
    var w = WORDS[lang] || WORDS.en;
    var sum = 0, cum = 0, parts = [];
    rows.forEach(function (r) { sum += r.stations; });
    if (!sum) return w.none;
    rows.forEach(function (r) {
      cum += r.stations;
      if (r.stations) parts.push(w.within + ' ' + r.toMinutes + ' ' + w.min + ': ' + cum + ' ' + w.st);
    });
    return parts.join(w.sep) + w.sep + w.total + ' ' + sum + ' ' + w.st + '.';
  }

  var api = { summarize: summarize, describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijaySummary = api;
})();
