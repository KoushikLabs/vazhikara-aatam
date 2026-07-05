import { cardFromId } from "./cards.js";
import { nextRank, prevRank } from "./melds.js";
import { applyAction } from "./round.js";
import type { Action, CardId, MatchState, Rank, Seat } from "./types.js";

/**
 * Find one valid meld (3 cards is enough) containing `targetId`, using only
 * cards from `pool`. Returns null when none exists.
 *
 * Existence of ANY meld containing the target implies existence of a 3-card
 * one (any sub-arc of a run is a run; any 3 of a group is a group), so this
 * fully answers "can this line card be legally picked up with this pool".
 */
export function findMeldWith(targetId: CardId, pool: readonly CardId[]): CardId[] | null {
  const target = cardFromId(targetId);
  // Group: two more cards of the same rank, any suits, duplicates fine.
  const sameRank = pool.filter((id) => id !== targetId && cardFromId(id).rank === target.rank);
  if (sameRank.length >= 2) {
    return [targetId, sameRank[0]!, sameRank[1]!];
  }
  // Run: same-suit neighbors on the circular order, each rank once.
  const byRank = new Map<Rank, CardId>();
  for (const id of pool) {
    if (id === targetId) continue;
    const card = cardFromId(id);
    if (card.suit === target.suit && card.rank !== target.rank && !byRank.has(card.rank)) {
      byRank.set(card.rank, id);
    }
  }
  const downs: CardId[] = [];
  for (let r = prevRank(target.rank); downs.length < 2; r = prevRank(r)) {
    const id = byRank.get(r);
    if (id === undefined) break;
    downs.unshift(id);
  }
  const ups: CardId[] = [];
  for (let r = nextRank(target.rank); ups.length < 2; r = nextRank(r)) {
    const id = byRank.get(r);
    if (id === undefined) break;
    ups.push(id);
  }
  if (downs.length >= 2) return [...downs.slice(-2), targetId];
  if (downs.length === 1 && ups.length >= 1) return [downs[0]!, targetId, ups[0]!];
  if (ups.length >= 2) return [targetId, ups[0]!, ups[1]!];
  return null;
}

/**
 * Candidate melds displayable from a hand: same-rank groups and the maximal
 * same-suit circular arcs. Not exhaustive over every subset — used for hints,
 * bots, and simulation, where any legal candidate is enough.
 */
export function findMeldsInHand(hand: readonly CardId[]): CardId[][] {
  const melds: CardId[][] = [];
  const byRank = new Map<Rank, CardId[]>();
  for (const id of hand) {
    const rank = cardFromId(id).rank;
    byRank.set(rank, [...(byRank.get(rank) ?? []), id]);
  }
  for (const ids of byRank.values()) {
    if (ids.length >= 3) {
      melds.push(ids.slice(0, 3));
      if (ids.length > 3) melds.push(ids.slice());
    }
  }
  for (const suit of ["S", "H", "D", "C"] as const) {
    const oneCardPerRank = new Map<Rank, CardId>();
    for (const id of hand) {
      const card = cardFromId(id);
      if (card.suit === suit && !oneCardPerRank.has(card.rank)) {
        oneCardPerRank.set(card.rank, id);
      }
    }
    if (oneCardPerRank.size === 13) {
      melds.push(([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as Rank[]).map(
        (r) => oneCardPerRank.get(r) as CardId,
      ));
      continue;
    }
    for (const rank of oneCardPerRank.keys()) {
      if (oneCardPerRank.has(prevRank(rank))) continue; // not the start of an arc
      const arc: CardId[] = [];
      for (let r = rank; oneCardPerRank.has(r); r = nextRank(r)) {
        arc.push(oneCardPerRank.get(r) as CardId);
      }
      if (arc.length >= 3) {
        melds.push(arc);
        if (arc.length > 3) melds.push(arc.slice(0, 3));
      }
    }
  }
  return melds;
}

/**
 * Enumerate legal actions for a seat. Meld-shaped actions are generated from
 * the candidate finders above (so pickup/display coverage is representative,
 * not exhaustive), and every returned action has been validated through
 * applyAction against the current state.
 */
export function enumerateActions(match: MatchState, seat: Seat): Action[] {
  if (match.phase !== "roundActive" || !match.round) return [];
  const round = match.round;
  const hand = round.hands[seat] ?? [];
  const candidates: Action[] = [];

  if (round.turn === seat && round.phase === "awaitTake") {
    candidates.push({ type: "drawStock", seat });
    candidates.push({ type: "declareDead", seat });
    for (let lineIndex = 0; lineIndex < round.line.length; lineIndex++) {
      const chosen = round.line[lineIndex]!;
      const pool = [...hand, ...round.line.slice(lineIndex + 1)];
      const meld = findMeldWith(chosen, pool);
      if (meld) {
        candidates.push({ type: "pickupLine", seat, lineIndex, meldCardIds: meld });
      }
    }
  }
  if (round.turn === seat && round.phase === "awaitDiscard") {
    for (const cardId of hand) {
      candidates.push({ type: "discard", seat, cardId });
    }
  }
  for (const meld of findMeldsInHand(hand)) {
    candidates.push({ type: "display", seat, cardIds: meld });
  }
  for (const set of round.sets) {
    for (const cardId of hand) {
      candidates.push({ type: "attach", seat, setId: set.id, cardIds: [cardId] });
    }
  }
  return candidates.filter((action) => applyAction(match, action).ok);
}
