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
    'legend.title': 'Travel time from the pin',
    'legend.band': '{from}–{to} min',
    'legend.bandOpen': 'Over {from} min',
    'result.summary': '{stops} stops and stations reached within {max} min',
    'result.computed': 'Calculated in {ms} ms',
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
    'error.unknown': 'An unexpected error occurred.',
    'error.unknown.fix': 'Reload the page and try again.',
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
    'legend.title': 'Restid från nålen',
    'legend.band': '{from}–{to} min',
    'legend.bandOpen': 'Över {from} min',
    'result.summary': '{stops} hållplatser och stationer nås inom {max} min',
    'result.computed': 'Beräknat på {ms} ms',
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
    'error.unknown': 'Ett oväntat fel inträffade.',
    'error.unknown.fix': 'Ladda om sidan och försök igen.',
  },
};

export const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];

export function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase().slice(0, 2);
  return strings[l] ? l : DEFAULT_LANG;
}

export function detectLang() {
  try {
    const saved = localStorage.getItem('lang');
    if (saved) return normalizeLang(saved);
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
