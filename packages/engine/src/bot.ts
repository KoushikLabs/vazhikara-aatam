/**
 * Heuristic bot AI — packages/engine/src/bot.ts
 *
 * Pure, deterministic-for-a-given-rng heuristics over a MatchState. Zero new
 * runtime dependencies; greedy/linear evaluation, no deep search, mirroring
 * the human tension described in PLAN.md Phase 4.
 *
 * FAIR PLAY: every heuristic below reads only what a seated player could see
 * — their own hand (`round.hands[seat]`), the discard line, the table sets
 * and `placedBy`, stock/hand COUNTS (`.length`), and match totals/config/
 * history. Nothing here ever indexes `round.stock[i]` or
 * `round.hands[otherSeat][i]` for `otherSeat !== seat`.
 */

import { cardFromId, cardPoints, sumPoints } from "./cards.js";
import { findMeldsInHand, findMeldWith } from "./legal.js";
import { attachedSetCards, classifyMeld, nextRank, prevRank } from "./melds.js";
import { applyAction } from "./round.js";
import type { Action, CardId, MatchState, MeldKind, Rank, RoundState, Seat, TableSet } from "./types.js";

// ---------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------

export interface NearMeld {
  kind: MeldKind;
  /** The cards from hand that form the near-meld fragment. */
  cards: CardId[];
  /** How many more cards (of any legal kind) are needed to complete it (usually 1). */
  needed: number;
}

export interface HandEvaluation {
  /** Displayable melds found in hand (greedy, non-overlapping), best first. */
  melds: CardId[][];
  /** One-card-away fragments (pairs toward a group, run fragments incl. circular gap-1/adjacent), non-overlapping with melds or each other. */
  nearMelds: NearMeld[];
  /** Cards left over after melds + near-melds are set aside. */
  deadwood: CardId[];
  /** Point value of the deadwood. */
  deadwoodPoints: number;
}

/**
 * Greedily partition a hand into melds, near-melds, and deadwood.
 *
 * Melds: prefer runs first (they unlock declaring — the own-run requirement),
 * then groups, largest first. Near-melds: same-rank pairs (one card from a
 * group) and same-suit run fragments of length 2 (adjacent or circular gap-1,
 * e.g. K-A) that are one card from completing a run. Everything else is
 * deadwood.
 */
export function evaluateHand(hand: readonly CardId[]): HandEvaluation {
  const remaining = new Set(hand);
  const melds: CardId[][] = [];

  const take = (ids: readonly CardId[]): void => {
    for (const id of ids) remaining.delete(id);
  };

  // 1. Runs first (any length 3-13), longest first, from the full hand.
  for (const suit of ["S", "H", "D", "C"] as const) {
    let pool = [...remaining].filter((id) => cardFromId(id).suit === suit);
    // Greedily peel the longest available same-suit circular arc, repeat.
    let guard = 0;
    while (guard++ < 13) {
      const arc = longestArc(pool);
      if (!arc || arc.length < 3) break;
      melds.push(arc);
      take(arc);
      pool = pool.filter((id) => !arc.includes(id));
    }
  }

  // 2. Groups (same rank, 3+), largest first.
  const byRank = new Map<Rank, CardId[]>();
  for (const id of remaining) {
    const rank = cardFromId(id).rank;
    byRank.set(rank, [...(byRank.get(rank) ?? []), id]);
  }
  const groupCandidates = [...byRank.values()]
    .filter((ids) => ids.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const ids of groupCandidates) {
    melds.push(ids);
    take(ids);
  }

  // 3. Near-melds from what's left: same-rank pairs, then same-suit fragments.
  const nearMelds: NearMeld[] = [];
  const byRank2 = new Map<Rank, CardId[]>();
  for (const id of remaining) {
    const rank = cardFromId(id).rank;
    byRank2.set(rank, [...(byRank2.get(rank) ?? []), id]);
  }
  for (const [, ids] of byRank2) {
    if (ids.length >= 2) {
      const pair = ids.slice(0, 2);
      nearMelds.push({ kind: "group", cards: pair, needed: 1 });
      take(pair);
    }
  }
  for (const suit of ["S", "H", "D", "C"] as const) {
    let pool = [...remaining].filter((id) => cardFromId(id).suit === suit);
    let guard = 0;
    while (guard++ < 13) {
      const frag = longestAdjacentPair(pool);
      if (!frag) break;
      nearMelds.push({ kind: "run", cards: frag, needed: 1 });
      take(frag);
      pool = pool.filter((id) => !frag.includes(id));
    }
  }

  const deadwood = [...remaining];
  return { melds, nearMelds, deadwood, deadwoodPoints: sumPoints(deadwood) };
}

