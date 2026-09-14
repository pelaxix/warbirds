import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const statePath = path.join(config.dataDir, "state.json");
let queue = Promise.resolve();

function defaultState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    checkedAt: null,
    lastError: null,
    current: {},
    history: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function readState() {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(raw);
    return {
      ...defaultState(),
      ...state,
      current: state.current && typeof state.current === "object" ? state.current : {},
      history: Array.isArray(state.history) ? state.history : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultState();
    }
    throw error;
  }
}

export async function writeState(state) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${statePath}.tmp`;
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, statePath);
  return clone(state);
}

export function withState(mutator) {
  queue = queue.then(async () => {
    const state = await readState();
    const next = await mutator(state);
    return writeState(next || state);
  });

  return queue;
}

export function getStatePath() {
  return statePath;
}
