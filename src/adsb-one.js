import { config } from "./config.js";

export function normalizeRegistration(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeHex(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function fetchByRegistrations(registrations) {
  const path = registrations.map((registration) => encodeURIComponent(registration)).join(",");
  const url = `${config.adsbOneBaseUrl.replace(/\/$/, "")}/v2/reg/${path}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "HamiltonWarbirdWatch/2.0 https://warbirds.pelaxix.com",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ADSB One returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();

  return {
    provider: "ADSB One",
    url,
    now: data.now || Date.now(),
    aircraft: Array.isArray(data.ac) ? data.ac : [],
    message: data.msg || "No message",
    total: Number.isFinite(data.total) ? data.total : undefined,
  };
}
