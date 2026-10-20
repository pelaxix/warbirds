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
- The history window keeps 7 days by default, with room for about 12,000 scan records.
- Flight sessions persist between scans and server restarts; temporary signal loss or missing altitude does **not** confirm a landing.
- A landing is confirmed after three distinct ADS-B ground reports over at least two minutes.
- A new flight requires a confirmed landing followed by airborne evidence, or a fallback of 90 minutes with no fresh airborne observation (`FLIGHT_SILENCE_MINUTES=90`).
- Returning signals after a gap of at least five minutes are logged as **Signal reacquired**, not new flights; they do not trigger Discord alerts.
- `RESET_AFTER_MINUTES=30` controls how long an aircraft remains in the live board after its last signal; it is independent of the flight-session timeout.
- History keeps legacy activity entries unchanged rather than retrospectively classifying old flights.
- Run `npm test` to check the flight-session edge cases.
- To restore an active-hours window later, set `ACTIVE_HOURS_ONLY=true` and configure `ACTIVE_START_HOUR` / `ACTIVE_END_HOUR`.
- Runtime state is stored locally in `data/state.json`.
- Private values go in `.env`, which is ignored by git.
