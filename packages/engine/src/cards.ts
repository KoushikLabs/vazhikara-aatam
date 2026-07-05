import type { Card, CardId, Rank, Suit } from "./types.js";

export const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const RANK_TOKENS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export function rankToken(rank: Rank): string {
  return RANK_TOKENS[rank - 1]!;
}

export function tokenToRank(token: string): Rank {
  const idx = RANK_TOKENS.indexOf(token as (typeof RANK_TOKENS)[number]);
  if (idx === -1) throw new Error(`invalid rank token: ${token}`);
  return (idx + 1) as Rank;
}

export function makeCardId(rank: Rank, suit: Suit, copy: number): CardId {
  return `${rankToken(rank)}${suit}#${copy}`;
}

const cardCache = new Map<CardId, Card>();

/** Parse a per-copy card id like "10H#3" into its components. */
export function cardFromId(id: CardId): Card {
  const cached = cardCache.get(id);
  if (cached) return cached;
  const hash = id.indexOf("#");
  if (hash < 2) throw new Error(`invalid card id: ${id}`);
  const copy = Number(id.slice(hash + 1));
  const body = id.slice(0, hash);
  const suit = body[body.length - 1] as Suit;
  if (!SUITS.includes(suit)) throw new Error(`invalid card id: ${id}`);
  const rank = tokenToRank(body.slice(0, -1));
  if (!Number.isInteger(copy) || copy < 1) throw new Error(`invalid card id: ${id}`);
  const card: Card = { id, rank, suit, copy };
  cardCache.set(id, card);
  return card;
}

/** A = 15; K, Q, J, 10 = 10; 2–9 = 5. */
export function cardPoints(idOrRank: CardId | Rank): number {
  const rank = typeof idOrRank === "number" ? idOrRank : cardFromId(idOrRank).rank;
  if (rank === 1) return 15;
  if (rank >= 10) return 10;
  return 5;
}

export function sumPoints(ids: readonly CardId[]): number {
  return ids.reduce((acc, id) => acc + cardPoints(id), 0);
}

/** Build `deckCount` full 52-card decks with unique per-copy ids. No jokers. */
export function buildDecks(deckCount: number): CardId[] {
  const ids: CardId[] = [];
  for (let copy = 1; copy <= deckCount; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        ids.push(makeCardId(rank, suit, copy));
      }
    }
  }
  return ids;
}

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array using the injected RNG. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
