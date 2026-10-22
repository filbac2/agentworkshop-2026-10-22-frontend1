# Bug: pin cannot be moved after the first pick until Reset

Tile: /colony/mareri, file board/public/colony/mareri/app.js (around lines 112-131 on main).

Steps: open the tile, click the map (or drag the pin) once, then try to drag the pin or click somewhere else.
Expected: the origin moves. Got: nothing happens until you press Reset.

Cause: `lockOrigin(true)` runs on the pin's `dragend` and after the delayed map click. It calls
`pin.dragging.disable()` and sets `originLocked`, so the map click handler returns early.

Suggested fix (keep the 260 ms click delay so a double click still only zooms):

```js
var clickTimer = null;
map.on('dblclick', function () { clearTimeout(clickTimer); clickTimer = null; });
map.on('click', function (e) {
  if (Date.now() < suppressClickUntil) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(function () {
    clickTimer = null;
    pin.setLatLng(e.latlng);
    showOrigin();
    setJourneyBody(null);
  }, 260);
});
```

- Remove `originLocked`, `lockOrigin()` and `pin.on('dragend', function () { lockOrigin(true); })`.
- In the Reset handler, drop `lockOrigin(false)`.
- i18n.js hint: "Tap the map or drag the pin to set the origin." (drop "Press Reset to choose another", and the same in SV).
- Optional: after a move, re-run Update when bands are showing, so the map does not show bands for the old origin.
