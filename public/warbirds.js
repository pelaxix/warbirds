const api = "/api/public";
const autoRefreshMs = 60 * 1000;

const status = document.querySelector("#fetchStatus");
const cards = document.querySelector("#liveCards");

let isLoading = false;

function setStatus(text) {
  if (status) status.textContent = text;
}

function since(value) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "checking…";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;

  return `${Math.round(seconds / 86400)} days ago`;
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

function updateScanStatus(data) {
  const checkedAt = data.checkedAt || data.lastCheckedAt;

  if (data.lastError) {
    setStatus("Last scan failed. Retrying every min.");
    return;
  }

  setStatus(`Last scan: ${since(checkedAt)}`);
}

async function load() {
  if (isLoading) return;

  isLoading = true;
  setStatus("Last scan: checking…");

  try {
    const response = await window.fetch(api, { cache: "no-store" });

    if (!response.ok) throw new Error(`Live status returned ${response.status}`);

    const data = await response.json();

    if (!data.ok) throw new Error(data.error || "Invalid live status");

    render(data);
    updateScanStatus(data);
  } catch (error) {
    console.error("Warbird Watch live status failed", error);
    empty(
      "Live board unavailable",
      "The status feed could not be reached just now. It will try again automatically.",
      true,
    );
    setStatus("Last scan: unavailable");
  } finally {
    isLoading = false;
  }
}

window.setInterval(() => {
  if (!document.hidden) load();
}, autoRefreshMs);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});

load();
