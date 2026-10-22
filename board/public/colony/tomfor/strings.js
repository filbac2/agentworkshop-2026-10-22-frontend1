// EN/SV string tables. Keys are identical in both languages.
export const LANGS = ['en', 'sv'];
export const DEFAULT_LANG = 'en';

export const strings = {
  en: {
    'app.title': 'Stockholm travel-time map',
    'app.language': 'Language',
    'map.hint': 'Tap the map to place the pin',
    'pin.set': 'Origin: {lat}, {lon}',
    'pin.none': 'No origin selected',
    'pin.move': 'Move pin',
    'settings.title': 'Settings',
    'settings.startTime': 'Start time',
    'settings.now': 'Now',
    'settings.maxTravel': 'Maximum travel time',
    'settings.maxWait': 'Maximum waiting time',
    'settings.walkEnd': 'Walk from last stop to destination',
    'settings.walkTransfer': 'Walk between stations',
    'settings.modes': 'Transport types',
    'settings.maxTransfers': 'Maximum connections',
    'settings.minutes': '{n} min',
    'settings.update': 'Update',
    'settings.updating': 'Calculating…',
    'mode.bus': 'Bus',
    'mode.metro': 'Metro',
    'mode.tram': 'Tram',
    'mode.train': 'Train',
    'mode.commuter_rail': 'Commuter rail',
    'mode.boat': 'Boat',
    'mode.walk': 'Walk',
    'legend.title': 'Travel time from the pin',
    'legend.band': '{from}–{to} min',
    'legend.bandOpen': 'Over {from} min',
    'legend.walkOnly': 'Walking only, along streets',
    'legend.walkOnly.note': 'Walking time from the pin along streets, no public transport.',
    'result.summary': '{stops} stops and stations reached within {max} min',
    'result.computed': 'Calculated in {ms} ms',
    'result.walkOnly': 'All transport types are off, so the map shows only how far you can walk in {max} min.',
    'warning.fixture': 'Showing test data, not the real timetable.',
    'search.placeholder': 'Search address in Stockholm',
    'search.button': 'Search',
    'search.locate': 'Use my location',
    'search.locating': 'Finding your location…',
    'search.searching': 'Searching…',
    'search.noResults': 'No places found for "{q}".',
    'search.results': 'Search results',
    'error.title': 'Something went wrong',
    'error.heading': 'Error messages',
    'error.dismiss': 'Dismiss',
    'error.retry': 'Try again',
    'error.no_routes': 'No routes found from this spot.',
    'error.no_routes.fix': 'Move the pin closer to a stop or station, or choose another start time.',
    'error.no_stops': 'No stop or station within walking distance.',
    'error.no_stops.fix': 'Allow more walking, more transport types or more connections, or move the pin closer to a stop.',
    'error.too_restrictive': 'The settings are too restrictive.',
    'error.too_restrictive.fix': 'Allow more connections, a longer waiting time, more walking or more transport types, and try again.',
    'error.api': 'The travel-time service could not calculate this.',
    'error.api.fix': 'Try again in a moment.',
    'error.bad_request': 'Some settings are not valid.',
    'error.bad_request.fix': 'Check the values and try again.',
    'error.network_not_loaded': 'The timetable data is still loading.',
    'error.network_not_loaded.fix': 'Wait a few seconds and press Update again.',
    'error.offline': 'You are offline.',
    'error.offline.fix': 'Check your internet connection and try again.',
    'error.timeout': 'The request took too long.',
    'error.timeout.fix': 'Try a shorter travel time or try again.',
    'error.geo_denied': 'Location access was denied.',
    'error.geo_denied.fix': 'Allow location access in your browser, or search for an address instead.',
    'error.geo_unavailable': 'Your location could not be determined.',
    'error.geo_unavailable.fix': 'Search for an address or place the pin on the map instead.',
    'error.search_failed': 'The address search failed.',
    'error.search_failed.fix': 'Try again in a moment, or place the pin on the map.',
    'error.unavailable': 'The travel-time service is not available right now.',
    'error.unavailable.fix': 'Try again in a minute.',
    'error.unreachable': 'Could not reach the travel-time service.',
    'error.unreachable.fix': 'Check your connection and try again.',
    'error.walk_unavailable': 'The walking area could not be calculated right now.',
    'error.walk_unavailable.fix': 'Turn on at least one transport type, or try again in a minute.',
    'error.unknown': 'An unexpected error occurred.',
    'error.unknown.fix': 'Reload the page and try again.',
    'share.button': 'Share link',
    'share.copied': 'Link copied',
    'share.failed': 'The link could not be copied.',
    'share.failed.fix': 'Copy the address from the browser address bar instead.',
    'a11y.summaryHeading': 'Summary of the map',
    'a11y.bandsSummary': 'Within {min} min: {count} stations',
    'departures.title': 'Next departures',
    'departures.none': 'No departures in the next hour from this stop.',
    'departures.towards': 'Towards {dest}',
    'docs.intro': 'Team tomfor makes plain-language EN/SV wording, friendly error messages and address search for the group app. This page is our docs and test page, not a map: the group map is /colony/mareri.',
    'docs.modules': 'Modules',
    'docs.mod.strings': 'strings.js: t(lang, key, vars) with identical English and Swedish tables, transport mode names and the 5-minute band legend.',
    'docs.mod.errors': 'errors.js: errorMessage(lang, err) turns marlin errors, network failures, timeouts and geolocation errors into one clear sentence plus a fix.',
    'docs.mod.search': 'search.js: address search (OpenStreetMap Nominatim, Stockholm area, max 1 request per second, debounced) and locate() for the device position.',
    'docs.mod.adapter': 'mareri-adapter.js: one classic script for the integrator. Merges our wording into window.I18N, keeps aria-labels in the current language and exposes window.TomforMareri.errorText(lang, err).',
    'docs.load': 'Loading tomfor in the group app',
    'docs.loadAdapter': 'Option 1, one script tag (between i18n.js and app.js):',
    'docs.loadEsm': 'Option 2, ES module imports:',
    'docs.contract': 'Full contract: projects/tomfor/CONTRACT.md and MARERI-INTEGRATION.md in the repo.',
    'docs.demo': 'Live demo',
    'docs.acceptance': 'Acceptance test of the group app',
    'docs.acceptance.summary': 'Real Chromium against /colony/mareri, phone 390 px touch and desktop 1280x800, 22 Oct 10:57. No FAIL: every functional requirement works; PARTIAL only on error visibility, the desktop legend and touch target sizes.',
    'docs.acceptance.where': 'Full table, evidence and screenshots: projects/tomfor/tests/results-acceptance.md in the repo.',
    'docs.col.req': 'Requirement',
    'docs.col.phone': 'Phone',
    'docs.col.desktop': 'Desktop',
  },
  sv: {
    'app.title': 'Restidskarta för Stockholm',
    'app.language': 'Språk',
    'map.hint': 'Tryck på kartan för att placera nålen',
    'pin.set': 'Startpunkt: {lat}, {lon}',
    'pin.none': 'Ingen startpunkt vald',
    'pin.move': 'Flytta nålen',
    'settings.title': 'Inställningar',
    'settings.startTime': 'Starttid',
    'settings.now': 'Nu',
    'settings.maxTravel': 'Maximal restid',
    'settings.maxWait': 'Maximal väntetid',
    'settings.walkEnd': 'Gång från sista hållplatsen till målet',
    'settings.walkTransfer': 'Gång mellan stationer',
    'settings.modes': 'Trafikslag',
    'settings.maxTransfers': 'Maximalt antal byten',
    'settings.minutes': '{n} min',
    'settings.update': 'Uppdatera',
    'settings.updating': 'Beräknar…',
    'mode.bus': 'Buss',
    'mode.metro': 'Tunnelbana',
    'mode.tram': 'Spårvagn',
    'mode.train': 'Tåg',
    'mode.commuter_rail': 'Pendeltåg',
    'mode.boat': 'Båt',
    'mode.walk': 'Gång',
    'legend.title': 'Restid från nålen',
    'legend.band': '{from}–{to} min',
    'legend.bandOpen': 'Över {from} min',
    'legend.walkOnly': 'Endast gång, längs gator',
    'legend.walkOnly.note': 'Gångtid från nålen längs gatorna, utan kollektivtrafik.',
    'result.summary': '{stops} hållplatser och stationer nås inom {max} min',
    'result.computed': 'Beräknat på {ms} ms',
    'result.walkOnly': 'Alla trafikslag är avstängda, så kartan visar bara hur långt du hinner gå på {max} min.',
    'warning.fixture': 'Visar testdata, inte den riktiga tidtabellen.',
    'search.placeholder': 'Sök adress i Stockholm',
    'search.button': 'Sök',
    'search.locate': 'Använd min position',
    'search.locating': 'Hämtar din position…',
    'search.searching': 'Söker…',
    'search.noResults': 'Hittade inga platser för ”{q}”.',
    'search.results': 'Sökresultat',
    'error.title': 'Något gick fel',
    'error.heading': 'Felmeddelanden',
    'error.dismiss': 'Stäng',
    'error.retry': 'Försök igen',
    'error.no_routes': 'Inga resvägar hittades från den här platsen.',
    'error.no_routes.fix': 'Flytta nålen närmare en hållplats eller station, eller välj en annan starttid.',
    'error.no_stops': 'Ingen hållplats eller station inom gångavstånd.',
    'error.no_stops.fix': 'Tillåt mer gång, fler trafikslag eller fler byten, eller flytta nålen närmare en hållplats.',
    'error.too_restrictive': 'Inställningarna är för snäva.',
    'error.too_restrictive.fix': 'Tillåt fler byten, längre väntetid, mer gång eller fler trafikslag och försök igen.',
    'error.api': 'Restidstjänsten kunde inte göra beräkningen.',
    'error.api.fix': 'Försök igen om en stund.',
    'error.bad_request': 'Vissa inställningar är ogiltiga.',
    'error.bad_request.fix': 'Kontrollera värdena och försök igen.',
    'error.network_not_loaded': 'Tidtabellsdatan laddas fortfarande.',
    'error.network_not_loaded.fix': 'Vänta några sekunder och tryck på Uppdatera igen.',
    'error.offline': 'Du är offline.',
    'error.offline.fix': 'Kontrollera din internetanslutning och försök igen.',
    'error.timeout': 'Förfrågan tog för lång tid.',
    'error.timeout.fix': 'Prova en kortare restid eller försök igen.',
    'error.geo_denied': 'Åtkomst till din position nekades.',
    'error.geo_denied.fix': 'Tillåt platsåtkomst i webbläsaren, eller sök efter en adress i stället.',
    'error.geo_unavailable': 'Din position kunde inte fastställas.',
    'error.geo_unavailable.fix': 'Sök efter en adress eller placera nålen på kartan i stället.',
    'error.search_failed': 'Adresssökningen misslyckades.',
    'error.search_failed.fix': 'Försök igen om en stund, eller placera nålen på kartan.',
    'error.unavailable': 'Restidsberäkningen är inte tillgänglig just nu.',
    'error.unavailable.fix': 'Försök igen om en minut.',
    'error.unreachable': 'Kunde inte nå restidstjänsten.',
    'error.unreachable.fix': 'Kontrollera anslutningen och försök igen.',
    'error.walk_unavailable': 'Gångområdet kunde inte beräknas just nu.',
    'error.walk_unavailable.fix': 'Slå på minst ett trafikslag, eller försök igen om en minut.',
    'error.unknown': 'Ett oväntat fel inträffade.',
    'error.unknown.fix': 'Ladda om sidan och försök igen.',
    'share.button': 'Dela länk',
    'share.copied': 'Länken kopierad',
    'share.failed': 'Länken kunde inte kopieras.',
    'share.failed.fix': 'Kopiera adressen från webbläsarens adressfält i stället.',
    'a11y.summaryHeading': 'Sammanfattning av kartan',
    'a11y.bandsSummary': 'Inom {min} min: {count} stationer',
    'departures.title': 'Nästa avgångar',
    'departures.none': 'Inga avgångar inom den närmaste timmen från den här hållplatsen.',
    'departures.towards': 'Mot {dest}',
    'docs.intro': 'Team tomfor gör begriplig text på engelska och svenska, tydliga felmeddelanden och adressökning till gruppens app. Den här sidan är vår dokumentation och testsida, inte en karta: gruppens karta är /colony/mareri.',
    'docs.modules': 'Moduler',
    'docs.mod.strings': 'strings.js: t(lang, key, vars) med identiska engelska och svenska tabeller, namn på trafikslag och teckenförklaringen i 5-minutersband.',
    'docs.mod.errors': 'errors.js: errorMessage(lang, err) gör om fel från marlin, nätverksfel, tidsgränser och platsfel till en tydlig mening och ett förslag på vad man kan göra.',
    'docs.mod.search': 'search.js: adressökning (OpenStreetMap Nominatim, Stockholmsområdet, högst 1 anrop per sekund, med fördröjning) och locate() för enhetens position.',
    'docs.mod.adapter': 'mareri-adapter.js: ett vanligt skript för integratören. Lägger in vår text i window.I18N, håller aria-etiketter på rätt språk och ger window.TomforMareri.errorText(lang, err).',
    'docs.load': 'Så laddar gruppens app tomfor',
    'docs.loadAdapter': 'Alternativ 1, en script-tagg (mellan i18n.js och app.js):',
    'docs.loadEsm': 'Alternativ 2, ES-moduler:',
    'docs.contract': 'Hela kontraktet: projects/tomfor/CONTRACT.md och MARERI-INTEGRATION.md i repot.',
    'docs.demo': 'Prova live',
    'docs.acceptance': 'Acceptanstest av gruppens app',
    'docs.acceptance.summary': 'Riktig Chromium mot /colony/mareri, mobil 390 px med touch och dator 1280x800, 22 okt 10:57. Inget FAIL: alla funktionskrav fungerar; PARTIAL bara för synliga felmeddelanden, teckenförklaringen på dator och storlek på tryckytor.',
    'docs.acceptance.where': 'Hela tabellen, bevis och skärmbilder: projects/tomfor/tests/results-acceptance.md i repot.',
    'docs.col.req': 'Krav',
    'docs.col.phone': 'Mobil',
    'docs.col.desktop': 'Dator',
  },
};