/** Longest same-suit circular contiguous arc (length >= 1) within `pool`, or null if empty. */
function longestArc(pool: readonly CardId[]): CardId[] | null {
  if (pool.length === 0) return null;
  const byRank = new Map<Rank, CardId>();
  for (const id of pool) byRank.set(cardFromId(id).rank, id);
  if (byRank.size === 13) {
    // Every rank present — the full circle, canonically starting at the Ace.
    const arc: CardId[] = [];
    let r: Rank = 1;
    for (let i = 0; i < 13; i++) {
      arc.push(byRank.get(r)!);
      r = nextRank(r);
    }
    return arc;
  }
  let best: CardId[] | null = null;
  for (const startRank of byRank.keys()) {
    if (byRank.has(prevRank(startRank))) continue; // not an arc start
    const arc: CardId[] = [];
    let r = startRank;
    for (let i = 0; i < 13; i++) {
      const id = byRank.get(r);
      if (id === undefined) break;
      arc.push(id);
      r = nextRank(r);
    }
    if (!best || arc.length > best.length) best = arc;
  }
  return best;
}

/**
 * Find a 2-card same-suit run fragment that is exactly one card away from
 * becoming a 3+ run: either two adjacent ranks (e.g. Q-K, or the circular
 * K-A pair — K and A are adjacent on the circle, distance 1) which need one
 * neighbor to complete a run, or a "gap-1" pair two ranks apart on the circle
 * (e.g. 4 and 6, missing the 5) which need exactly the bridging card.
 */
function longestAdjacentPair(pool: readonly CardId[]): CardId[] | null {
  const byRank = new Map<Rank, CardId>();
  for (const id of pool) byRank.set(cardFromId(id).rank, id);
  for (const [rank, id] of byRank) {
    const adjacent = byRank.get(nextRank(rank));
    if (adjacent) return [id, adjacent];
    const gapOne = byRank.get(nextRank(nextRank(rank)));
    if (gapOne) return [id, gapOne]; // e.g. 4 and 6 — the 5 bridges them into a run
  }
  return null;
}

// ---------------------------------------------------------------------------
// Danger signal: opponents' displayed sets tell us what they collect
// ---------------------------------------------------------------------------

/** Ranks that would extend or feed an existing displayed set belonging to `seat` (any set, since group rank-match / run-neighbor cues are public). */
function ranksWantedByDisplays(sets: readonly TableSet[], seat: Seat): Set<Rank> {
  const wanted = new Set<Rank>();
  for (const set of sets) {
    if (set.createdBy !== seat) continue;
    if (set.kind === "group") {
      wanted.add(cardFromId(set.cards[0]!).rank);
    } else {
      const cards = set.cards.map(cardFromId);
      const ranks = new Set(cards.map((c) => c.rank));
      if (ranks.size < 13) {
        for (const c of cards) {
          if (!ranks.has(prevRank(c.rank))) wanted.add(prevRank(c.rank));
          if (!ranks.has(nextRank(c.rank))) wanted.add(nextRank(c.rank));
        }
      }
    }
  }
  return wanted;
}

/** Danger score for discarding `cardId`: how attractive it is to opponents based on their displayed sets (same-rank group attach, or run-neighbor). */
function dangerScore(round: RoundState, seat: Seat, cardId: CardId, playerCount: number): number {
  const card = cardFromId(cardId);
  let danger = 0;
  for (let s = 0; s < playerCount; s++) {
    if (s === seat) continue;
    const wanted = ranksWantedByDisplays(round.sets, s);
    if (wanted.has(card.rank)) danger += 1;
    // Same-suit adjacency to any of that opponent's own run cards, even without an open end tracked above (covers duplicates in multi-deck play).
    for (const set of round.sets) {
      if (set.createdBy !== s || set.kind !== "run") continue;
      const cards = set.cards.map(cardFromId);
      if (cards.some((c) => c.suit === card.suit && (c.rank === nextRank(card.rank) || c.rank === prevRank(card.rank)))) {
        danger += 0.5;
      }
    }
  }
  return danger;
}

