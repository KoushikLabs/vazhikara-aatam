import { sumPoints } from "./cards.js";
import type { RoundResult, RoundState, Seat } from "./types.js";

/**
 * Score a finished round.
 *
 * Every card on the table is credited to the seat that physically placed it —
 * including cards attached to other players' sets (the attacher gets those
 * points, not the set's owner).
 *
 * - Declarer: sum of the card points they placed on the table.
 * - Everyone else (and everyone, in a dead round): placed points minus points
 *   still in hand — this can be negative.
 *
 * Cards remaining in the discard line (including the flipped starter and the
 * declare card) were placed by nobody as melds and score for nobody.
 */
export function scoreRound(round: RoundState, playerCount: number, declarer: Seat | null): RoundResult {
  const tablePoints = new Array<number>(playerCount).fill(0);
  for (const set of round.sets) {
    for (const cardId of set.cards) {
      const placer = round.placedBy[cardId];
      if (placer === undefined) throw new Error(`table card ${cardId} has no placement owner`);
      tablePoints[placer] = (tablePoints[placer] ?? 0) + sumPoints([cardId]);
    }
  }
  const handPoints = round.hands.map((hand) => sumPoints(hand));
  const scores = tablePoints.map((table, seat) =>
    declarer === seat ? table : table - (handPoints[seat] ?? 0),
  );
  return { declarer, tablePoints, handPoints, scores };
}
