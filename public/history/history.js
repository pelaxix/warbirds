const status = document.querySelector("#historyStatus");
const list = document.querySelector("#historyList");
const refreshMs = 60 * 1000;
let loading = false;

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}.${get("month")}.${get("day")} · ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

function appendRow(time, message, className = "quiet") {
  const row = document.createElement("div");
  const timeCell = document.createElement("div");
  const messageCell = document.createElement("div");

  row.className = "scan-row";
  timeCell.className = "scan-time";
  messageCell.className = "scan-message";
  timeCell.textContent = time;
  messageCell.innerHTML = message.replace(/\b(Airborne|Detected|Quiet|Error)\b/g, `<span class="status-word ${className}">$1</span>`);
  row.append(timeCell, messageCell);
  list.append(row);
}

function scanMessage(scan) {
  if (scan.ok === false || scan.error) {
    return { text: `Error · ${scan.error || "scan failed"}`, className: "error" };
  }

  const activities = Array.isArray(scan.activities) ? scan.activities : [];
  if (activities.length) {
    return {
      text: activities.map((activity) => `${activity.label || activity.registration} ${activity.type === "airborne" ? "Airborne" : "Detected"}`).join(" · "),
      className: activities.some((activity) => activity.type === "airborne") ? "airborne" : "detected",
    };
  }

  const aircraft = Array.isArray(scan.aircraft) ? scan.aircraft : [];
  if (aircraft.length === 1) {
    return { text: `${aircraft[0].label || aircraft[0].registration} still tracked`, className: "quiet" };
  }

  if (aircraft.length > 1) {
    return { text: `${aircraft.length} tracked aircrafts still tracked`, className: "quiet" };
  }

  return { text: "Scan completed · Quiet", className: "quiet" };
}

function render(payload) {
  const scans = Array.isArray(payload.scans) ? [...payload.scans].reverse() : [];
  list.replaceChildren();

  if (!scans.length) {
    appendRow("—", "No scan history yet", "quiet");
    return;
  }

  for (const scan of scans) {
    const message = scanMessage(scan);
    appendRow(formatTime(scan.at), message.text, message.className);
  }
}

async function load() {
  if (loading) return;
  loading = true;

  try {
    status.textContent = "Reading history…";
    const response = await fetch("/api/history", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `History returned ${response.status}`);
    }

    render(data);
    const count = Array.isArray(data.scans) ? data.scans.length : 0;
    status.textContent = `${count} scans · updates every min`;
  } catch (error) {
    console.error("History failed", error);
    list.replaceChildren();
    appendRow("—", "Error · history unavailable", "error");
    status.textContent = "History unavailable · retrying every min";
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
