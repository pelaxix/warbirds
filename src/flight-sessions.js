// Persistent, conservative flight-session inference from ADS-B observations.
// "Unknown" observations and missing signals do not prove a landing.
// The only two ways to start another flight are confirmed ground reports
// followed by airborne evidence, or a long gap without airborne evidence.

export const DEFAULT_FLIGHT_RULES = Object.freeze({
  maxFlightSilenceMs: 90 * 60 * 1000,
  reacquiredAfterMs: 5 * 60 * 1000,
  groundConfirmationMs: 2 * 60 * 1000,
  groundConfirmationReports: 3,
  groundReportMaxGapMs: 5 * 60 * 1000,
});

function timeOf(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

export function seedFlightSession(legacyRecord, maxFlightSilenceMs = DEFAULT_FLIGHT_RULES.maxFlightSilenceMs, now = Date.now()) {
  const lastSeen = timeOf(legacyRecord?.lastSeenAt);
  if (lastSeen === null || lastSeen > now || now - lastSeen > maxFlightSilenceMs) return null;

  // On upgrade, don't announce a new flight for an aircraft already seen airborne.
  return {
    inFlight: Boolean(legacyRecord.airborne),
    flightStartedAt: legacyRecord.airborne ? (legacyRecord.firstSeenAt || legacyRecord.lastSeenAt) : null,
    lastAirborneAt: legacyRecord.airborne ? legacyRecord.lastSeenAt : null,
    lastSignalAt: legacyRecord.lastSeenAt,
    groundSinceAt: null,
    lastGroundAt: null,
    groundReports: 0,
  };
}

/**
 * @param {object|null} previous - Saved per-registration flight state.
 * @param {{ at:string, airborne:boolean, grounded:boolean }} observation - Fresh ADS-B sample.
 * @param {object} rules - Explicit thresholds, so the logic can be tested.
 * @returns {{session:object, events:string[]}} Event types: takeoff, landed, detected, reacquired.
 */
export function advanceFlightSession(previous, observation, rules = DEFAULT_FLIGHT_RULES) {
  const atMs = timeOf(observation?.at);
  if (atMs === null) return { session: previous || null, events: [] };

  const previousMs = timeOf(previous?.lastSignalAt);
  if (previousMs !== null && atMs <= previousMs) {
    // Same/stale report returned by the provider: never count it twice.
    return { session: previous, events: [] };
  }

  const silenceMs = previousMs === null ? 0 : atMs - previousMs;
  const previousAirborneMs = timeOf(previous?.lastAirborneAt);
  const flightExpired = Boolean(previous?.inFlight)
    && (previousAirborneMs === null || atMs - previousAirborneMs > rules.maxFlightSilenceMs);
  const reacquired = previousMs !== null && silenceMs >= rules.reacquiredAfterMs;

  const next = {
    inFlight: Boolean(previous?.inFlight),
    flightStartedAt: previous?.flightStartedAt || null,
    lastAirborneAt: previous?.lastAirborneAt || null,
    lastSignalAt: observation.at,
    groundSinceAt: previous?.groundSinceAt || null,
    lastGroundAt: previous?.lastGroundAt || null,
    groundReports: previous?.groundReports || 0,
  };
  const events = [];

  if (observation.airborne) {
    if (!next.inFlight || flightExpired) {
      events.push("takeoff");
      next.inFlight = true;
      next.flightStartedAt = observation.at;
    } else if (reacquired) {
      events.push("reacquired");
    }
    next.lastAirborneAt = observation.at;
    next.groundSinceAt = null;
    next.lastGroundAt = null;
    next.groundReports = 0;
    return { session: next, events };
  }

  if (observation.grounded) {
    if (next.inFlight && !flightExpired) {
      const priorGroundMs = timeOf(next.lastGroundAt);
      if (priorGroundMs === null || atMs - priorGroundMs > rules.groundReportMaxGapMs) {
        next.groundSinceAt = observation.at;
        next.groundReports = 1;
      } else {
        next.groundReports += 1;
      }
      next.lastGroundAt = observation.at;

      const sinceGroundMs = timeOf(next.groundSinceAt);
      if (next.groundReports >= rules.groundConfirmationReports
        && sinceGroundMs !== null
        && atMs - sinceGroundMs >= rules.groundConfirmationMs) {
        next.inFlight = false;
        next.flightStartedAt = null;
        next.groundSinceAt = null;
        next.lastGroundAt = null;
        next.groundReports = 0;
        events.push("landed");
      }
    } else {
      if (previousMs === null) events.push("detected");
      next.inFlight = false;
      next.flightStartedAt = null;
      next.groundSinceAt = null;
      next.lastGroundAt = null;
      next.groundReports = 0;
    }
    return { session: next, events };
  }

  // Insufficient speed or missing altitude is unknown, NOT a landing.
  next.groundSinceAt = null;
  next.lastGroundAt = null;
  next.groundReports = 0;
  if (previousMs === null) events.push("detected");
  else if (next.inFlight && !flightExpired && reacquired) events.push("reacquired");
  return { session: next, events };
}
