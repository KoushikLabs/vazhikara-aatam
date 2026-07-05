/**
 * Core types for the Vazhikara Aatam rules engine.
 *
 * All state is plain serializable data. Cards are referenced everywhere by
 * per-copy id (e.g. "9S#2") — never by rank+suit alone, because with up to
 * three decks the same rank+suit exists multiple times.
 */

export type Suit = "S" | "H" | "D" | "C";

/** 1 = Ace, 2–10 = pip value, 11 = Jack, 12 = Queen, 13 = King. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** Per-copy card id, e.g. "AS#1", "10H#3", "9S#2". */
export type CardId = string;

export interface Card {
  id: CardId;
  rank: Rank;
  suit: Suit;
  copy: number;
}

/** Seat index, 0-based, clockwise. */
export type Seat = number;

export type MeldKind = "group" | "run";

export interface TableSet {
  id: string;
  kind: MeldKind;
  /** Seat that laid the set down. Attachments never change this. */
  createdBy: Seat;
  /** Run cards are kept in canonical ascending circular order. */
  cards: CardId[];
}

export type RoundPhase = "awaitTake" | "awaitDiscard" | "ended";

export interface RoundResult {
  /** null = dead round (stock ran out, nobody declared). */
  declarer: Seat | null;
  /** Per seat: points of table cards that seat physically placed. */
  tablePoints: number[];
  /** Per seat: points left in hand at round end. */
  handPoints: number[];
  /** Per seat: round score (declarer: table; others: table − hand). */
  scores: number[];
}

export interface RoundState {
  phase: RoundPhase;
  turn: Seat;
  dealer: Seat;
  hands: CardId[][];
  /** Face-down stock; the top card is the LAST element. */
  stock: CardId[];
  /** The discard line in throw order; index 0 is the flipped starter card. */
  line: CardId[];
  sets: TableSet[];
  /** Per-card placement ownership for every card on the table. */
  placedBy: Record<CardId, Seat>;
  nextSetId: number;
  result: RoundResult | null;
}

export interface MatchConfig {
  playerCount: number;
  decks: number;
  targetScore: number;
  /** Seed for deterministic dealing (per-round RNG derived from it). */
  seed: number;
}

export type MatchPhase = "betweenRounds" | "roundActive" | "finished";

export interface MatchState {
  config: MatchConfig;
  phase: MatchPhase;
  totals: number[];
  /** Dealer for the NEXT round to start (rotates every round). */
  dealer: Seat;
  roundsPlayed: number;
  round: RoundState | null;
  history: RoundResult[];
  winner: Seat | null;
}

export type Action =
  | { type: "drawStock"; seat: Seat }
  | {
      type: "pickupLine";
      seat: Seat;
      /** Index into the line of the chosen (deepest) card; everything from here on is scooped. */
      lineIndex: number;
      /** The mandatory brand-new meld; must contain the chosen card. */
      meldCardIds: CardId[];
    }
  | { type: "display"; seat: Seat; cardIds: CardId[] }
  | { type: "attach"; seat: Seat; setId: string; cardIds: CardId[] }
  | { type: "discard"; seat: Seat; cardId: CardId }
  | { type: "declareDead"; seat: Seat };

export type ActionType = Action["type"];

export type RejectCode =
  | "MATCH_NOT_ACTIVE"
  | "BAD_SEAT"
  | "NOT_YOUR_TURN"
  | "WRONG_PHASE"
  | "STOCK_EMPTY"
  | "STOCK_NOT_EMPTY"
  | "BAD_LINE_INDEX"
  | "CARD_NOT_AVAILABLE"
  | "DUPLICATE_CARDS"
  | "MELD_TOO_SMALL"
  | "INVALID_MELD"
  | "MELD_MISSING_CHOSEN_CARD"
  | "HAND_FLOOR"
  | "WOULD_EMPTY_HAND"
  | "WOULD_STRAND"
  | "NEED_OWN_SET"
  | "SET_NOT_FOUND"
  | "INVALID_ATTACH"
  | "DECLARE_NEEDS_OWN_RUN"
  | "INVALID_CONFIG";

export interface Rejection {
  ok: false;
  code: RejectCode;
  message: string;
}

export interface Applied {
  ok: true;
  state: MatchState;
}

export type ActionResult = Applied | Rejection;

export function reject(code: RejectCode, message: string): Rejection {
  return { ok: false, code, message };
}
