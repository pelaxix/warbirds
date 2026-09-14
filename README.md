# Hamilton Warbird Watch

Personal Hamilton warbird tracker with live aircraft status, scan history, and Discord alerts.

This version runs as a normal Node.js app on the home server instead of a Cloudflare Worker.

## Quick start

```bash
npm install
copy env.example.txt .env
npm start
```

Then open:

```text
http://localhost:3007
```

## Home server target

Run locally on the server at `127.0.0.1:3007`, then expose it with Caddy:

```caddy
warbirds.pelaxix.com {
    reverse_proxy 127.0.0.1:3007
}
```

## Notes

- The scanner uses adsb.fi Open Data by default.
- The default scan interval is 1 minute.
- Scheduled scans run 24/7 by default.
- To restore an active-hours window later, set `ACTIVE_HOURS_ONLY=true` and configure `ACTIVE_START_HOUR` / `ACTIVE_END_HOUR`.
- Runtime state is stored locally in `data/state.json`.
- Private values go in `.env`, which is ignored by git.
