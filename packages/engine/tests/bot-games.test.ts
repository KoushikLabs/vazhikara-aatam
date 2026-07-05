import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.js";
import { playPolicyMatch, type SeatPolicy } from "../src/sim.js";

/**
 * Acceptance-level fuzz: many all-bot games across the three representative
 * configs from PLAN.md's deck table. Asserts ZERO violations (illegal
 * actions or own-turn stalls now count, per playPolicyMatch) and that a
 * healthy majority of rounds actually end in a DECLARE — a bot that never
 * declares is broken; random play alone already reaches dead rounds
 * routinely, so bots must clearly do better.
 *
 * Game count is overridable via VAZ_BOT_GAMES for a bigger acceptance run;
 * default is tuned to keep the whole engine suite under ~90s.
 */
describe("bot-games acceptance fuzz", () => {
  const totalGames = Math.max(3, Number(process.env.VAZ_BOT_GAMES ?? 150));
  const configs = [
    { playerCount: 2, decks: 1 },
    { playerCount: 3, decks: 2 },
    { playerCount: 4, decks: 2 },
  ] as const;
  // Distribute the remainder so the run plays EXACTLY totalGames games
  // (1000 must mean 1000 — the acceptance bar is literal).
  const gamesForConfig = configs.map((_, i) =>
    Math.floor(totalGames / configs.length) + (i < totalGames % configs.length ? 1 : 0),
  );

  it(`plays ${totalGames} all-bot games with zero violations, zero unfinished matches, and a high declare rate`, () => {
    let declared = 0;
    let dead = 0;
    let unfinished = 0;
    const violations: string[] = [];
    let gamesPlayed = 0;

    for (const [configIndex, { playerCount, decks }] of configs.entries()) {
      const policies: SeatPolicy[] = new Array(playerCount).fill(chooseBotAction);
      for (let seed = 1; seed <= gamesForConfig[configIndex]!; seed++) {
        const result = playPolicyMatch({
          playerCount,
          decks,
          seed: seed * 1000 + playerCount, // distinct seed space per config
          targetScore: 250,
          maxRounds: 20,
          policies,
        });
        violations.push(...result.violations);
        declared += result.declaredRounds;
        dead += result.deadRounds;
        // A match that exhausts maxRounds without a winner is a silent
        // truncation, not a completed game — count it as a failure.
        if (result.match.phase !== "finished") unfinished += 1;
        gamesPlayed += 1;
      }
    }

    expect(violations).toEqual([]);
    expect(unfinished).toBe(0);
    expect(gamesPlayed).toBe(totalGames);
    const totalRounds = declared + dead;
    expect(totalRounds).toBeGreaterThan(0);
    const declareRate = declared / totalRounds;
    // eslint-disable-next-line no-console
    console.log(`bot-games: games=${gamesPlayed} rounds=${totalRounds} declared=${declared} dead=${dead} declareRate=${declareRate.toFixed(3)}`);
    // The random-legal baseline already reaches ~0.85 declare rate on these
    // configs — the bot measures ~0.98, so 0.95 is the meaningful bar.
    expect(declareRate).toBeGreaterThan(0.95);
  }, 180_000);
});
