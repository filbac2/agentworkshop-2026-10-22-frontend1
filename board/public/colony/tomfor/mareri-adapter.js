// Drop-in adapter for /colony/mareri (classic script, no build step). Load it after i18n.js, before app.js:
//   <script src="i18n.js"></script>
//   <script src="/colony/tomfor/mareri-adapter.js"></script>
//   <script src="app.js"></script>
// It (1) merges plain-language EN/SV wording into window.I18N, (2) keeps aria-labels on #map, .lang,
// #sheet-toggle and [data-i18n-aria] in the current language, and (3) exposes
// window.TomforMareri.errorText(lang, err): marlin errors -> one friendly sentence plus a fix, via errors.js.
(function (root) {
  'use strict';

  // Keys use mareri's own names. Only keys that are new or worded better than in mareri's i18n.js.
  var STRINGS = {
    en: {
      title: 'Stockholm travel-time map',
      walkReal: 'Walking area along streets from the pin ({n} min)',
      'err.unavailable': 'The travel-time service is not available right now. Try again in a minute.',
      'err.network': 'Could not reach the travel-time service. Check your connection and try again.',
      'err.empty': 'No areas found. Try a longer travel time or more transport types.',
      'err.unknown': 'Something went wrong. Reload the page and try again.',
      'err.noRoutes': 'No routes found from this spot. Move the pin closer to a stop or station, or choose another start time.',
      'err.tooRestrictive': 'The settings are too restrictive. Allow more connections, a longer waiting time, more walking or more transport types.',
      'err.badRequest': 'Some settings are not valid. Check the values and try again.',
      'warn.fixture': 'Showing test data, so results are not real SL timetables yet.',
      'aria.map': 'Map',
      'aria.language': 'Language',
      'aria.sheetToggle': 'Show or hide settings',
      // Walk-only mode (proposed, #build 272): additive, unused until mareri renders it.
      'mode.walk': 'Walk',
      legendWalk: 'Walking only, along streets',
      walkOnly: 'All transport types are off, so the map shows only how far you can walk in {n} min.',
      'err.walkUnavailable': 'The walking area could not be calculated right now. Turn on at least one transport type, or try again in a minute.'
    },
    sv: {
      title: 'Restidskarta för Stockholm',
      'sec.limits': 'Väntetid och gång',
      walkReal: 'Gångområde längs gatorna från nålen ({n} min)',
      'err.unavailable': 'Restidsberäkningen är inte tillgänglig just nu. Försök igen om en minut.',
      'err.network': 'Kunde inte nå restidstjänsten. Kontrollera anslutningen och försök igen.',
      'err.empty': 'Inga områden hittades. Prova en längre restid eller fler trafikslag.',
      'err.unknown': 'Något gick fel. Ladda om sidan och försök igen.',
      'err.noRoutes': 'Inga resvägar hittades från den här platsen. Flytta nålen närmare en hållplats eller station, eller välj en annan starttid.',
      'err.tooRestrictive': 'Inställningarna är för snäva. Tillåt fler byten, längre väntetid, mer gång eller fler trafikslag.',
      'err.badRequest': 'Vissa inställningar är ogiltiga. Kontrollera värdena och försök igen.',
      'warn.fixture': 'Kartan visar testdata, så resultaten bygger ännu inte på riktiga SL-tidtabeller.',
      'aria.map': 'Karta',
      'aria.language': 'Språk',
      'aria.sheetToggle': 'Visa eller dölj inställningar',
      'mode.walk': 'Gång',
      legendWalk: 'Endast gång, längs gator',
      walkOnly: 'Alla trafikslag är avstängda, så kartan visar bara hur långt du hinner gå på {n} min.',
      'err.walkUnavailable': 'Gångområdet kunde inte beräknas just nu. Slå på minst ett trafikslag, eller försök igen om en minut.'
    }
  };

  var ARIA = { '#map': 'aria.map', '.lang': 'aria.language', '#sheet-toggle': 'aria.sheetToggle' };

  function mergeStrings(i18n) {
    if (!i18n) return i18n;
    Object.keys(STRINGS).forEach(function (l) {
      i18n[l] = i18n[l] || {};
      Object.keys(STRINGS[l]).forEach(function (k) { i18n[l][k] = STRINGS[l][k]; });
    });
    return i18n;
  }

  function str(lang, key) {
    var t = root.I18N || STRINGS;
    return (t[lang] && t[lang][key]) || (t.en && t.en[key]) || STRINGS.en[key] || key;
  }

  function localizeAria(lang, doc) {
    doc = doc || root.document;
    if (!doc) return;
    lang = lang || doc.documentElement.lang || 'en';
    Object.keys(ARIA).forEach(function (sel) {
      doc.querySelectorAll(sel).forEach(function (el) { el.setAttribute('aria-label', str(lang, ARIA[sel])); });
    });
    doc.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', str(lang, el.getAttribute('data-i18n-aria')));
    });
  }

  // Turns mareri's thrown Error (status, engineMessage, optional code/kind/body) into what errors.js classifies.
  function toTomforError(err) {
    if (!err || typeof err !== 'object') return err;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return err;
    var body = err.body || err.data || {};
    var code = [err.code, body.code, body.error, err.kind, body.kind].filter(function (c) { return typeof c === 'string'; })[0];
    if (code) return { code: code, status: err.status };
    if (err.isNetwork) return { code: 'unreachable' };
    if (err.status === 404 || err.status === 502 || err.status === 503) return { code: 'unavailable', status: err.status };
    if (err.status) return { status: err.status };
    return err;
  }

  var errors = null;

  // -> {key, text, fix, message} or null while errors.js is still loading (then use your own message).
  function errorInfo(lang, err) {
    if (!errors) return null;
    lang = lang === 'sv' ? 'sv' : 'en';
    var info = errors.errorMessage(lang, toTomforError(err));
    // marlin's own message is more precise (e.g. "within a 10 minute walk"); keep our fix after it.
    var engine = lang === 'sv' ? (err && (err.engineMessageSv || (err.body && err.body.message_sv))) : (err && (err.engineMessage || (err.body && err.body.message)));
    var text = engine && info.key !== 'unknown' ? engine : info.text;
    return { key: info.key, code: info.code, text: text, fix: info.fix, message: text + ' ' + info.fix };
  }

  function errorText(lang, err) {
    var info = errorInfo(lang, err);
    return info ? info.message : null;
  }

  function use(errorsModule) { errors = errorsModule; return api; }

  var api = {
    strings: STRINGS,
    mergeStrings: mergeStrings,
    localizeAria: localizeAria,
    toTomforError: toTomforError,
    errorInfo: errorInfo,
    errorText: errorText,
    use: use,
    ready: null
  };

  var base = '/colony/tomfor/';
  try {
    var src = root.document && root.document.currentScript && root.document.currentScript.src;
    if (src) base = src.replace(/[^/]*$/, '');
  } catch (e) { /* keep default base */ }
  try {
    api.ready = import(base + 'errors.js').then(use).catch(function () { return api; });
  } catch (e) {
    api.ready = Promise.resolve(api);
  }

  mergeStrings(root.I18N);
  root.TomforMareri = api;

  var doc = root.document;
  if (doc && doc.documentElement) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { localizeAria(); });
    else localizeAria();
    if (root.MutationObserver) {
      new root.MutationObserver(function () { localizeAria(); })
        .observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
