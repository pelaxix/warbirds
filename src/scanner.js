import { config } from "./config.js";
import { fetchByRegistrations, normalizeHex, normalizeRegistration } from "./adsb-one.js";
import { readState, withState } from "./store.js";

let scanInProgress = false;
let timer = null;

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
  const baro = Number(aircraft?.alt_baro);
  if (Number.isFinite(baro)) return baro;

  const geom = Number(aircraft?.alt_geom);
  if (Number.isFinite(geom)) return geom;

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

  if (!options.ignoreWindow && source === "scheduled" && !insideActiveWindow()) {
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

      for (const match of matches) {
        const key = normalizeRegistration(match.registration);
        const previous = current[key];
        const previousActive = isActiveRecord(previous, now);
        const firstSeenInSession = !previousActive;
        const becameAirborne = previousActive && !previous.airborne && match.airborne;

        if (firstSeenInSession) {
          activities.push(createActivity(match.airborne ? "airborne" : "detected", match));
        } else if (becameAirborne) {
          activities.push(createActivity("airborne", match));
        }

        current[key] = {
          ...match,
          firstSeenAt: firstSeenInSession ? iso(now) : previous.firstSeenAt,
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
        history: trimHistory([...(state.history || []), scan], now),
      };
    });

    for (const activity of activities.filter((item) => item.type === "airborne")) {
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

export async function getHistory() {
  const state = await readState();
  const now = Date.now();

  return {
    ok: true,
    checkedAt: state.checkedAt,
    lastError: state.lastError,
    windowHours: Math.round(config.historyWindowMs / 60 / 60 / 1000),
    scans: trimHistory(state.history || [], now),
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
