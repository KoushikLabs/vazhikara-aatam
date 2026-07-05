import type {
  CardId,
  MatchState,
  MeldKind,
  RoundPhase,
  RoundState,
  Seat,
  TableSet,
} from "../src/types.js";

/** Card spec shorthand: "9S" → "9S#1"; "9S#2" passes through. */
export function c(spec: string): CardId {
  return spec.includes("#") ? spec : `${spec}#1`;
}

export function cc(specs: string[]): CardId[] {
  return specs.map(c);
}

export interface SetSpec {
  kind: MeldKind;
  createdBy: Seat;
  cards: string[];
  /** Per-card placer override; defaults to createdBy for every card. */
  placedBy?: Seat[];
}

export interface StateSpec {
  hands: string[][];
  stock?: string[];
  line?: string[];
  sets?: SetSpec[];
  turn?: Seat;
  phase?: RoundPhase;
  dealer?: Seat;
  decks?: number;
  targetScore?: number;
  totals?: number[];
}

/**
 * Build a MatchState directly for targeted scenarios. Zones are taken as
 * given — unit tests construct exactly the situation they need; the fuzz
 * suite covers full-game card conservation.
 */
export function mkMatch(spec: StateSpec): MatchState {
  const playerCount = spec.hands.length;
  const sets: TableSet[] = [];
  const placedBy: Record<CardId, Seat> = {};
  (spec.sets ?? []).forEach((s, i) => {
    const cards = cc(s.cards);
    sets.push({ id: `set-${i + 1}`, kind: s.kind, createdBy: s.createdBy, cards });
    cards.forEach((id, j) => {
      placedBy[id] = s.placedBy?.[j] ?? s.createdBy;
    });
  });
  const round: RoundState = {
    phase: spec.phase ?? "awaitTake",
    turn: spec.turn ?? 0,
    dealer: spec.dealer ?? playerCount - 1,
    hands: spec.hands.map(cc),
    stock: cc(spec.stock ?? ["2C", "3C", "4C"]),
    line: cc(spec.line ?? ["7C"]),
    sets,
    placedBy,
    nextSetId: sets.length + 1,
    result: null,
  };
  return {
    config: {
      playerCount,
      decks: spec.decks ?? 2,
      targetScore: spec.targetScore ?? 500,
      seed: 1,
    },
    phase: "roundActive",
    totals: spec.totals ?? new Array<number>(playerCount).fill(0),
    dealer: round.dealer,
    roundsPlayed: 0,
    round,
    history: [],
    winner: null,
  };
}

export function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  if (!result.ok) {
    const r = result as unknown as { code: string; message: string };
    throw new Error(`expected ok, got rejection ${r.code}: ${r.message}`);
  }
}
