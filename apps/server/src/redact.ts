import type { MatchState } from "@vazhikara/engine";
import type { RedactedMatch } from "./protocol.js";

/**
 * Build the view of the match a given seat is allowed to see: their own hand
 * in full, everyone else's hand and the stock as counts only. The line, the
 * table sets, placement ownership, scores, and round results are public.
 */
export function redactMatch(match: MatchState, viewerSeat: number): RedactedMatch {
  const round = match.round;
  // Rebuild the config field-by-field: the seed must never reach a client —
  // the deterministic deal could be replayed from it, exposing all hands and
  // the stock order.
  const { playerCount, decks, targetScore } = match.config;
  return {
    config: { playerCount, decks, targetScore },
    phase: match.phase,
    totals: [...match.totals],
    dealer: match.dealer,
    roundsPlayed: match.roundsPlayed,
    winner: match.winner,
    history: structuredClone(match.history),
    round: round
      ? {
          phase: round.phase,
          turn: round.turn,
          dealer: round.dealer,
          line: [...round.line],
          sets: structuredClone(round.sets),
          placedBy: { ...round.placedBy },
          stockCount: round.stock.length,
          handCounts: round.hands.map((hand) => hand.length),
          hands: round.hands.map((hand, seat) => (seat === viewerSeat ? [...hand] : null)),
          result: round.result ? structuredClone(round.result) : null,
        }
      : null,
  };
}
