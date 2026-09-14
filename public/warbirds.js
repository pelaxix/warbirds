const api = "/api/public";
const historyApi = "/api/history";
const autoRefreshMs = 60 * 1000;

const status = document.querySelector("#fetchStatus");
const cards = document.querySelector("#liveCards");
const refreshButton = document.querySelector("#refreshButton");
const statusDot = document.querySelector("#statusDot");
const systemStatus = document.querySelector("#systemStatus");
const lastCheckedValue = document.querySelector("#lastCheckedValue");
const activeValue = document.querySelector("#activeValue");
const lastActivityValue = document.querySelector("#lastActivityValue");
const trackedValue = document.querySelector("#trackedValue");
const providerValue = document.querySelector("#providerValue");

let isLoading = false;

function setText(element, value) {
  if (element) element.textContent = value;
}

function setSystem(kind, label) {
  statusDot?.classList.remove("live", "active", "error");
  statusDot?.classList.add(kind);
  setText(systemStatus, label);
}

function since(value) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "Waiting";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;

  return `${Math.round(seconds / 86400)} days ago`;
}

function formatExactTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "No completed scan yet";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function field(label, value) {
  const container = document.createElement("div");
  const heading = document.createElement("span");
  const text = document.createElement("strong");

  heading.textContent = label;
  text.textContent = value || "—";
  container.append(heading, text);
  return container;
}

function empty(title, text, isError = false) {
  const card = document.createElement("article");
  const icon = document.createElement("span");
  const content = document.createElement("div");
  const heading = document.createElement("h3");
  const message = document.createElement("p");

  card.className = `empty-state${isError ? " error-state" : " quiet-state"}`;
  icon.className = isError ? "empty-icon" : "quiet-radar";
  icon.textContent = isError ? "!" : "";
  heading.textContent = title;
  message.textContent = text;
  content.append(heading, message);
  card.append(icon, content);
  cards.replaceChildren(card);
}

function createRouteLink(item) {
  const hex = item?.hex;
  const url = item?.routeUrl || (hex ? `https://globe.adsb.fi/?icao=${encodeURIComponent(hex)}` : "");

  if (!url) return null;

  const link = document.createElement("a");
  link.className = "live-route-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Follow this plane’s live route";
  return link;
}

function card(item) {
  const airborne = Boolean(item.airborne);
  const liveCard = document.createElement("article");
  const header = document.createElement("div");
  const title = document.createElement("h3");
  const badge = document.createElement("span");
  const meta = document.createElement("p");
  const grid = document.createElement("div");
  const routeLink = createRouteLink(item);

  liveCard.className = `live-card${airborne ? " airborne" : ""}`;
  header.className = "live-card-head";
  title.textContent = item.label || item.aircraft || "Historic aircraft";
  badge.className = `status-badge ${airborne ? "airborne" : "detected"}`;
  badge.textContent = airborne ? "Airborne" : "Detected";
  header.append(title, badge);

  meta.className = "live-card-meta";
  meta.textContent = `${item.registration || "Unknown"} • ${item.name || item.type || "Warbird watch"}`;

  grid.className = "data-grid";
  grid.append(
    field("Altitude", item.altitude),
    field("Speed", item.speed),
    field("Callsign", item.callsign || "Not broadcast"),
    field("Last signal", since(item.lastSeenAt || item.last_seen_at)),
  );

  liveCard.append(header, meta, grid);

  if (routeLink) {
    liveCard.classList.add("has-route-link");
    liveCard.append(routeLink);
  }

  return liveCard;
}

function getActive(payload) {
  return Array.isArray(payload.active)
    ? payload.active
    : Array.isArray(payload.liveMatches)
      ? payload.liveMatches
      : [];
}

