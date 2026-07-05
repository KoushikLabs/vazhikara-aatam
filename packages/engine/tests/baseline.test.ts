import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.js";
import { playPolicyMatch, randomPolicy, type SeatPolicy } from "../src/sim.js";

/**
 * The heuristic bot must decisively outperform the Phase 1 random-legal-move
 * baseline — not just squeak by. Deterministic seeds, no live randomness
 * beyond the seeded RNG threaded through every policy.
 *
 * Seat assignments ALTERNATE between games (bot-first on even seeds,
 * random-first on odd) so first-turn/dealer-position advantages cannot
 * confound the comparison; results are aggregated by POLICY, not by seat.
 *
 * Decisiveness bars (measured values have wide margin above them):
 * - 2p heads-up ~100 games: bot win rate >= 0.8 AND mean-total gap >= 75.
 * - 4p mixed (2 bots + 2 randoms) ~50 games: bot share of decided games
 *   >= 0.75 AND mean per-seat total gap >= 75. Absolute gaps are used
 *   because random-seat totals can be negative (a ratio would flip sign).
 */
describe("baseline: heuristic bot vs random-legal-move policy", () => {
  it("wins decisively heads-up (2p, 1 deck) with alternating seats", () => {
    const games = Number(process.env.VAZ_BASELINE_GAMES ?? 100);
    let botWins = 0;
    let randomWins = 0;
    let botTotalSum = 0;
    let randomTotalSum = 0;
    let played = 0;
    for (let seed = 1; seed <= games; seed++) {
      const botSeat = seed % 2; // alternate who sits first
      const policies: SeatPolicy[] = botSeat === 0 ? [chooseBotAction, randomPolicy] : [randomPolicy, chooseBotAction];
      const result = playPolicyMatch({
        playerCount: 2,
        decks: 1,
        seed: seed * 7919, // large prime stride, avoids accidental correlation with other suites' seeds
        targetScore: 300,
        maxRounds: 25,
        policies,
      });
      expect(result.violations).toEqual([]);
      if (result.match.winner === botSeat) botWins += 1;
      else if (result.match.winner !== null) randomWins += 1;
      botTotalSum += result.totalsBySeat[botSeat] ?? 0;
      randomTotalSum += result.totalsBySeat[1 - botSeat] ?? 0;
      played += 1;
    }
    const decided = botWins + randomWins;
    const winRate = decided > 0 ? botWins / decided : 0;
    const meanBot = botTotalSum / played;
    const meanRandom = randomTotalSum / played;
    // eslint-disable-next-line no-console
    console.log(
      `heads-up baseline: games=${played} botWins=${botWins} randomWins=${randomWins} winRate=${winRate.toFixed(3)} ` +
        `meanBotTotal=${meanBot.toFixed(1)} meanRandomTotal=${meanRandom.toFixed(1)}`,
    );
    expect(played).toBe(games);
    expect(winRate).toBeGreaterThanOrEqual(0.8);
    expect(meanBot - meanRandom).toBeGreaterThanOrEqual(75);
  }, 120_000);

  it("beats mixed random seats decisively (4p, 2 bots + 2 randoms) with alternating blocks", () => {
    const games = Number(process.env.VAZ_BASELINE_GAMES_4P ?? 50);
    let botTotalSum = 0;
    let randomTotalSum = 0;
    let botWins = 0;
    let randomWins = 0;
    let played = 0;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate which block of seats the bots occupy so neither policy
      // systematically owns the opening turn or the dealer-adjacent seats.
      const botSeats = seed % 2 === 0 ? [0, 1] : [2, 3];
      const policies: SeatPolicy[] = [0, 1, 2, 3].map((s) =>
        botSeats.includes(s) ? chooseBotAction : randomPolicy,
      );
      const result = playPolicyMatch({
        playerCount: 4,
        decks: 2,
        seed: seed * 104729, // distinct large-prime stride from the 2p suite
        targetScore: 300,
        maxRounds: 25,
        policies,
      });
      expect(result.violations).toEqual([]);
      const totals = result.totalsBySeat;
      for (const s of [0, 1, 2, 3]) {
        if (botSeats.includes(s)) botTotalSum += totals[s] ?? 0;
        else randomTotalSum += totals[s] ?? 0;
      }
      if (result.match.winner !== null) {
        if (botSeats.includes(result.match.winner)) botWins += 1;
        else randomWins += 1;
      }
      played += 1;
    }
    const meanBotTotal = botTotalSum / (played * 2);
    const meanRandomTotal = randomTotalSum / (played * 2);
    const decided = botWins + randomWins;
    const botShare = decided > 0 ? botWins / decided : 0;
    // eslint-disable-next-line no-console
    console.log(
      `4p mixed baseline: games=${played} botWins=${botWins} randomWins=${randomWins} botShare=${botShare.toFixed(3)} ` +
        `meanBotSeatTotal=${meanBotTotal.toFixed(1)} meanRandomSeatTotal=${meanRandomTotal.toFixed(1)}`,
    );
    expect(played).toBe(games);
    expect(botShare).toBeGreaterThanOrEqual(0.75);
    expect(meanBotTotal - meanRandomTotal).toBeGreaterThanOrEqual(75);
  }, 120_000);
});
