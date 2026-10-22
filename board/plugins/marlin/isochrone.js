'use strict';

/**
 * The isochrone engine.
 *
 * Round-based connection scan: round k holds the earliest arrival at every stop
 * using at most k transit legs, so the user's "maximum number of connections"
 * is the loop bound rather than a filter applied afterwards. Within a round the
 * scan walks one globally sorted connection array once, from the first
 * departure at or after the start time until the travel budget runs out.
 *
 * Winner 7c1e-delta: RAPTOR rounds (timeline alpha) wrapped around a sorted
 * connection scan (timeline beta). See .claude/flux/winners/7c1e-delta.md.
 */

const INF = 0x7fffffff;
const EARTH_RADIUS = 6371000;
const DEG = Math.PI / 180;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Index of the first connection departing at or after `time`. */
function lowerBound(dep, time, length) {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dep[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Stops within walking range of the pin. A cheap bounding-box test rejects
 * almost everything before the trigonometry runs.
 */
function accessStops(net, origin, radiusMetres) {
  const out = [];
  const dLat = radiusMetres / 111320;
  const dLon = radiusMetres / (111320 * Math.max(0.05, Math.cos(origin.lat * DEG)));
  const minLat = origin.lat - dLat;
  const maxLat = origin.lat + dLat;
  const minLon = origin.lon - dLon;
  const maxLon = origin.lon + dLon;

  const stops = net.stops;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon) continue;
    const d = haversine(origin.lat, origin.lon, s.lat, s.lon);
    if (d <= radiusMetres) out.push([i, d]);
  }
  return out;
}

/**
 * @returns {{arrival: Int32Array, reached: number, originStops: number, rounds: number}}
 *   arrival[stopIndex] = earliest arrival in seconds, or INF where unreachable.
 */
function search(net, opts) {
  const {
    origin, startSec, maxTravelSeconds, maxWaitSeconds, maxTransfers,
    allowedModes, walkSpeedMs, accessSeconds, transferSeconds,
  } = opts;

  const stopCount = net.stops.length;
  const cutoff = startSec + maxTravelSeconds;

  const best = new Int32Array(stopCount).fill(INF);
  const prev = new Int32Array(stopCount).fill(INF);

  // Round 0: walk from the pin.
  let originStops = 0;
  for (const [i, metres] of accessStops(net, origin, accessSeconds * walkSpeedMs)) {
    const t = startSec + Math.round(metres / walkSpeedMs);
    if (t > cutoff) continue;
    best[i] = t;
    prev[i] = t;
    originStops++;
  }

  if (originStops === 0) return { arrival: best, reached: 0, originStops: 0, rounds: 0 };

  // Mode filter as a flat lookup over the network's own mode ids: one array
  // read in the inner loop instead of a Set lookup on a string.
  const modeAllowed = new Uint8Array(net.modeNames.length);
  for (let i = 0; i < net.modeNames.length; i++) {
    modeAllowed[i] = allowedModes.indexOf(net.modeNames[i]) >= 0 ? 1 : 0;
  }

  const { from, to, dep, arr, trip, mode, connectionCount } = net;
  const { transferOffset, transferTo, transferSec } = net;
  const startIndex = lowerBound(dep, startSec, connectionCount);
  const maxLegs = maxTransfers + 1;

  let rounds = 0;
  const boarded = new Uint8Array(net.tripCount);

  for (let leg = 1; leg <= maxLegs; leg++) {
    const cur = prev.slice();
    boarded.fill(0);
    let improved = false;
    rounds++;

    for (let c = startIndex; c < connectionCount; c++) {
      if (dep[c] > cutoff) break;
      if (!modeAllowed[mode[c]]) continue;

      const t = trip[c];
      if (!boarded[t]) {
        const ready = prev[from[c]];
        if (ready === INF || ready > dep[c]) continue;
        // "Maximum waiting time between connections" is about transfers. The
        // first boarding after walking from the pin is deliberately not
        // limited: otherwise a pin beside a half-hourly line looks unreachable.
        if (leg > 1 && dep[c] - ready > maxWaitSeconds) continue;
        boarded[t] = 1;
      }

      const a = arr[c];
      if (a <= cutoff && a < cur[to[c]]) {
        cur[to[c]] = a;
        improved = true;
      }
    }

    if (!improved) break;

    // Walking transfers. This has to run after the final round too: a stop you
    // can only walk to from a last-round arrival is genuinely reachable inside
    // the budget, and gating this on `leg < maxLegs` quietly lost those stops.
    // Transfers can also chain (walk A->B->C), so relax until nothing moves.
    if (transferSeconds > 0) {
      for (let pass = 0; pass < 3; pass++) {
        let walked = false;
        for (let s = 0; s < stopCount; s++) {
          const t = cur[s];
          if (t === INF) continue;
          const end = transferOffset[s + 1];
          for (let k = transferOffset[s]; k < end; k++) {
            if (transferSec[k] > transferSeconds) continue;
            const t2 = t + transferSec[k];
            if (t2 <= cutoff && t2 < cur[transferTo[k]]) {
              cur[transferTo[k]] = t2;
              walked = true;
            }
          }
        }
        if (!walked) break;
      }
    }

    for (let i = 0; i < stopCount; i++) {
      if (cur[i] < best[i]) best[i] = cur[i];
      prev[i] = cur[i];
    }
  }

  let reached = 0;
  for (let i = 0; i < stopCount; i++) if (best[i] !== INF) reached++;

  return { arrival: best, reached, originStops, rounds };
}

