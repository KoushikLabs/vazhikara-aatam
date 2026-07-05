/**
 * @vazhikara/engine — Pure rules engine for Vazhikara Aatam.
 *
 * Zero runtime dependencies. All state is serializable data; every game
 * action flows through `applyAction(state, action)` which returns either the
 * next state or a rejection with a reason. The server and the bots use this
 * exact API.
 */

export const ENGINE_NAME = "vazhikara-engine";

export const ENGINE_VERSION = "0.1.0";

export function getEngineInfo(): { name: string; version: string } {
  return { name: ENGINE_NAME, version: ENGINE_VERSION };
}

export * from "./types.js";
export * from "./cards.js";
export * from "./melds.js";
export * from "./scoring.js";
export * from "./match.js";
export * from "./round.js";
export * from "./legal.js";
export * from "./sim.js";
export * from "./bot.js";