function scanActivities(scan) {
  const rawActivities = Array.isArray(scan?.activity)
    ? scan.activity
    : Array.isArray(scan?.activities)
      ? scan.activities
      : [];

  return rawActivities
    .map((item) => {
      const type = String(item?.type ?? item?.event ?? "").toLowerCase();

      return {
        type,
        aircraft:
          item?.label ||
          item?.aircraft ||
          item?.registration ||
          "Watched aircraft",
        at: item?.at || scan?.at || scan?.timestamp || null,
      };
    })
    .filter((item) => item.type === "detected" || item.type === "airborne");
}

function updateLastActivity(payload) {
  const scans = Array.isArray(payload?.scans)
    ? payload.scans
    : Array.isArray(payload?.history)
      ? payload.history
      : [];

  const activities = scans
    .flatMap(scanActivities)
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at));

  const latest = activities[0];

  if (!latest) {
    setText(lastActivityValue, "None in 7 days");
    return;
  }

  const action = latest.type === "airborne" ? "airborne" : "detected";
  setText(lastActivityValue, `${latest.aircraft} ${action} · ${since(latest.at)}`);
}

function render(payload) {
  const active = getActive(payload);

  if (!active.length) {
    empty(
      "Quiet skies right now",
      "No watched aircraft were recently reported by the tracker. That is normal most days.",
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  active
    .sort((first, second) => Boolean(second.airborne) - Boolean(first.airborne))
    .forEach((item) => fragment.append(card(item)));
  cards.replaceChildren(fragment);
}

function updateSummary(data) {
  const active = getActive(data);
  const activeCount = active.length;
  const count = Number(data.trackedAircraft || data.watchedCount || 10);
  const checkedAt = data.checkedAt || data.lastCheckedAt;
  const provider = data.provider || "adsb.fi";

  setText(trackedValue, String(count));
  setText(activeValue, String(activeCount));
  setText(lastCheckedValue, since(checkedAt));
  setText(providerValue, provider);

  if (data.lastError) {
    setSystem("error", "Provider issue");
    status.textContent = `Last scan failed · ${String(data.lastError).slice(0, 120)} · retrying every min`;
    return;
  }

  if (activeCount > 0) {
    setSystem("active", `${activeCount} active`);
    status.textContent = `${activeCount} of ${count} tracked · last scan ${formatExactTime(checkedAt)} · page updates every min`;
    return;
  }

  setSystem("live", "Quiet / online");
  status.textContent = `${count} tracked · last scan ${formatExactTime(checkedAt)} · page updates every min`;
}

async function loadHistorySnapshot() {
  try {
    const response = await window.fetch(historyApi, { cache: "no-store" });
    if (!response.ok) throw new Error(`History returned ${response.status}`);

    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Invalid history response");

    updateLastActivity(data);
  } catch (error) {
    console.warn("Warbird Watch history snapshot failed", error);
    setText(lastActivityValue, "Unavailable");
  }
}

async function load() {
  if (isLoading) return;

  isLoading = true;
  refreshButton?.setAttribute("disabled", "");
  status.textContent = "Reading the most recent scan…";

  try {
    const response = await window.fetch(api, { cache: "no-store" });

    if (!response.ok) throw new Error(`Live status returned ${response.status}`);

    const data = await response.json();

    if (!data.ok) throw new Error(data.error || "Invalid live status");

    render(data);
    updateSummary(data);
    loadHistorySnapshot();
  } catch (error) {
    console.error("Warbird Watch live status failed", error);
    setSystem("error", "Offline");
    setText(lastCheckedValue, "Unavailable");
    setText(lastActivityValue, "Unavailable");
    empty(
      "Live board unavailable",
      "The status feed could not be reached just now. It will try again automatically.",
      true,
    );
    status.textContent = "Live status temporarily unavailable · retrying every min";
  } finally {
    isLoading = false;
    refreshButton?.removeAttribute("disabled");
  }
}

refreshButton?.addEventListener("click", load);

window.setInterval(() => {
  if (!document.hidden) load();
}, autoRefreshMs);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});

load();
