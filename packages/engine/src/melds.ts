import { cardFromId } from "./cards.js";
import type { CardId, MeldKind, Rank } from "./types.js";

/** Next rank clockwise on the circular order A-2-…-K-A. */
export function nextRank(rank: Rank): Rank {
  return ((rank % 13) + 1) as Rank;
}

/** Previous rank on the circular order. */
export function prevRank(rank: Rank): Rank {
  return (((rank + 11) % 13) + 1) as Rank;
}

/**
 * Group: 3+ cards of the same rank. Suits unrestricted; with multiple decks
 * identical duplicates are legal (9♠ 9♠ 9♥ is a valid group).
 */
export function isValidGroup(ids: readonly CardId[]): boolean {
  if (ids.length < 3) return false;
  const rank = cardFromId(ids[0]!).rank;
  return ids.every((id) => cardFromId(id).rank === rank);
}

/**
 * Run: 3+ consecutive-rank cards, all the same suit, on the CIRCULAR order
 * A-2-…-Q-K-A (K and A adjacent, so K-A-2 is valid). Each rank at most once,
 * so the maximum run length is 13.
 *
 * Returns the cards in canonical ascending circular order, or null if the
 * cards do not form a valid run. Input order never matters.
 */
export function runOrder(ids: readonly CardId[]): CardId[] | null {
  if (ids.length < 3 || ids.length > 13) return null;
  const suit = cardFromId(ids[0]!).suit;
  const byRank = new Map<Rank, CardId>();
  for (const id of ids) {
    const card = cardFromId(id);
    if (card.suit !== suit) return null; // mixed suits never form a run
    if (byRank.has(card.rank)) return null; // each rank at most once, even with multiple decks
    byRank.set(card.rank, id);
  }
  let start: Rank | null = null;
  if (ids.length === 13) {
    start = 1; // full circle: canonical order starts at the Ace
  } else {
    // A contiguous arc on the 13-cycle has exactly one rank whose predecessor is absent.
    for (const rank of byRank.keys()) {
      if (!byRank.has(prevRank(rank))) {
        if (start !== null) return null; // more than one segment → not contiguous
        start = rank;
      }
    }
    if (start === null) return null; // unreachable for <13 unique ranks, kept for safety
  }
  const ordered: CardId[] = [];
  let rank = start;
  for (let i = 0; i < ids.length; i++) {
    const id = byRank.get(rank);
    if (id === undefined) return null;
    ordered.push(id);
    rank = nextRank(rank);
  }
  return ordered;
}

export function isValidRun(ids: readonly CardId[]): boolean {
  return runOrder(ids) !== null;
}

/**
 * Classify a candidate meld. Groups and runs are disjoint (a run needs 3+
 * distinct ranks; a group needs a single rank), so at most one kind matches.
 */
export function classifyMeld(ids: readonly CardId[]): MeldKind | null {
  if (isValidGroup(ids)) return "group";
  if (isValidRun(ids)) return "run";
  return null;
}

/**
 * Validate attaching `added` cards to an existing set of `kind`, and return
 * the new canonical card order for the set, or null if the attach is illegal.
 *
 * Groups extend with any same-rank cards (duplicates fine, no size limit up
 * to the copies in play). Runs extend in either circular direction, each rank
 * still at most once, up to the full 13-card circle — which is exactly
 * "the union must still be a valid run".
 */
export function attachedSetCards(
  kind: MeldKind,
  existing: readonly CardId[],
  added: readonly CardId[],
): CardId[] | null {
  if (added.length === 0) return null;
  const union = [...existing, ...added];
  if (kind === "group") {
    return isValidGroup(union) ? union : null;
  }
  return runOrder(union);
}
