import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, ".env");

function loadEnvFile() {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name, fallback) {
  const value = (process.env[name] || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function envAny(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

export const WATCHED_AIRCRAFT = [
  { registration: "C-GVRA", name: "Avro Lancaster Mk. X", label: "Lancaster FM213" },
  { registration: "C-GRSB", name: "Douglas C-47 Dakota", label: "Dakota FZ692" },
  { registration: "CF-GTU", name: "de Havilland Tiger Moth", label: "Tiger Moth" },
  { registration: "C-GCWG", name: "Grumman Avenger", label: "Grumman Avenger" },
  { registration: "CF-GSR", name: "Noorduyn Norseman", label: "Norseman" },
  { registration: "C-GCWM", name: "North American B-25 Mitchell", label: "B-25 Mitchell" },
  { registration: "C-FPQL", name: "Consolidated Canso", label: "Canso" },
  { registration: "C-FAIU", name: "Boeing Stearman", label: "Stearman" },
  { registration: "CF-UUU", name: "North American Harvard", label: "Harvard" },
  { registration: "C-GBDG", name: "Fairey Firefly", label: "Fairey Firefly" },
];

export const config = Object.freeze({
  rootDir,
  port: intEnv("PORT", 3007),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://warbirds.pelaxix.com",
  dataDir: process.env.DATA_DIR || path.join(rootDir, "data"),
  adsbOneBaseUrl: process.env.ADSB_FI_BASE_URL || "https://opendata.adsb.fi/api",
  scanIntervalMs: intEnv("SCAN_INTERVAL_SECONDS", 60) * 1000,
  startScanner: boolEnv("START_SCANNER", true),
  activeHoursOnly: boolEnv("ACTIVE_HOURS_ONLY", false),
  discordWebhookUrl: envAny("DISCORD_WEBHOOK_URL", "DISCORD_WEBHOOK"),
  manualCheckToken: envAny("MANUAL_CHECK_TOKEN", "CHECK_TOKEN"),
  activeTimezone: process.env.ACTIVE_TIMEZONE || "America/Toronto",
  activeStartHour: intEnv("ACTIVE_START_HOUR", 0),
  activeEndHourExclusive: intEnv("ACTIVE_END_HOUR", 24),
  resetAfterMs: intEnv("RESET_AFTER_MINUTES", 30) * 60 * 1000,
  airborneMinSpeedKt: intEnv("AIRBORNE_MIN_SPEED_KT", 50),
  historyWindowMs: intEnv("HISTORY_WINDOW_HOURS", 168) * 60 * 60 * 1000,
  historyMaxEntries: intEnv("HISTORY_MAX_ENTRIES", 12000),
  watchedAircraft: WATCHED_AIRCRAFT,
});