/** Index of the last position (descending order) whose arrival is at or before `time`. */
function arrUpperBoundDesc(order, arr, time, length) {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[order[mid]] > time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Connection indices sorted by arrival time, descending (ties by departure,
 * descending). The forward scan needs departure-ascending order; the reverse
 * scan below needs this, its time-mirror. Built once per network and cached
 * on the net object, since vijay-team's artifacts are read once at boot and
 * reused for every request.
 */
function arrOrderDesc(net) {
  if (net._arrOrderDesc) return net._arrOrderDesc;
  const { arr, dep, connectionCount } = net;
  const order = new Int32Array(connectionCount);
  for (let i = 0; i < connectionCount; i++) order[i] = i;
  const asArray = Array.from(order);
  asArray.sort((a, b) => (arr[b] - arr[a]) || (dep[b] - dep[a]));
  net._arrOrderDesc = Int32Array.from(asArray);
  return net._arrOrderDesc;
}

/**
 * Arrive-by: the dual of `search`. Instead of "earliest arrival at every stop
 * leaving no earlier than startSec", this finds "latest time you can still be
 * at every stop and reach the destination (the pin) by deadlineSec" - the
 * question vijay-team's ideas doc called out ("Arrive-by needs marlin").
 *
 * It is the same round-based connection scan, time-reversed:
 *   - round 0 walks from the destination's egress radius backward (how late
 *     can you leave a nearby stop and still walk in by the deadline);
 *   - connections are scanned in descending arrival order instead of
 *     ascending departure order, and a connection is usable once its arrival
 *     is early enough to still make a feasible later leg (mirroring forward's
 *     "boarded" check, but for alighting);
 *   - walking transfers relax backward: being at `v` by `cur[v]` means you
 *     could have left `s` as late as `cur[v] - walkSeconds(s, v)`.
 *
 * @returns {{arrival: Int32Array, reached: number, originStops: number, rounds: number}}
 *   arrival[stopIndex] = latest time you can be at that stop, seconds after
 *   midnight, or INF where no such time exists inside the budget. (Named
 *   `arrival` like `search`'s result so callers - the cache, bands.build via
 *   the travel-time transform in index.js - don't need a second code path.)
 */
function searchReverse(net, opts) {
  const {
    origin, deadlineSec, maxTravelSeconds, maxWaitSeconds, maxTransfers,
    allowedModes, walkSpeedMs, egressSeconds, transferSeconds,
  } = opts;

  const NEG = -1; // seconds-after-midnight is always >= 0, so -1 means "no known time"
  const stopCount = net.stops.length;
  const cutoff = deadlineSec - maxTravelSeconds;

  const best = new Int32Array(stopCount).fill(NEG);
  const prev = new Int32Array(stopCount).fill(NEG);

  // Round 0: walk in to the pin from nearby stops (egress, not access).
  let originStops = 0;
  for (const [i, metres] of accessStops(net, origin, egressSeconds * walkSpeedMs)) {
    const walkSec = Math.round(metres / walkSpeedMs);
    const latest = deadlineSec - walkSec;
    if (deadlineSec - latest > maxTravelSeconds) continue;
    best[i] = latest;
    prev[i] = latest;
    originStops++;
  }

  if (originStops === 0) return { arrival: best, reached: 0, originStops: 0, rounds: 0 };

  const modeAllowed = new Uint8Array(net.modeNames.length);
  for (let i = 0; i < net.modeNames.length; i++) {
    modeAllowed[i] = allowedModes.indexOf(net.modeNames[i]) >= 0 ? 1 : 0;
  }

  const { from, to, dep, arr, trip, mode, connectionCount } = net;
  const { transferOffset, transferTo, transferSec } = net;
  const order = arrOrderDesc(net);
  const startPos = arrUpperBoundDesc(order, arr, deadlineSec, connectionCount);
  const maxLegs = maxTransfers + 1;

  let rounds = 0;
  const detrained = new Uint8Array(net.tripCount);

  for (let leg = 1; leg <= maxLegs; leg++) {
    const cur = prev.slice();
    detrained.fill(0);
    let improved = false;
    rounds++;

    for (let idx = startPos; idx < connectionCount; idx++) {
      const c = order[idx];
      if (arr[c] < cutoff) break;
      if (!modeAllowed[mode[c]]) continue;

      const t = trip[c];
      if (!detrained[t]) {
        const ready = prev[to[c]];
        if (ready === NEG || ready < arr[c]) continue;
        // Mirrors forward's "the leg nearest the pin is not wait-limited":
        // here that is the leg furthest from the pin, i.e. the first one
        // boarded walking backward from the deadline.
        if (leg > 1 && ready - arr[c] > maxWaitSeconds) continue;
        detrained[t] = 1;
      }

      const d = dep[c];
      if (d >= cutoff && d > cur[from[c]]) {
        cur[from[c]] = d;
        improved = true;
      }
    }

    if (!improved) break;

    if (transferSeconds > 0) {
      for (let pass = 0; pass < 3; pass++) {
        let walked = false;
        for (let s = 0; s < stopCount; s++) {
          const end = transferOffset[s + 1];
          for (let k = transferOffset[s]; k < end; k++) {
            if (transferSec[k] > transferSeconds) continue;
            const v = transferTo[k];
            if (cur[v] === NEG) continue;
            const candidate = cur[v] - transferSec[k];
            if (candidate >= cutoff && candidate > cur[s]) {
              cur[s] = candidate;
              walked = true;
            }
          }
        }
        if (!walked) break;
      }
    }

    for (let i = 0; i < stopCount; i++) {
      if (cur[i] > best[i]) best[i] = cur[i];
      prev[i] = cur[i];
    }
  }

  let reached = 0;
  for (let i = 0; i < stopCount; i++) if (best[i] !== NEG) reached++;

  return { arrival: best, reached, originStops, rounds };
}

module.exports = {
  search, searchReverse, haversine, lowerBound, arrUpperBoundDesc, accessStops, INF,
};
