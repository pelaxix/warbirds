import assert from "node:assert/strict";
import test from "node:test";
import { advanceFlightSession, seedFlightSession, DEFAULT_FLIGHT_RULES } from "../src/flight-sessions.js";

const baseline = Date.parse("2026-10-20T10:00:00Z");
const at = (minutes) => new Date(baseline + minutes * 60_000).toISOString();
const observe = (session, minutes, kind) =>
  advanceFlightSession(session, {
    at: at(minutes),
    airborne: kind === "airborne",
    grounded: kind === "ground",
  });

test("a short ADS-B interruption is reacquired, never another takeoff", () => {
  let outcome = observe(null, 0, "airborne");
  assert.deepEqual(outcome.events, ["takeoff"]);

  outcome = observe(outcome.session, 1, "airborne");
  assert.deepEqual(outcome.events, []);

  outcome = observe(outcome.session, 7, "airborne");
  assert.deepEqual(outcome.events, ["reacquired"]);

  outcome = observe(outcome.session, 21, "airborne");
  assert.deepEqual(outcome.events, ["reacquired"]);
});

test("an unknown altitude or speed cannot end an airborne flight", () => {
  let outcome = observe(null, 0, "airborne");
  outcome = observe(outcome.session, 1, "unknown");
  assert.deepEqual(outcome.events, []);
  assert.equal(outcome.session.inFlight, true);

  outcome = observe(outcome.session, 2, "airborne");
  assert.deepEqual(outcome.events, []);
});

test("landings require three independent ground reports spanning two minutes", () => {
  let outcome = observe(null, 0, "airborne");
  outcome = observe(outcome.session, 1, "ground");
  assert.deepEqual(outcome.events, []);
  outcome = observe(outcome.session, 2, "ground");
  assert.deepEqual(outcome.events, []);
  outcome = observe(outcome.session, 3, "ground");
  assert.deepEqual(outcome.events, ["landed"]);
  assert.equal(outcome.session.inFlight, false);
  outcome = observe(outcome.session, 4, "airborne");
  assert.deepEqual(outcome.events, ["takeoff"]);
});

test("provider duplicates do not count as separate ground reports", () => {
  let outcome = observe(null, 0, "airborne");
  outcome = observe(outcome.session, 1, "ground");
  const firstGround = outcome.session;
  outcome = observe(firstGround, 1, "ground");
  assert.deepEqual(outcome.events, []);
  assert.equal(outcome.session.groundReports, 1);
  outcome = observe(outcome.session, 2, "ground");
  assert.equal(outcome.session.groundReports, 2);
  assert.equal(outcome.session.inFlight, true);
});

test("an interrupted ground-report streak does not mark a landing", () => {
  let outcome = observe(null, 0, "airborne");
  outcome = observe(outcome.session, 1, "ground");
  outcome = observe(outcome.session, 2, "unknown");
  outcome = observe(outcome.session, 3, "ground");
  outcome = observe(outcome.session, 4, "ground");
  outcome = observe(outcome.session, 5, "airborne");
  assert.deepEqual(outcome.events, []);
});

test("90 minutes without airborne evidence permits a new flight", () => {
  let outcome = observe(null, 0, "airborne");
  outcome = observe(outcome.session, 91, "airborne");
  assert.deepEqual(outcome.events, ["takeoff"]);
});

test("upgrade from older saved state does not issue a duplicate flight alert", () => {
  const legacy = { airborne: true, lastSeenAt: at(0), firstSeenAt: at(-20) };
  const session = seedFlightSession(legacy, DEFAULT_FLIGHT_RULES.maxFlightSilenceMs, baseline + 60_000);
  assert.ok(session);
  const outcome = observe(session, 1, "airborne");
  assert.deepEqual(outcome.events, []);
});

test("first sightings without airborne evidence are detected, not takeoffs", () => {
  assert.deepEqual(observe(null, 0, "ground").events, ["detected"]);
  assert.deepEqual(observe(null, 0, "unknown").events, ["detected"]);
});
