import { buildDecks, mulberry32 } from "./cards.js";
import { enumerateActions } from "./legal.js";
import { runOrder } from "./melds.js";
import { createMatch, startNextRound } from "./match.js";
import { applyAction } from "./round.js";
import type { Action, MatchState, Seat } from "./types.js";

/**
 * Structural invariants that must hold after every applied action. Returns a
 * list of violation descriptions (empty = healthy).
 */
export function checkInvariants(match: MatchState): string[] {
  const problems: string[] = [];
  const n = match.config.playerCount;
  if (match.totals.length !== n) problems.push("totals length != player count");
  const historySums = new Array<number>(n).fill(0);
  for (const result of match.history) {
    result.scores.forEach((s, seat) => (historySums[seat] = (historySums[seat] ?? 0) + s));
  }
  if (historySums.some((s, seat) => s !== match.totals[seat])) {
    problems.push("match totals do not equal the sum of round scores");
  }
  const round = match.round;
  if (match.phase === "roundActive") {
    if (!round) problems.push("roundActive with no round");
    else if (round.phase === "ended") problems.push("roundActive but round.phase is ended");
  }
  if (!round) return problems;

  // Card conservation: hands + stock + line + table sets = exactly the deck.
  const zones = [
    ...round.hands.flat(),
    ...round.stock,
    ...round.line,
    ...round.sets.flatMap((s) => s.cards),
  ];
  const expected = buildDecks(match.config.decks).sort().join(",");
  if (zones.slice().sort().join(",") !== expected) {
    problems.push("card conservation violated: zones do not partition the deck");
  }
  if (new Set(zones).size !== zones.length) {
    problems.push("a card appears in two zones at once");
  }

  for (const set of round.sets) {
    if (set.cards.length < 3) problems.push(`set ${set.id} has fewer than 3 cards`);
    if (set.createdBy < 0 || set.createdBy >= n) problems.push(`set ${set.id} has a bad creator`);
    if (set.kind === "run") {
      const canonical = runOrder(set.cards);
      if (!canonical) problems.push(`set ${set.id} is not a valid run`);
      else if (canonical.join(",") !== set.cards.join(",")) {
        problems.push(`run ${set.id} is not stored in canonical order`);
      }
    }
  }

  const placedKeys = Object.keys(round.placedBy).sort().join(",");
  const tableCards = round.sets
    .flatMap((s) => s.cards)
    .sort()
    .join(",");
  if (placedKeys !== tableCards) {
    problems.push("placedBy does not exactly cover the cards on the table");
  }

  if (round.phase !== "ended") {
    round.hands.forEach((hand, seat) => {
      if (hand.length < 1) problems.push(`seat ${seat} has an empty hand mid-round`);
    });
  }
  return problems;
}

export interface SimOptions {
  playerCount: number;
  decks?: number;
  targetScore?: number;
  seed: number;
  maxRounds?: number;
  maxActionsPerRound?: number;
}

export interface SimResult {
  match: MatchState;
  roundsPlayed: number;
  actionsApplied: number;
  /** Per-action-type counts — lets tests assert the fuzz actually exercises pickups, displays, and attaches. */
  actionCounts: Record<Action["type"], number>;
  declaredRounds: number;
  deadRounds: number;
  violations: string[];
  /** Per-seat round wins (declarer credit) and total scores, for baseline comparisons. */
  winsBySeat: number[];
  totalsBySeat: number[];
}

/**
 * A seat's decision function: given the full (unredacted) match state, choose
 * an action for `seat` or null ("nothing to do" — only valid out of turn; the
 * turn seat returning null is treated as a stall and fails the sim).
 */
export type SeatPolicy = (match: MatchState, seat: Seat, rng: () => number) => Action | null;

/**
 * The baseline random-legal-move policy used by the Phase 1 fuzz suite:
 * mostly-draw takes, eager-ish melding, random discard among legal ones.
 * Exposed for reuse by the Phase 4 baseline comparisons.
 */
export const randomPolicy: SeatPolicy = (match, seat, rng) => {
  const round = match.round;
  if (!round || match.phase !== "roundActive") return null;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

  if (round.turn === seat) {
    const legal = enumerateActions(match, seat);
    if (legal.length === 0) return null;
    if (round.phase === "awaitTake") {
      const takes = legal.filter((a) => a.type === "drawStock" || a.type === "pickupLine");
      const dead = legal.filter((a) => a.type === "declareDead");
      const pickups = takes.filter((a) => a.type === "pickupLine");
      const draw = takes.find((a) => a.type === "drawStock");
      if (draw && (pickups.length === 0 || rng() < 0.75)) return draw;
      if (pickups.length > 0) return pick(pickups);
      return dead[0] ?? null;
    }
    const frees = legal.filter((a) => a.type === "display" || a.type === "attach");
    const discards = legal.filter((a) => a.type === "discard");
    if (frees.length > 0 && rng() < 0.6) return pick(frees);
    return discards.length > 0 ? pick(discards) : null;
  }

  // Out of turn: occasionally take a free action, exercising the real-time path.
  if (rng() < 0.35) {
    const free = enumerateActions(match, seat).filter(
      (a) => a.type === "display" || a.type === "attach",
    );
    if (free.length > 0) return pick(free);
  }
  return null;
};

