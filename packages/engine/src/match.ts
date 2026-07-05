import { buildDecks, mulberry32, shuffle } from "./cards.js";
import type { ActionResult, MatchConfig, MatchState, RoundState, Seat } from "./types.js";
import { reject } from "./types.js";

/** Default deck count by player count: 2 → 1, 3–4 → 2, 5–6 → 3. */
export function defaultDecks(playerCount: number): number {
  if (playerCount <= 2) return 1;
  if (playerCount <= 4) return 2;
  return 3;
}

export interface MatchOptions {
  playerCount: number;
  /** Host may override the default deck count. */
  decks?: number;
  /** Target score: 500 / 1000 / custom. Default 500. */
  targetScore?: number;
  /** Seed for deterministic dealing. Callers wanting unpredictable games must supply one. */
  seed?: number;
}

export type CreateMatchResult = { ok: true; match: MatchState } | ReturnType<typeof reject>;

export function createMatch(options: MatchOptions): CreateMatchResult {
  const playerCount = options.playerCount;
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    return reject("INVALID_CONFIG", "player count must be an integer between 2 and 6");
  }
  const decks = options.decks ?? defaultDecks(playerCount);
  if (!Number.isInteger(decks) || decks < 1 || decks > 3) {
    return reject("INVALID_CONFIG", "deck count must be an integer between 1 and 3");
  }
  if (10 * playerCount + 1 > 52 * decks) {
    return reject(
      "INVALID_CONFIG",
      `${decks} deck(s) cannot deal 10 cards to ${playerCount} players plus the starter card`,
    );
  }
  const targetScore = options.targetScore ?? 500;
  if (!Number.isInteger(targetScore) || targetScore < 1) {
    return reject("INVALID_CONFIG", "target score must be a positive integer");
  }
  const config: MatchConfig = { playerCount, decks, targetScore, seed: options.seed ?? 1 };
  return {
    ok: true,
    match: {
      config,
      phase: "betweenRounds",
      totals: new Array<number>(playerCount).fill(0),
      dealer: 0,
      roundsPlayed: 0,
      round: null,
      history: [],
      winner: null,
    },
  };
}

/** Derive the default per-round RNG from the match seed and round index. */
export function roundRng(config: MatchConfig, roundIndex: number): () => number {
  return mulberry32((config.seed + roundIndex * 1000003) >>> 0);
}

/**
 * Deal a new round: shuffle, 10 cards each (round-robin starting left of the
 * dealer), flip one starter card to the discard line, rest is the stock.
 * The player to the dealer's left takes the first turn.
 */
export function startNextRound(match: MatchState, rng?: () => number): ActionResult {
  if (match.phase === "finished") {
    return reject("MATCH_NOT_ACTIVE", "the match is over");
  }
  if (match.phase === "roundActive") {
    return reject("MATCH_NOT_ACTIVE", "a round is already in progress");
  }
  const { playerCount } = match.config;
  const random = rng ?? roundRng(match.config, match.roundsPlayed);
  const deck = shuffle(buildDecks(match.config.decks), random);
  const hands: string[][] = Array.from({ length: playerCount }, () => []);
  let cursor = 0;
  for (let i = 0; i < 10 * playerCount; i++) {
    const seat: Seat = (match.dealer + 1 + (i % playerCount)) % playerCount;
    hands[seat]!.push(deck[cursor++]!);
  }
  const starter = deck[cursor++]!;
  const stock = deck.slice(cursor); // top of stock = last element
  const round: RoundState = {
    phase: "awaitTake",
    turn: (match.dealer + 1) % playerCount,
    dealer: match.dealer,
    hands,
    stock,
    line: [starter],
    sets: [],
    placedBy: {},
    nextSetId: 1,
    result: null,
  };
  return { ok: true, state: { ...match, phase: "roundActive", round } };
}

/**
 * Fold a finished round into the match: accumulate totals, rotate the dealer,
 * and decide the winner. First player to reach or exceed the target wins; if
 * several cross in the same round the strictly higher total wins, and an
 * exact tie at the top means another round is played.
 */
export function applyRoundResult(match: MatchState, round: RoundState): MatchState {
  const result = round.result;
  if (!result) throw new Error("applyRoundResult called on an unfinished round");
  const totals = match.totals.map((total, seat) => total + (result.scores[seat] ?? 0));
  const target = match.config.targetScore;
  const best = Math.max(...totals);
  const crossed = totals
    .map((total, seat) => ({ total, seat }))
    .filter(({ total }) => total >= target);
  let winner: Seat | null = null;
  if (crossed.length > 0) {
    const leaders = crossed.filter(({ total }) => total === best);
    if (leaders.length === 1) winner = leaders[0]!.seat;
    // tie at the top: winner stays null and another round is played
  }
  return {
    ...match,
    phase: winner === null ? "betweenRounds" : "finished",
    totals,
    dealer: (match.dealer + 1) % match.config.playerCount,
    roundsPlayed: match.roundsPlayed + 1,
    round,
    history: [...match.history, result],
    winner,
  };
}