export const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];

export function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase().slice(0, 2);
  return strings[l] ? l : DEFAULT_LANG;
}

// Strict match: 'sv', 'SV', 'sv-SE' -> 'sv'; unknown -> null (so detectLang can try the next source).
function matchLang(x) {
  const l = String(x || '').toLowerCase().slice(0, 2);
  return strings[l] ? l : null;
}

// Order: URL ?lang= (shareable links), saved choice (localStorage 'lang'), navigator.language, then en.
// `search` overrides location.search (handy in tests/node). Safe without window/location/localStorage.
export function detectLang(search) {
  try {
    const q = search ?? (typeof location !== 'undefined' ? location.search : '');
    const fromUrl = matchLang(new URLSearchParams(q || '').get('lang'));
    if (fromUrl) return fromUrl;
  } catch {}
  try {
    const saved = matchLang(localStorage.getItem('lang'));
    if (saved) return saved;
  } catch {}
  return normalizeLang(typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANG);
}

// t('sv', 'legend.band', {from: 0, to: 5}) -> "0–5 min". Missing key falls back to en, then the key.
export function t(lang, key, vars = {}) {
  const table = strings[normalizeLang(lang)];
  const s = table[key] ?? strings.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Default band colours (cool to warm by distance, nearest first).
export const BAND_COLORS = [
  '#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61',
  '#f46d43', '#d73027', '#a50026', '#762a83', '#542788', '#2d004b',
];

// Legend entries for 5-minute bands up to maxTravelMinutes: [{from,to,color,label}]
export function bandLegend(lang, maxTravelMinutes = 30, bandMinutes = 5) {
  const out = [];
  for (let from = 0, i = 0; from < maxTravelMinutes; from += bandMinutes, i++) {
    const to = from + bandMinutes;
    out.push({ from, to, color: BAND_COLORS[i % BAND_COLORS.length], label: t(lang, 'legend.band', { from, to }) });
  }
  return out;
}
