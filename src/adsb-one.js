import { config } from "./config.js";

const REQUEST_DELAY_MS = 1100;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerBaseUrl() {
  return config.adsbOneBaseUrl.replace(/\/$/, "");
}

async function fetchOneRegistration(registration) {
  const url = `${providerBaseUrl()}/v2/registration/${encodeURIComponent(registration)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "HamiltonWarbirdWatch/2.0 https://warbirds.pelaxix.com",
    },
  });

  if (response.status === 404) {
    return { aircraft: [], url };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`adsb.fi returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();

  return {
    aircraft: Array.isArray(data.ac) ? data.ac : [],
    url,
    now: data.now || Date.now(),
    message: data.msg || "No message",
    total: Number.isFinite(data.total) ? data.total : undefined,
  };
}

export async function fetchByRegistrations(registrations) {
  const aircraft = [];
  const urls = [];
  let newestNow = Date.now();
  let total = 0;

  for (const [index, registration] of registrations.entries()) {
    if (index > 0) {
      await sleep(REQUEST_DELAY_MS);
    }

    const result = await fetchOneRegistration(registration);
    aircraft.push(...result.aircraft);
    urls.push(result.url);

    if (Number.isFinite(Number(result.now))) {
      newestNow = Math.max(newestNow, Number(result.now));
    }

    if (Number.isFinite(Number(result.total))) {
      total += Number(result.total);
    } else {
      total += result.aircraft.length;
    }
  }

  return {
    provider: "adsb.fi",
    url: urls.join(" | "),
    now: newestNow,
    aircraft,
    message: "No error",
    total,
  };
}
