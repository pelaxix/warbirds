import { config } from "./config.js";
import { fetchByRegistrations, normalizeHex, normalizeRegistration } from "./adsb-one.js";
import { readState, withState } from "./store.js";
import { advanceFlightSession, DEFAULT_FLIGHT_RULES, seedFlightSession } from "./flight-sessions.js";

let scanInProgress = false;
let timer = null;

// Ignore stale provider reports when deciding flight transitions.
const MAX_OBSERVATION_AGE_MS = 3 * 60 * 1000;

function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function epochMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Date.now();
  return number < 10_000_000_000 ? number * 1000 : number;
}

function seenSeconds(aircraft) {
  const seen = Number(aircraft?.seen);
  if (Number.isFinite(seen)) return seen;

  const seenPos = Number(aircraft?.seen_pos);
  if (Number.isFinite(seenPos)) return seenPos;

  return 0;
}

function isGroundAltitude(value) {
  return String(value || "").trim().toLowerCase() === "ground";
}

function numericAltitude(aircraft) {
  // Number(null) is zero; a missing altitude is not a valid flight altitude.
  const baroValue = aircraft?.alt_baro;
  if (baroValue !== null && baroValue !== undefined && String(baroValue).trim() !== "") {
    const baro = Number(baroValue);
    if (Number.isFinite(baro)) return baro;
  }

  const geomValue = aircraft?.alt_geom;
  if (geomValue !== null && geomValue !== undefined && String(geomValue).trim() !== "") {
    const geom = Number(geomValue);
    if (Number.isFinite(geom)) return geom;
  }

  return null;
}

function getAltitudeText(aircraft) {
  if (isGroundAltitude(aircraft?.alt_baro)) return "Ground";

  const altitude = numericAltitude(aircraft);
  return altitude === null ? "Unknown" : `${Math.round(altitude).toLocaleString()} ft`;
}

function getSpeedText(aircraft) {
  const speed = Number(aircraft?.gs);
  return Number.isFinite(speed) ? `${Math.round(speed)} kt` : "Unknown";
}

function isAirborne(aircraft) {
  if (isGroundAltitude(aircraft?.alt_baro)) return false;

  const speed = Number(aircraft?.gs);
  const altitude = numericAltitude(aircraft);

  return Number.isFinite(speed) && speed >= config.airborneMinSpeedKt && altitude !== null;
}

function isActiveRecord(record, now = Date.now()) {
  if (!record?.lastSeenAt) return false;

  const lastSeen = Date.parse(record.lastSeenAt);
  return Number.isFinite(lastSeen) && now - lastSeen <= config.resetAfterMs;
}

function hasFreshSignal(match, now) {
  const seenAt = Date.parse(match.lastSeenAt);
  return Number.isFinite(seenAt)
    && seenAt <= now + 30 * 1000
    && now - seenAt <= MAX_OBSERVATION_AGE_MS;
}

function currentHamiltonHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.activeTimezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isFinite(hour) ? hour : date.getHours();
}

function insideActiveWindow(date = new Date()) {
  const hour = currentHamiltonHour(date);
  return hour >= config.activeStartHour && hour < config.activeEndHourExclusive;
}

function routeUrl(hex) {
  return hex ? `https://globe.adsb.fi/?icao=${encodeURIComponent(hex)}` : null;
}

function createLiveMatch(watched, aircraft, providerNow) {
  const lastSeenMs = providerNow - seenSeconds(aircraft) * 1000;
  const hex = normalizeHex(aircraft.hex);

  return {
    registration: watched.registration,
    label: watched.label,
    name: watched.name,
    hex,
    callsign: String(aircraft.flight || aircraft.callsign || "").trim(),
    airborne: isAirborne(aircraft),
    altitude: getAltitudeText(aircraft),
    speed: getSpeedText(aircraft),
    lastSeenAt: iso(lastSeenMs),
    latitude: Number.isFinite(Number(aircraft.lat)) ? Number(aircraft.lat) : null,
    longitude: Number.isFinite(Number(aircraft.lon)) ? Number(aircraft.lon) : null,
    track: Number.isFinite(Number(aircraft.track)) ? Number(aircraft.track) : null,
    routeUrl: routeUrl(hex),
  };
}

