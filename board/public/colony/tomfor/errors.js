import { t } from './strings.js';

// Maps marlin/mareri error codes (and client-side failures) to a strings key.
const CODE_TO_KEY = {
  no_routes: 'no_routes',
  no_stops_near_origin: 'no_stops',
  nothing_reachable: 'too_restrictive',
  too_restrictive: 'too_restrictive',
  bad_request: 'bad_request',
  unknown_mode: 'bad_request',
  network_not_loaded: 'network_not_loaded',
  internal: 'api',
  offline: 'offline',
  timeout: 'timeout',
  network: 'api',
  geo_denied: 'geo_denied',
  geo_unavailable: 'geo_unavailable',
  search_failed: 'search_failed',
  unavailable: 'unavailable',
  unreachable: 'unreachable',
  walk_unavailable: 'walk_unavailable',
};

// Accepts: {error:{code}}, {error:'code'}, {code}, {status}, {name:'AbortError'|'TimeoutError'},
// TypeError (fetch failure), GeolocationPositionError (code 1/2/3). Returns {key, code, text, fix, message}.
export function classify(err) {
  if (err == null) return 'unknown';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (typeof err === 'string') return CODE_TO_KEY[err] || 'unknown';
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout';
  if (typeof err.PERMISSION_DENIED === 'number' && typeof err.code === 'number') {
    return err.code === err.PERMISSION_DENIED ? 'geo_denied' : err.code === err.TIMEOUT ? 'timeout' : 'geo_unavailable';
  }
  const code = typeof err.error === 'string' ? err.error : err.error?.code ?? (typeof err.code === 'string' ? err.code : null);
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  const status = err.status ?? err.statusCode;
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'api';
  if (status === 422) return 'too_restrictive';
  if (status >= 400) return 'bad_request';
  if (err instanceof TypeError) return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'api';
  return code ? 'api' : 'unknown';
}

export function errorMessage(lang, err) {
  const key = classify(err);
  const text = t(lang, `error.${key}`);
  const fix = t(lang, `error.${key}.fix`);
  return { key, code: key, text, fix, message: `${text} ${fix}` };
}

// fetch wrapper: rejects with {status, error, message, message_sv} on non-2xx, {name:'TimeoutError'} on timeout.
export async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, ...(typeof body === 'object' && body ? body : {}) };
    return body;
  } finally {
    clearTimeout(timer);
  }
}