export interface PolicyOptions extends SimOptions {
  /** One policy per seat, indexed by seat number. */
  policies: SeatPolicy[];
}

/**
 * Play a match where each seat acts via its own policy, checking invariants
 * after every action. On every tick a random seat is offered a free-action
 * chance (display/attach) via its own policy — same real-time texture as the
 * original fuzz sim — and then the turn seat's policy is asked to act.
 *
 * The turn seat's policy MUST return an action; a null return on the acting
 * seat's own turn is recorded as a stall violation (the round would deadlock
 * otherwise), not silently tolerated.
 */
export function playPolicyMatch(options: PolicyOptions): SimResult {
  const rng = mulberry32(options.seed);
  const created = createMatch({
    playerCount: options.playerCount,
    ...(options.decks !== undefined ? { decks: options.decks } : {}),
    targetScore: options.targetScore ?? 100,
    seed: options.seed,
  });
  if (!created.ok) throw new Error(`sim config invalid: ${created.message}`);
  let match = created.match;
  const maxRounds = options.maxRounds ?? 40;
  const maxActionsPerRound = options.maxActionsPerRound ?? 4000;
  let actionsApplied = 0;
  const actionCounts: Record<Action["type"], number> = {
    drawStock: 0,
    pickupLine: 0,
    display: 0,
    attach: 0,
    discard: 0,
    declareDead: 0,
  };
  let declaredRounds = 0;
  let deadRounds = 0;
  const violations: string[] = [];
  const winsBySeat = new Array<number>(options.playerCount).fill(0);

  const apply = (action: Action): boolean => {
    const result = applyAction(match, action);
    if (!result.ok) {
      violations.push(`policy produced illegal action: ${action.type} seat ${action.seat} (${result.code}: ${result.message})`);
      return false;
    }
    match = result.state;
    actionsApplied += 1;
    actionCounts[action.type] += 1;
    const problems = checkInvariants(match);
    if (problems.length > 0) {
      violations.push(...problems.map((p) => `after ${action.type}: ${p}`));
      return false;
    }
    return true;
  };

  while (match.phase !== "finished" && match.roundsPlayed < maxRounds && violations.length === 0) {
    const started = startNextRound(match);
    if (!started.ok) {
      violations.push(`could not start round: ${started.code}`);
      break;
    }
    match = started.state;
    const dealProblems = checkInvariants(match);
    if (dealProblems.length > 0) {
      violations.push(...dealProblems.map((p) => `after deal: ${p}`));
      break;
    }
    let roundActions = 0;
    while (match.phase === "roundActive" && violations.length === 0) {
      if (++roundActions > maxActionsPerRound) {
        violations.push("round did not terminate within the action budget");
        break;
      }
      const round = match.round;
      if (!round) break;

      // Occasionally let a random seat's policy take a free action — keeps
      // the out-of-turn real-time path exercised across all seat policies.
      if (rng() < 0.35) {
        const seat = Math.floor(rng() * match.config.playerCount);
        if (seat !== round.turn) {
          const action = options.policies[seat]!(match, seat, rng);
          if (action) {
            if (action.type !== "display" && action.type !== "attach") {
              violations.push(`seat ${seat} policy returned a turn-locked action out of turn: ${action.type}`);
              break;
            }
            if (!apply(action)) break;
            continue;
          }
        }
      }

      const turnSeat = round.turn;
      const action = options.policies[turnSeat]!(match, turnSeat, rng);
      if (!action) {
        violations.push(`turn player ${turnSeat} policy returned null on its own turn (stall)`);
        break;
      }
      if (!apply(action)) break;
    }
    if (match.round?.result) {
      if (match.round.result.declarer !== null) {
        declaredRounds += 1;
        winsBySeat[match.round.result.declarer] = (winsBySeat[match.round.result.declarer] ?? 0) + 1;
      } else {
        deadRounds += 1;
      }
    }
  }
  return {
    match,
    roundsPlayed: match.roundsPlayed,
    actionsApplied,
    actionCounts,
    declaredRounds,
    deadRounds,
    violations,
    winsBySeat,
    totalsBySeat: match.totals,
  };
}

/**
 * Play a match with random legal moves, checking invariants after every
 * action. Thin wrapper over playPolicyMatch using randomPolicy for every
 * seat — kept so the original Phase 1 fuzz suite's behavior and results are
 * unchanged.
 */
export function playRandomMatch(options: SimOptions): SimResult {
  return playPolicyMatch({
    ...options,
    policies: new Array<SeatPolicy>(options.playerCount).fill(randomPolicy),
  });
}