// ---------------------------------------------------------------------------
// Draw choice: evaluate each line pickup vs. drawing from stock
// ---------------------------------------------------------------------------

interface PickupCandidate {
  lineIndex: number;
  meldCardIds: CardId[];
  netValue: number;
}

/**
 * For a given line index (the chosen card the player would scoop from),
 * search hand + scooped cards for the best mandatory meld containing the
 * chosen card, and score the overall pickup:
 *   net = points banked by the meld
 *       + usefulness of other scooped cards toward near-melds (each such
 *         card discounted, since it still needs completion)
 *       - liability of leftover scooped points landing in hand (weight 0.7)
 *       - depth risk (extra cards scooped beyond the meld, small per-card cost)
 */
function evaluatePickup(
  round: RoundState,
  seat: Seat,
  lineIndex: number,
): PickupCandidate | null {
  const hand = round.hands[seat] ?? [];
  const scooped = round.line.slice(lineIndex);
  const chosen = round.line[lineIndex]!;
  const pool = [...hand, ...scooped];
  const meld = findMeldWith(chosen, pool);
  if (!meld) return null;

  const meldSet = new Set(meld);
  const banked = sumPoints(meld);
  const leftoverScooped = scooped.filter((id) => !meldSet.has(id));

  // Usefulness: does a leftover scooped card slot into a near-meld the hand
  // already has (after removing the meld cards), or start a fresh one?
  const handAfterMeld = hand.filter((id) => !meldSet.has(id));
  const evalAfterMeld = evaluateHand([...handAfterMeld, ...leftoverScooped]);
  const evalHandOnly = evaluateHand(handAfterMeld);
  const usefulness =
    evalAfterMeld.nearMelds.length - evalHandOnly.nearMelds.length + (evalAfterMeld.melds.length - evalHandOnly.melds.length) * 2;

  const leftoverPoints = sumPoints(leftoverScooped);
  const liability = leftoverPoints * 0.7;
  const depthRisk = Math.max(0, leftoverScooped.length - 1) * 1.5;

  const netValue = banked + usefulness * 4 - liability - depthRisk;
  return { lineIndex, meldCardIds: meld, netValue };
}

const STOCK_DRAW_BASELINE = 3; // rough expected value of an unseen stock card, in "net value" units

/**
 * Choose the best pickup across all line indices, or null to prefer drawing.
 * A small rng jitter avoids bots being clones of each other. Every candidate
 * is validated via applyAction (a pickup can be net-attractive by our score
 * yet illegal — e.g. WOULD_STRAND/WOULD_EMPTY_HAND — so we walk down the
 * ranked list until one actually applies).
 */
