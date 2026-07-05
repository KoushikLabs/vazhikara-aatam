import { describe, expect, it } from "vitest";
import { playRandomMatch } from "../src/sim.js";

/**
 * Full simulated games driven by random legal moves. Invariants (card
 * conservation across zones, placement ownership coverage, canonical run
 * storage, no mid-round empty hands, no stalls) are checked after EVERY
 * applied action inside playRandomMatch.
 */
describe("random-legal-move fuzzing", () => {
  const configs = [
    { playerCount: 2, decks: 1 },
    { playerCount: 3, decks: 2 },
    { playerCount: 4, decks: 2 },
    { playerCount: 6, decks: 3 },
  ] as const;

  it.each(configs)("plays clean games with %o", ({ playerCount, decks }) => {
    for (const seed of [1, 2, 3]) {
      const result = playRandomMatch({
        playerCount,
        decks,
        seed,
        targetScore: 100,
        maxRounds: 12,
      });
      expect(result.violations).toEqual([]);
      expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
      expect(result.actionsApplied).toBeGreaterThan(50);
    }
  });

  it("exercises every outcome and action type across the batch — a broken move generator cannot pass silently", () => {
    // Dead rounds need the stock to drain (common in tight 2p/1d games);
    // pickups and attaches thrive on multi-deck duplicates (3p/2d). Accumulate
    // over both so every action type and both round outcomes must appear.
    const batches = [
      { playerCount: 2, decks: 1, seeds: [1, 2, 3, 4, 5, 6, 7, 8] },
      { playerCount: 3, decks: 2, seeds: [1, 2, 3, 4, 5] },
    ] as const;
    let declared = 0;
    let dead = 0;
    const totals: Record<string, number> = {};
    for (const { playerCount, decks, seeds } of batches) {
      for (const seed of seeds) {
        const result = playRandomMatch({
          playerCount,
          decks,
          seed,
          targetScore: 100,
          maxRounds: 12,
        });
        expect(result.violations).toEqual([]);
        declared += result.declaredRounds;
        dead += result.deadRounds;
        for (const [type, count] of Object.entries(result.actionCounts)) {
          totals[type] = (totals[type] ?? 0) + count;
        }
      }
    }
    expect(declared).toBeGreaterThan(0);
    expect(dead).toBeGreaterThan(0);
    for (const type of ["drawStock", "pickupLine", "display", "attach", "discard", "declareDead"]) {
      expect(totals[type], `${type} never occurred across the fuzz batch`).toBeGreaterThan(0);
    }
  });

  it("is fully deterministic for a given seed", () => {
    const a = playRandomMatch({ playerCount: 3, decks: 2, seed: 11, targetScore: 60, maxRounds: 8 });
    const b = playRandomMatch({ playerCount: 3, decks: 2, seed: 11, targetScore: 60, maxRounds: 8 });
    expect(a.violations).toEqual([]);
    expect(a.actionsApplied).toBe(b.actionsApplied);
    expect(a.match.totals).toEqual(b.match.totals);
    expect(a.match).toEqual(b.match);
  });
});
