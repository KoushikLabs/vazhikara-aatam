import { chooseBotAction as engineChooseBotAction, type Action, type MatchState } from "@vazhikara/engine";

/**
 * Server bot driver — Phase 4 delegates straight to the engine's heuristic
 * bot AI (packages/engine/src/bot.ts), which owns all decision-making
 * (hand evaluation, draw/discard/display/attach/declare heuristics). Kept
 * as a thin wrapper so server.ts's import (`chooseBotAction(match, seat,
 * rng): Action | null`) is untouched.
 */
export function chooseBotAction(match: MatchState, seat: number, rng: () => number): Action | null {
  return engineChooseBotAction(match, seat, rng);
}
