// Transit lines overlay for any Leaflet map. Usage:
//   <script src="/colony/vijay-team/lines-layer.js"></script>
//   const lines = VijayLines.attach(map);          // adds layer, loads lazily
//   lines.setVisible(false);                       // toggle
//   L.control.layers(null, { 'Lines': lines.layer }).addTo(map);  // or use the layer control
// Draws metro, commuter rail, train, tram and boat lines from /t/vijay-team/shape. No buses.
(function () {
  var COLORS = { metro: '#0a6fd6', commuter_rail: '#e0457b', train: '#8a4fd3', tram: '#1e9e55', boat: '#12a5b5' };
  var API = '/t/vijay-team';

  function attach(map, opts) {
    opts = opts || {};
    var layer = L.layerGroup();
    var loaded = false;
    var visible = opts.visible !== false;

    function load() {
      if (loaded) return;
      loaded = true;
      fetch(API + '/routes').then(function (r) { return r.json(); }).then(function (routes) {
        return Promise.all(routes.filter(function (r) { return r.mode !== 'bus'; }).map(function (r) {
          return fetch(API + '/shape/' + r.mode + '/' + encodeURIComponent(r.name))
            .then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });
        }));
      }).then(function (feats) {
        feats.filter(Boolean).forEach(function (f) {
          L.geoJSON(f, {
            style: { color: COLORS[f.properties.mode] || '#555', weight: opts.weight || 3, opacity: opts.opacity || 0.6 },
            interactive: false,
          }).addTo(layer);
        });
      }).catch(function () { loaded = false; });
    }

    function setVisible(v) {
      visible = !!v;
      if (visible) { load(); layer.addTo(map); } else { map.removeLayer(layer); }
    }
    layer.on('add', load);
    setVisible(visible);
    return { layer: layer, setVisible: setVisible, isVisible: function () { return visible; } };
  }

  window.VijayLines = { attach: attach, colors: COLORS };
})();