function findMatches(providerData) {
  const watchedByReg = new Map(
    config.watchedAircraft.map((item) => [normalizeRegistration(item.registration), item]),
  );

  const matches = [];

  for (const aircraft of providerData.aircraft) {
    const reg = normalizeRegistration(aircraft.r || aircraft.reg || aircraft.registration);
    const watched = watchedByReg.get(reg);

    if (!watched) continue;

    matches.push(createLiveMatch(watched, aircraft, epochMs(providerData.now)));
  }

  return matches;
}

function createActivity(type, match) {
  return {
    type,
    at: iso(),
    registration: match.registration,
    label: match.label,
    name: match.name,
    hex: match.hex,
    callsign: match.callsign,
    routeUrl: match.routeUrl,
  };
}

async function sendDiscordAlert(activity, match) {
  if (!config.discordWebhookUrl) return false;

  const title = `${activity.label} is airborne`;
  const description = [
    `${activity.registration} · ${activity.name}`,
    match.altitude ? `Altitude: ${match.altitude}` : null,
    match.speed ? `Speed: ${match.speed}` : null,
    match.callsign ? `Callsign: ${match.callsign}` : null,
    match.routeUrl ? `[Follow live route](${match.routeUrl})` : null,
  ].filter(Boolean).join("\n");

  const response = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `Warbird alert: ${activity.label} is airborne.`,
      embeds: [
        {
          title,
          description,
          url: match.routeUrl || config.publicBaseUrl,
          color: 0xff8a3d,
          timestamp: activity.at,
          footer: { text: "Hamilton Warbird Watch" },
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord returned ${response.status}: ${body.slice(0, 200)}`);
  }

  return true;
}

function trimHistory(history, now = Date.now()) {
  const recent = history.filter((entry) => {
    const timestamp = Date.parse(entry.at);
    return Number.isFinite(timestamp) && now - timestamp <= config.historyWindowMs;
  });

  return recent.slice(-config.historyMaxEntries);
}

export async function runScan(source = "scheduled", options = {}) {
  if (scanInProgress) {
    return { ok: true, skipped: true, reason: "scan already in progress" };
  }

  if (config.activeHoursOnly && !options.ignoreWindow && source === "scheduled" && !insideActiveWindow()) {
    return { ok: true, skipped: true, reason: "outside active hours" };
  }

  scanInProgress = true;

  try {
    const registrations = config.watchedAircraft.map((item) => item.registration);
    const providerData = await fetchByRegistrations(registrations);
    const matches = findMatches(providerData);
    const activities = [];
    const alertsSent = [];

    const result = await withState(async (state) => {
      const now = Date.now();
      const current = { ...state.current };
      const flightSessions = { ...(state.flightSessions || {}) };
      const rules = { ...DEFAULT_FLIGHT_RULES, maxFlightSilenceMs: config.flightSilenceMs };

      for (const match of matches) {
        const key = normalizeRegistration(match.registration);
        const previous = current[key];
        const previousActive = isActiveRecord(previous, now);

        if (hasFreshSignal(match, now)) {
          // Upgrade existing state without turning an ongoing flight into a new alert.
          const session = flightSessions[key]
            || seedFlightSession(previous, rules.maxFlightSilenceMs, now);
          const result = advanceFlightSession(session, {
            at: match.lastSeenAt,
            airborne: match.airborne,
            grounded: match.altitude === "Ground",
          }, rules);
          if (result.session) flightSessions[key] = result.session;
          for (const type of result.events) {
            activities.push(createActivity(type, match));
          }
        }

        current[key] = {
          ...match,
          firstSeenAt: !previousActive ? iso(now) : previous.firstSeenAt,
          lastSeenAt: match.lastSeenAt,
          updatedAt: iso(now),
        };
      }

      const scan = {
        at: iso(now),
        source,
        provider: providerData.provider,
        aircraft: matches,
        activities,
        alertsSent,
      };

      return {
        ...state,
        checkedAt: scan.at,
        lastError: null,
        current,
        flightSessions,
        history: trimHistory([...(state.history || []), scan], now),
      };
    });

    for (const activity of activities.filter((item) => item.type === "takeoff")) {
      const match = matches.find((item) => item.registration === activity.registration);
      try {
        if (await sendDiscordAlert(activity, match)) {
          alertsSent.push(activity.registration);
        }
      } catch (error) {
        console.error("Discord alert failed", error);
      }
    }

    if (alertsSent.length) {
      await withState(async (state) => {
        const latest = state.history[state.history.length - 1];
        if (latest?.at === result.checkedAt) {
          latest.alertsSent = alertsSent;
        }
        return state;
      });
    }

    return {
      ok: true,
      checkedAt: result.checkedAt,
      active: getActiveFromState(result),
      activities,
      alertsSent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Warbird scan failed", message);

    await withState(async (state) => {
      const now = Date.now();
      const scan = {
        at: iso(now),
        source,
        ok: false,
        error: message,
        aircraft: [],
        activities: [],
        alertsSent: [],
      };

      return {
        ...state,
        checkedAt: scan.at,
        lastError: message,
        history: trimHistory([...(state.history || []), scan], now),
      };
    });

    return { ok: false, error: message };
  } finally {
    scanInProgress = false;
  }
}

function getActiveFromState(state) {
  const now = Date.now();
  return Object.values(state.current || {})
    .filter((record) => isActiveRecord(record, now))
    .sort((first, second) => Number(Boolean(second.airborne)) - Number(Boolean(first.airborne)));
}

export async function getPublicStatus() {
  const state = await readState();

  return {
    ok: true,
    checkedAt: state.checkedAt,
    lastError: state.lastError,
    trackedAircraft: config.watchedAircraft.length,
    active: getActiveFromState(state),
  };
}

function historyActivityItems(scan) {
  const items = Array.isArray(scan.activities)
    ? scan.activities
    : Array.isArray(scan.activity)
      ? scan.activity
      : scan.event
        ? (scan.aircraft || scan.liveMatches || []).map((item) => ({ ...item, type: scan.event }))
        : [];

  return items.filter((item) => {
    const type = String(item?.type ?? item?.event ?? "").toLowerCase();
    return ["airborne", "detected", "takeoff", "landed", "reacquired"].includes(type);
  });
}

function compactHistoryScan(scan, activities) {
  const aircraft = Array.isArray(scan.aircraft)
    ? scan.aircraft
    : Array.isArray(scan.liveMatches)
      ? scan.liveMatches
      : [];

  return {
    at: scan.at,
    ...(scan.error ? { error: scan.error } : {}),
    activities: activities.map((item) => ({
      type: String(item.type ?? item.event).toLowerCase(),
      label: item.label || item.aircraft || item.registration || "Watched aircraft",
    })),
    aircraft: aircraft.map((item) => ({
      label: item.label || item.aircraft || item.registration || "Watched aircraft",
    })),
  };
}

// Without options this keeps the original API response for existing clients.
// The History page requests compact, server-filtered pages instead of a week's raw scans.
export async function getHistory(options = {}) {
  const state = await readState();
  const now = Date.now();
  const history = trimHistory(state.history || [], now);
  const common = {
    ok: true,
    checkedAt: state.checkedAt,
    lastError: state.lastError,
    windowHours: Math.round(config.historyWindowMs / 60 / 60 / 1000),
  };

  if (options.view !== "activity" && options.view !== "all") {
    return { ...common, scans: history };
  }

  const limit = Math.min(200, Math.max(1, Number.parseInt(options.limit, 10) || 80));
  const records = history.map((scan) => ({ scan, activities: historyActivityItems(scan) }));
  const totalActivities = records.reduce((sum, record) => sum + record.activities.length, 0);
  const matches = options.view === "activity"
    ? records.filter((record) => record.activities.length > 0)
    : records;
  const beforeTime = Date.parse(options.before || "");
  const eligible = Number.isFinite(beforeTime)
    ? matches.filter((record) => Date.parse(record.scan.at) < beforeTime)
    : matches;
  const newestFirst = eligible.reverse();
  const page = newestFirst.slice(0, limit);
  const scans = page.map(({ scan, activities }) => compactHistoryScan(scan, activities));
  const hasMore = newestFirst.length > page.length;

  return {
    ...common,
    scans,
    totalScans: history.length,
    totalActivities,
    matchingScans: matches.length,
    hasMore,
    nextBefore: hasMore ? scans[scans.length - 1].at : null,
  };
}

export function startScanner() {
  if (timer) return;

  timer = setInterval(() => {
    runScan("scheduled").catch((error) => {
      console.error("Scheduled scan crashed", error);
    });
  }, config.scanIntervalMs);

  setTimeout(() => {
    runScan("startup").catch((error) => {
      console.error("Startup scan crashed", error);
    });
  }, 3000);
}
