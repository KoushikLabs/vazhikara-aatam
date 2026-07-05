import type { CardId, MatchState, MeldKind, RoundPhase, RoundState, TableSet } from "@vazhikara/engine";

/** "9S" → "9S#1"; "9S#2" passes through. */
export const c = (spec: string): CardId => (spec.includes("#") ? spec : `${spec}#1`);
export const cc = (specs: string[]): CardId[] => specs.map(c);

export interface CraftSpec {
  hands: string[][];
  stock?: string[];
  line?: string[];
  sets?: Array<{ kind: MeldKind; createdBy: number; cards: string[]; placedBy?: number[] }>;
  turn?: number;
  phase?: RoundPhase;
  targetScore?: number;
  totals?: number[];
}

/**
 * Build a precise MatchState to inject into a live room (room.match = craft(...)),
 * so socket-level scenarios can start from an exact table position.
 */
export function craftMatch(spec: CraftSpec): MatchState {
  const playerCount = spec.hands.length;
  const sets: TableSet[] = [];
  const placedBy: Record<CardId, number> = {};
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
    dealer: playerCount - 1,
    hands: spec.hands.map(cc),
    stock: cc(spec.stock ?? ["2C", "3C", "4C"]),
    line: cc(spec.line ?? ["7C"]),
    sets,
    placedBy,
    nextSetId: sets.length + 1,
    result: null,
  };
  return {
    config: { playerCount, decks: 2, targetScore: spec.targetScore ?? 500, seed: 1 },
    phase: "roundActive",
    totals: spec.totals ?? new Array<number>(playerCount).fill(0),
    dealer: round.dealer,
    roundsPlayed: 0,
    round,
    history: [],
    winner: null,
  };
}