function chooseDrawAction(match: MatchState, seat: Seat, rng: () => number): Action | null {
  const round = match.round!;
  const candidates: PickupCandidate[] = [];
  for (let i = 0; i < round.line.length; i++) {
    const cand = evaluatePickup(round, seat, i);
    if (cand) candidates.push(cand);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.netValue - a.netValue);
  const jitter = (rng() - 0.5) * 2; // +-1
  const threshold = STOCK_DRAW_BASELINE + jitter;
  for (const cand of candidates) {
    if (cand.netValue <= threshold) break; // sorted descending — nothing further clears the bar
    const action = tryAction(match, {
      type: "pickupLine",
      seat,
      lineIndex: cand.lineIndex,
      meldCardIds: cand.meldCardIds,
    });
    if (action) return action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discard choice
// ---------------------------------------------------------------------------

/**
 * Score a candidate discard: LOWER is a better (safer/more disposable) card
 * to throw. Penalizes breaking melds/near-melds and danger to opponents;
 * rewards raw low point value. A small rng jitter keeps bots non-identical.
 */
function scoreDiscardCandidate(
  match: MatchState,
  seat: Seat,
  cardId: CardId,
  handWithoutCard: CardId[],
  fullHandEval: HandEvaluation,
  rng: () => number,
): number {
  const round = match.round!;
  const points = cardPoints(cardId);

  // Usefulness: is this card part of a meld or near-meld we'd be breaking?
  let usefulness = 0;
  if (fullHandEval.melds.some((m) => m.includes(cardId))) usefulness += 20; // never break a live meld if avoidable
  if (fullHandEval.nearMelds.some((n) => n.cards.includes(cardId))) usefulness += 6;

  // Would discarding this leave a near-meld or meld orphaned that a fresh
  // evaluation confirms is worse off? Approximate via direct membership above
  // (cheap and adequate — greedy, no deep search per the spec).
  void handWithoutCard;

  const danger = dangerScore(round, seat, cardId, match.config.playerCount);
  const jitter = rng() * 1.5;
  return points * 0.5 + usefulness + danger * 3 + jitter;
}

function chooseDiscard(match: MatchState, seat: Seat, rng: () => number): CardId | null {
  const round = match.round!;
  const hand = round.hands[seat] ?? [];
  if (hand.length === 0) return null;
  const fullHandEval = evaluateHand(hand);
  let best: { cardId: CardId; score: number } | null = null;
  for (const cardId of hand) {
    const rest = hand.filter((id) => id !== cardId);
    const score = scoreDiscardCandidate(match, seat, cardId, rest, fullHandEval, rng);
    if (!best || score < best.score) best = { cardId, score };
  }
  return best?.cardId ?? null;
}

// ---------------------------------------------------------------------------
// Legality-checked helpers — every candidate is validated via applyAction
// before it is ever returned.
// ---------------------------------------------------------------------------

function tryAction(match: MatchState, action: Action): Action | null {
  const result = applyAction(match, action);
  return result.ok ? action : null;
}

/** All legal display actions buildable from the seat's own hand's melds. */
function legalDisplaysFromHand(match: MatchState, seat: Seat): Action[] {
  const round = match.round!;
  const hand = round.hands[seat] ?? [];
  const out: Action[] = [];
  for (const meld of findMeldsInHand(hand)) {
    const action = tryAction(match, { type: "display", seat, cardIds: meld });
    if (action) out.push(action);
  }
  return out;
}

/**
 * All legal single-card attach actions from hand onto any table set. Cheaply
 * pre-filters with `attachedSetCards` (no clone) before paying for the full
 * `applyAction` validation (own-set prerequisite, hand floor, strand guard) —
 * attach candidates are the hot path (every set x every hand card, every
 * tick), so avoiding a structuredClone per rank/suit mismatch matters.
 */
function legalAttachesFromHand(match: MatchState, seat: Seat): Action[] {
  const round = match.round!;
  if (!round.sets.some((set) => set.createdBy === seat)) return []; // NEED_OWN_SET — nothing to try
  const hand = round.hands[seat] ?? [];
  const out: Action[] = [];
  for (const set of round.sets) {
    for (const cardId of hand) {
      if (!attachedSetCards(set.kind, set.cards, [cardId])) continue;
      const action = tryAction(match, { type: "attach", seat, setId: set.id, cardIds: [cardId] });
      if (action) out.push(action);
    }
  }
  return out;
}

/**
 * Should we display this meld right now? Bots hold sets early and reveal
 * under pressure: an opponent is close to declaring (hand count <= 4), the
 * stock is running low (dead-round risk, bank points before it dies), or a
 * small random urge. The engine's WOULD_STRAND guard is respected by only
 * ever returning actions pre-validated via tryAction.
 */
function shouldDisplayNow(match: MatchState, seat: Seat, rng: () => number): boolean {
  const round = match.round!;
  const opponentInDanger = round.hands.some((h, s) => s !== seat && h.length <= 4);
  const stockLow = round.stock.length <= Math.ceil(0.25 * (round.stock.length + round.line.length + 10));
  // stock.length is COUNT-only info; comparing it to a threshold derived from
  // itself and public line/hand-size info keeps this within fair-play bounds.
  const stockCountLow = round.stock.length <= 12;
  return opponentInDanger || stockLow || stockCountLow || rng() < 0.12;
}

// ---------------------------------------------------------------------------
// Declare sequencing: walk to a declare across ticks when reachable
// ---------------------------------------------------------------------------

/**
 * Count how many of `cards` could attach to SOME table set (any set, any
 * player's — the prerequisite for actually attaching is checked later by
 * applyAction; this is just a cheap plausibility estimate using public
 * set shapes, no hidden info).
 */
function countAttachableToTable(round: RoundState, seat: Seat, cards: readonly CardId[]): number {
  if (round.sets.length === 0) return 0;
  let count = 0;
  for (const cardId of cards) {
    const fits = round.sets.some((set) => attachedSetCards(set.kind, set.cards, [cardId]) !== null);
    if (fits) count += 1;
  }
  return count;
}

/**
 * If the bot's hand (post-take) can be reduced to exactly one card via a
 * sequence of displays/attaches respecting the own-run requirement, return
 * the NEXT action in that sequence (this tick lays down one meld/attach, or
 * performs the final declare discard). Returns null if no such path is
 * reachable right now.
 */
function tryDeclareSequence(match: MatchState, seat: Seat): Action | null {
  const round = match.round!;
  if (round.turn !== seat || round.phase !== "awaitDiscard") return null;
  const hand = round.hands[seat] ?? [];

  // Cheap pre-check: a declare needs every card except one to be part of a
  // meld the hand can display, or attachable to a table set of the RIGHT
  // rank/run-neighbor. Skip the expensive simulated walk (each step costs
  // several applyAction/structuredClone calls) unless deadwood is small
  // enough that reaching 1 card is remotely plausible this turn.
  const handEval = evaluateHand(hand);
  const meldedCount = handEval.melds.reduce((n, m) => n + m.length, 0);
  // Near-meld cards are NOT stranded when the table will take them (e.g. a
  // pair of 9s with a 9-group displayed) — count them alongside deadwood,
  // otherwise this gate aborts declare walks the simulation would have found
  // and the bot discards away its own win.
  const looseCards = [...handEval.deadwood, ...handEval.nearMelds.flatMap((n) => n.cards)];
  const attachableLoose = countAttachableToTable(round, seat, looseCards);
  const strandedCount = hand.length - meldedCount - attachableLoose;
  if (strandedCount > 1) return null;

  // Simulate greedily: keep applying the best available display/attach that
  // makes progress toward hand size 1, preferring displaying a run first if
  // no own run exists yet (needed for the final declare discard).
  let working: MatchState = match;
  const ownRun = () => working.round!.sets.some((s) => s.createdBy === seat && s.kind === "run");
  const planned: Action[] = [];
  let guard = 0;
  while (guard++ < 15) {
    const currentHand = working.round!.hands[seat] ?? [];
    if (currentHand.length === 1) break;
    const displays = legalDisplaysFromHand(working, seat);
    const attaches = legalAttachesFromHand(working, seat);
    // Prefer a run display if we don't have an own run yet.
    const runDisplay = displays.find(
      (a) => a.type === "display" && classifyMeld(a.cardIds) === "run",
    );
    let next: Action | undefined;
    if (!ownRun() && runDisplay) {
      next = runDisplay;
    } else {
      // Prefer whichever action sheds the most cards from hand (greedy).
      const shed = (a: Action): number =>
        a.type === "display" ? a.cardIds.length : a.type === "attach" ? a.cardIds.length : 0;
      const all = [...displays, ...attaches].sort((a, b) => shed(b) - shed(a));
      next = all[0];
    }
    if (!next) break;
    const applied = applyAction(working, next);
    if (!applied.ok) break;
    working = applied.state;
    planned.push(next);
    if ((working.round!.hands[seat] ?? []).length === 1) break;
  }

  const finalHand = working.round!.hands[seat] ?? [];
  if (finalHand.length !== 1 || !ownRun()) return null;
  // A full path exists; if it takes more than one step, walk it one action
  // per tick (return the first planned action from the ORIGINAL state).
  if (planned.length > 0) {
    const first = planned[0]!;
    // Re-validate against the real (non-simulated) match to be safe.
    return tryAction(match, first);
  }
  // No shedding action needed and we're already at 1 card with an own run —
  // discard the remaining card as the declare.
  const declareCard = hand[0];
  if (hand.length === 1 && declareCard && ownRun()) {
    return tryAction(match, { type: "discard", seat, cardId: declareCard });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level policy
// ---------------------------------------------------------------------------

/**
 * Choose the bot's action for `seat` given the full (unredacted) `match`.
 * Reads only seat-visible information (see module doc). Always returns a
 * legal action on the bot's own turn; may return null out of turn ("nothing
 * I want to do right now").
 */
export function chooseBotAction(match: MatchState, seat: Seat, rng: () => number): Action | null {
  if (match.phase !== "roundActive" || !match.round) return null;
  const round = match.round;
  const isOwnTurn = round.turn === seat;

  if (isOwnTurn && round.phase === "awaitTake") {
    // Free actions first only if they're strictly beneficial and don't cost
    // us the turn action; but by rule we must draw/pickup/declareDead first
    // in awaitTake, so go straight to the take decision.
    if (round.stock.length === 0) {
      // Stock empty: prefer a clearly-positive pickup if one exists.
      const draw = chooseDrawAction(match, seat, rng);
      if (draw) return draw;
      // The round is about to die, and dead rounds score table MINUS hand —
      // every banked point is a double swing. Free actions are legal before
      // taking, so bank every displayable meld and shed every attachable
      // card (near-melds can never complete once the stock is gone), one
      // action per tick, before declaring the round dead.
      const banks = [...legalDisplaysFromHand(match, seat), ...legalAttachesFromHand(match, seat)];
      if (banks.length > 0) return banks[0]!;
      return tryAction(match, { type: "declareDead", seat });
    }
    const pickup = chooseDrawAction(match, seat, rng);
    if (pickup) return pickup;
    return tryAction(match, { type: "drawStock", seat });
  }

  if (isOwnTurn && round.phase === "awaitDiscard") {
    // After taking: try to walk toward a declare if reachable at all.
    const declareStep = tryDeclareSequence(match, seat);
    if (declareStep) return declareStep;

    // Otherwise: shed eagerly (display/attach) when it's clearly good, then
    // discard. Bank points, don't break melds/near-melds. shouldDisplayNow is
    // evaluated exactly once (it consumes rng()) so the "small random urge"
    // is a single per-decision roll, not one roll per candidate display.
    const displays = legalDisplaysFromHand(match, seat);
    if (displays.length > 0 && shouldDisplayNow(match, seat, rng)) {
      return displays[0]!;
    }

    const attaches = legalAttachesFromHand(match, seat);
    if (attaches.length > 0) {
      // Shed points eagerly whenever it doesn't break an own meld/near-meld —
      // attaches only ever remove single cards already deemed "not useful"
      // by construction here isn't guaranteed, so re-check via evaluateHand.
      const hand = round.hands[seat] ?? [];
      const handEval = evaluateHand(hand);
      const safeAttach = attaches.find((a) => {
        if (a.type !== "attach") return false;
        const cardId = a.cardIds[0]!;
        const inMeld = handEval.melds.some((m) => m.includes(cardId));
        const inNear = handEval.nearMelds.some((n) => n.cards.includes(cardId));
        return !inMeld && !inNear;
      });
      if (safeAttach) return safeAttach;
    }

    const discardCard = chooseDiscard(match, seat, rng);
    if (discardCard) {
      const action = tryAction(match, { type: "discard", seat, cardId: discardCard });
      if (action) return action;
    }
    // Fallback: any legal discard at all (must always return something on our turn).
    const hand = round.hands[seat] ?? [];
    for (const cardId of hand) {
      const action = tryAction(match, { type: "discard", seat, cardId });
      if (action) return action;
    }
    return null; // unreachable in a healthy engine state
  }

  // Out of turn: attach/display with moderate probability per tick.
  if (rng() < 0.4) {
    const displays = legalDisplaysFromHand(match, seat);
    if (displays.length > 0 && shouldDisplayNow(match, seat, rng)) {
      return displays[Math.floor(rng() * displays.length)] ?? null;
    }
    const attaches = legalAttachesFromHand(match, seat);
    if (attaches.length > 0) {
      const hand = round.hands[seat] ?? [];
      const handEval = evaluateHand(hand);
      const safe = attaches.filter((a) => {
        if (a.type !== "attach") return false;
        const cardId = a.cardIds[0]!;
        const inMeld = handEval.melds.some((m) => m.includes(cardId));
        const inNear = handEval.nearMelds.some((n) => n.cards.includes(cardId));
        return !inMeld && !inNear;
      });
      const pool = safe.length > 0 ? safe : attaches;
      return pool[Math.floor(rng() * pool.length)] ?? null;
    }
  }
  return null;
}
