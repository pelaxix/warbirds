import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { getHistory, getPublicStatus, runScan, startScanner } from "./scanner.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function safePublicPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const cleanPath = decoded === "/" ? "/index.html" : decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const resolved = path.resolve(publicDir, `.${cleanPath}`);

  if (!resolved.startsWith(publicDir)) {
    return null;
  }

  return resolved;
}

async function serveStatic(request, response, pathname) {
  const filePath = safePublicPath(pathname);

  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": filePath.endsWith(".html") ? "no-cache" : "public, max-age=300",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }

    console.error("Static file error", error);
    sendText(response, 500, "Server error");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, name: "Hamilton Warbird Watch" });
      return;
    }

    if (url.pathname === "/api/public") {
      sendJson(response, 200, await getPublicStatus());
      return;
    }

    if (url.pathname === "/api/history") {
      sendJson(response, 200, await getHistory());
      return;
    }

    if (url.pathname === "/api/check") {
      const token = url.searchParams.get("token") || "";

      if (!config.manualCheckToken || token !== config.manualCheckToken) {
        sendJson(response, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const result = await runScan("manual", { ignoreWindow: true });
      sendJson(response, result.ok ? 200 : 502, result);
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error("Request failed", error);
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Unhandled request error", error);
    sendJson(response, 500, { ok: false, error: "Server error" });
  });
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Hamilton Warbird Watch listening on http://127.0.0.1:${config.port}`);
  console.log(`Data source: ${config.adsbOneBaseUrl}`);

  if (config.startScanner) {
    console.log(`Scanner enabled, interval ${Math.round(config.scanIntervalMs / 1000)} seconds`);
    startScanner();
  } else {
    console.log("Scanner disabled by START_SCANNER=false");
  }
});
