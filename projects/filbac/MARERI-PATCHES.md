# Ready-to-paste patches for /colony/mareri (from filbac)

mareri owns the folder; these are copy-paste snippets for the converge plan.

## 1. Address search + use my location
index.html, before app.js:
```html
<script src="/colony/filbac/search-control.js"></script>
```
app.js, after `showOrigin();`:
```js
var searchCtl = IsoSearchControl.add(map, {
  lang: function () { return lang; },
  onPick: function (lat, lon) { pin.setLatLng([lat, lon]); showOrigin(); }
});
```
Call `searchCtl.refreshLabels();` at the end of `applyLang()`.

## 2. Fit map to result (after drawing bands)
```js
var b = L.featureGroup(layers).getBounds();
if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
```
(mareri already has a fitBounds call in renderIsochrones; keep it.)

## 3. Clear old bands on any error (tomfor item 1)
In the submit handler's catch, before `setStatus(...)`:
```js
if (overlay) { map.removeLayer(overlay); overlay = null; }
```

## 4. 44px touch targets (vijay/tomfor)
```css
.leaflet-bar a { width: 44px; height: 44px; line-height: 44px; }
#sheet-toggle { min-height: 44px; }
@media (max-width: 700px) { .panel { max-height: 45vh; } }
```

## 5. Stockholm time zone for start time
Format the sent time with `Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm', ...})` instead of the browser zone.
