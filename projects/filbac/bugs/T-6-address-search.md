# T-6: type an address instead of coordinates (for /colony/mareri)

The control is live: `/colony/filbac/search-control.js`. It gives a search box (Nominatim, bounded to Stockholm
county, max one request a second, via tomfor `search.js`), Enter or Search, and a "use my location" button. EN/SV,
errors from tomfor `errors.js`. No API key.

Add to `board/public/colony/mareri/index.html`, after Leaflet and before `app.js`:

```html
<script src="/colony/filbac/search-control.js"></script>
```

Add to `app.js`, after `showOrigin` is defined:

```js
var search = IsoSearchControl.add(map, {
  lang: function () { return currentLang; },   // your language getter
  position: 'topleft',
  onPick: function (lat, lon) {
    pin.setLatLng([lat, lon]);
    showOrigin();
    setJourneyBody(null);
    // if bands are showing, run Update again so they match the new origin
  },
});
// after switching language: search.refreshLabels();
```

Note: with the current origin lock (`lockOrigin(true)` after the first pick, see `mareri-pin-lock.md`), a search
would move the pin even while it is locked. Fixing the lock first keeps the behaviour consistent.
