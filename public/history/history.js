const historyEndpoint = "/api/history";
const activityFilter = document.querySelector("#activityFilter");
const historyStatus = document.querySelector("#historyStatus");
const historyList = document.querySelector("#historyList");
const scanCountValue = document.querySelector("#scanCountValue");
const activityCountValue = document.querySelector("#activityCountValue");
const autoRefreshMs = 60 * 1000;

let showActivityOnly = true;
let allScans = [];
let isLoading = false;

function getScanTime(scan) {
  return scan.at || scan.timestamp || null;
}

function formatTimestamp(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown time";

  const year = new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat(undefined, { month: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${year}.${month}.${day} · ${time}`;
}

function aircraftItems(scan) {
  return Array.isArray(scan.aircraft)
    ? scan.aircraft
    : Array.isArray(scan.liveMatches)
      ? scan.liveMatches
      : [];
}

function scanActivities(scan) {
  const rawActivities = Array.isArray(scan.activity)
    ? scan.activity
    : Array.isArray(scan.activities)
      ? scan.activities
      : scan.event
        ? aircraftItems(scan).map((item) => ({ ...item, type: scan.event }))
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
      };
    })
    .filter((item) => item.type === "detected" || item.type === "airborne");
}

function hasActivity(scan) {
  return scanActivities(scan).length > 0;
}

function activityCount(scans = allScans) {
  return scans.reduce((total, scan) => total + scanActivities(scan).length, 0);
}

function scanKind(scan) {
  if (scan.error) return "error";

  const activities = scanActivities(scan);

  if (activities.some((item) => item.type === "airborne")) return "airborne";
  if (activities.length) return "detected";

  return "quiet";
}

function scanTag(scan) {
  const kind = scanKind(scan);

  if (kind === "airborne") return "Airborne";
  if (kind === "detected") return "Detected";
  if (kind === "error") return "Error";
  return "Quiet";
}

function showEmpty(title, description) {
  const card = document.createElement("article");
  const icon = document.createElement("span");
  const content = document.createElement("div");
  const heading = document.createElement("h3");
  const text = document.createElement("p");

  card.className = "empty-state";
  icon.className = "empty-icon";
  icon.textContent = "⌁";
  heading.textContent = title;
  text.textContent = description;
  content.append(heading, text);
  card.append(icon, content);
  historyList.replaceChildren(card);
}

function appendActivityMessage(message, activities) {
  activities.forEach((activity, index) => {
    if (index > 0) message.append(document.createTextNode(" · "));

    message.append(document.createTextNode(`${activity.aircraft} `));

    const status = document.createElement("span");
    status.className = `status-word ${activity.type}`;
    status.textContent = activity.type === "airborne" ? "airborne" : "detected";
    message.append(status);
  });
}

function appendScanMessage(message, scan) {
  if (scan.error) {
    const status = document.createElement("span");
    status.className = "status-word error";
    status.textContent = "Scan error";
    message.append(status, document.createTextNode(` · ${String(scan.error).slice(0, 180)}`));
    return;
  }

  const activities = scanActivities(scan);

  if (activities.length) {
    appendActivityMessage(message, activities);
    return;
  }

  const aircraft = aircraftItems(scan);

  if (aircraft.length === 1) {
    const name = aircraft[0].label || aircraft[0].aircraft || aircraft[0].registration || "Watched aircraft";
    message.textContent = `${name} still tracked`;
    return;
  }

  if (aircraft.length > 1) {
    message.textContent = `${aircraft.length} watched aircraft still tracked`;
    return;
  }

  message.append(document.createTextNode("Scan completed · "));

  const status = document.createElement("span");
  status.className = "status-word quiet";
  status.textContent = "Quiet";
  message.append(status);
}

function updateSummary() {
  scanCountValue.textContent = String(allScans.length);
  activityCountValue.textContent = String(activityCount());
}

function updateFilterButton() {
  activityFilter.classList.toggle("is-active", showActivityOnly);
  activityFilter.setAttribute("aria-pressed", String(showActivityOnly));
  activityFilter.textContent = showActivityOnly ? "Show all scans" : "Activity only";
}

function render() {
  const scans = showActivityOnly ? allScans.filter(hasActivity) : allScans;

  updateSummary();
  updateFilterButton();

  if (!scans.length) {
    showEmpty(
      showActivityOnly ? "No aircraft activity in the last 7 days" : "No scans recorded yet",
      showActivityOnly
        ? "The tracker is still scanning every minute. Switch to all scans to see the quiet log."
        : "The first completed scan will appear here.",
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  scans.forEach((scan) => {
    const row = document.createElement("article");
    const time = document.createElement("time");
    const message = document.createElement("p");
    const tag = document.createElement("span");

    row.className = `scan-row ${scanKind(scan)}`;
    time.className = "scan-time";
    time.dateTime = getScanTime(scan) || "";
    time.textContent = formatTimestamp(getScanTime(scan));

    message.className = "scan-message";
    appendScanMessage(message, scan);

    tag.className = "scan-tag";
    tag.textContent = scanTag(scan);

    row.append(time, message, tag);
    fragment.append(row);
  });

  historyList.replaceChildren(fragment);
}

async function loadHistory() {
  if (isLoading) return;

  isLoading = true;
  historyStatus.textContent = "Reading the last 7 days of scans…";

  try {
    const response = await fetch(historyEndpoint, { cache: "no-store" });

    if (!response.ok) throw new Error(`History returned ${response.status}`);

    const payload = await response.json();

    if (!payload.ok) throw new Error(payload.error || "Invalid history response");

    allScans = Array.isArray(payload.scans)
      ? payload.scans
      : Array.isArray(payload.history)
        ? payload.history
        : [];

    allScans.sort(
      (first, second) => Date.parse(getScanTime(second)) - Date.parse(getScanTime(first)),
    );

    render();

    const activities = activityCount();
    historyStatus.textContent = allScans.length
      ? `${activities} activit${activities === 1 ? "y" : "ies"} · ${allScans.length} scan${allScans.length === 1 ? "" : "s"} recorded · last 7 days · page updates every min`
      : "No scans recorded yet · page updates every min";
  } catch (error) {
    console.error("Could not load scan history", error);
    showEmpty(
      "Scan history is not online yet",
      "The history page is ready, but the local API could not be reached just now.",
    );
    scanCountValue.textContent = "—";
    activityCountValue.textContent = "—";
    historyStatus.textContent = "Waiting for the local API · retrying every min";
  } finally {
    isLoading = false;
  }
}

activityFilter.addEventListener("click", () => {
  showActivityOnly = !showActivityOnly;
  render();
});

window.setInterval(() => {
  if (!document.hidden) loadHistory();
}, autoRefreshMs);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadHistory();
});

updateFilterButton();
loadHistory();
