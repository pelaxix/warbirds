const status = document.querySelector("#fetchStatus");
const cards = document.querySelector("#liveCards");
const refreshMs = 60 * 1000;
let loading = false;

function since(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} hr ago`;
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
  const heading = document.createElement("h3");
  const message = document.createElement("p");

  card.className = `empty-state${isError ? " error-state" : ""}`;
  heading.textContent = title;
  message.textContent = text;
  card.append(heading, message);
  cards.replaceChildren(card);
}

function liveCard(item) {
  const card = document.createElement("article");
  const header = document.createElement("div");
  const title = document.createElement("h3");
  const badge = document.createElement("span");
  const meta = document.createElement("p");
  const grid = document.createElement("div");

  card.className = `live-card${item.airborne ? " airborne" : ""}`;
  header.className = "live-card-head";
  title.textContent = item.label || item.registration || "Historic aircraft";
  badge.className = `status-badge ${item.airborne ? "airborne" : "detected"}`;
  badge.textContent = item.airborne ? "Airborne" : "Detected";
  header.append(title, badge);

  meta.className = "live-card-meta";
  meta.textContent = `${item.registration || "Unknown"} • ${item.name || "Warbird watch"}`;

  grid.className = "data-grid";
  grid.append(
    field("Altitude", item.altitude),
    field("Speed", item.speed),
    field("Callsign", item.callsign || "Not broadcast"),
    field("Last signal", since(item.lastSeenAt)),
  );

  card.append(header, meta, grid);

  if (item.routeUrl) {
    const link = document.createElement("a");
    link.className = "live-route-link";
    link.href = item.routeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Follow this plane’s live route";
    card.append(link);
  }

  return card;
}

function render(payload) {
  const active = Array.isArray(payload.active) ? payload.active : [];

  if (!active.length) {
    empty(
      "Quiet skies right now",
      "No tracked aircraft were recently reported by the data source. That is normal most days.",
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  active.forEach((item) => fragment.append(liveCard(item)));
  cards.replaceChildren(fragment);
}

async function load() {
  if (loading) return;
  loading = true;

  try {
    status.textContent = "Reading latest scan…";
    const response = await fetch("/api/public", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Status returned ${response.status}`);
    }

    render(data);

    const activeCount = Array.isArray(data.active) ? data.active.length : 0;
    const count = Number(data.trackedAircraft || 10);
    const checkedText = data.checkedAt ? `last checked ${since(data.checkedAt)}` : "not checked yet";
    const errorText = data.lastError ? " · last scan had an error" : "";

    status.textContent = activeCount
      ? `${activeCount} of ${count} tracked · ${checkedText}${errorText}`
      : `${count} tracked · quiet · ${checkedText}${errorText}`;
  } catch (error) {
    console.error("Live board failed", error);
    empty(
      "Live board unavailable",
      "The local Warbird Watch server could not provide status just now.",
      true,
    );
    status.textContent = "Status unavailable · retrying every min";
  } finally {
    loading = false;
  }
}

setInterval(() => {
  if (!document.hidden) load();
}, refreshMs);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});

load();
