import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.js";
import { playPolicyMatch, randomPolicy, type SeatPolicy } from "../src/sim.js";
import type { CardId, MatchState } from "../src/types.js";

/**
 * Fair play is tested two ways:
 *
 * 1. STATIC: bot.ts's source is grepped to prove it never contains an
 *    indexing expression into `round.stock` (beyond `.length`) or into
 *    `round.hands[<otherSeat>]` for a seat other than its own. This is the
 *    literal guarantee from the module's doc comment.
 *
 * 2. DYNAMIC ("hidden invariance"): chooseBotAction's decision must be
 *    IDENTICAL when the *contents* of hidden zones (the stock, and every
 *    other seat's hand) are replaced with a different arrangement of cards
 *    while every COUNT stays the same. If the bot's choice ever depended on
 *    which physical cards are hidden, this test would catch it directly.
 *
 * Deviation from the brief worth flagging explicitly: a literal
 * throw-on-index-access Proxy wrapping round.stock/other hands was tried
 * first, as suggested. It does not work against this engine: `applyAction`
 * validates every candidate action via `structuredClone(match)` internally
 * (chooseBotAction calls it dozens of times per decision to pre-validate
 * candidates), and Node's structuredClone unconditionally throws
 * `DataCloneError` on ANY Proxy-wrapped array — even a fully transparent
 * one — before ever invoking its traps. A getter-based guard (which DOES
 * survive structuredClone) fares no better: it fires once per index on
 * every one of applyAction's internal clones too, so a real peek and the
 * engine's own sanctioned validation clone are indistinguishable by trap
 * invocation alone (verified empirically; see git history of this file).
 * The hidden-invariance test below verifies the same real property —
 * "the decision cannot depend on hidden contents" — without that confound.
 */

const BOT_SRC = (await import("node:fs/promises")).readFile(
  new URL("../src/bot.ts", import.meta.url),
  "utf8",
);

/** Strip // line comments and /* block comments so doc-comment mentions of the forbidden patterns (used to document the rule) don't trip the static check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("fair play — static source check", () => {
  it("never indexes round.stock beyond .length, and only ever indexes round.hands[seat] (never another seat)", async () => {
    const src = stripComments(await BOT_SRC);
    // No numeric/bracket indexing into round.stock at all (only .length and .pop are used, both audited by hand).
    expect(src).not.toMatch(/round\.stock\[/);
    expect(src).not.toMatch(/\.stock\.(slice|indexOf|find|map|filter|forEach|includes|at|join)\(/);
    // Every round.hands[...] access must be the literal `round.hands[seat]` or
    // `working.round!.hands[seat]` pattern — never a different identifier or
    // literal index (which would mean reading another seat's hand).
    const handAccesses = [...src.matchAll(/\.hands\[([^\]]+)\]/g)].map((m) => m[1]!.trim());
    expect(handAccesses.length).toBeGreaterThan(0); // sanity: the pattern actually occurs
    for (const expr of handAccesses) {
      expect(expr).toBe("seat");
    }
  });
});

/** Replace the contents of hidden zones with a different valid arrangement of the SAME multiset of remaining cards, preserving every count exactly. */
function reshuffleHidden(match: MatchState, seat: number, offset: number): MatchState {
  const clone = structuredClone(match) as MatchState;
  const round = clone.round!;
  const hiddenPool: CardId[] = [
    ...round.stock,
    ...round.hands.flatMap((h, s) => (s === seat ? [] : h)),
  ];
  // Rotate the pool deterministically so the exact same multiset of cards
  // gets redistributed differently across the hidden zones' slots.
  const rotated = hiddenPool.map((_, i) => hiddenPool[(i + offset) % hiddenPool.length]!);
  let cursor = 0;
  round.stock = rotated.slice(cursor, cursor + round.stock.length);
  cursor += round.stock.length;
  round.hands = round.hands.map((h, s) => {
    if (s === seat) return h;
    const slice = rotated.slice(cursor, cursor + h.length);
    cursor += h.length;
    return slice;
  });
  return clone;
}

describe("fair play — dynamic hidden-invariance check", () => {
  it("chooseBotAction's decision never depends on WHICH cards are hidden, only on counts/visible state", () => {
    const snapshots: { match: MatchState; seat: number }[] = [];
    const snapshotPolicy = (botSeat: number): SeatPolicy => (match, seat, rng) => {
      if (seat === botSeat) {
        snapshots.push({ match: structuredClone(match) as MatchState, seat });
      }
      return seat === botSeat ? chooseBotAction(match, seat, rng) : randomPolicy(match, seat, rng);
    };

    const configs = [
      { playerCount: 2, decks: 1, botSeat: 0 },
      { playerCount: 3, decks: 2, botSeat: 1 },
      { playerCount: 4, decks: 2, botSeat: 2 },
    ] as const;
    for (const { playerCount, decks, botSeat } of configs) {
      for (const seed of [1, 2, 3, 4]) {
        const policies = new Array<SeatPolicy>(playerCount).fill(randomPolicy);
        policies[botSeat] = snapshotPolicy(botSeat);
        playPolicyMatch({
          playerCount,
          decks,
          seed,
          targetScore: 150,
          maxRounds: 8,
          policies,
        });
      }
    }
    expect(snapshots.length).toBeGreaterThan(30);

    // Multiple fixed RNG values so BOTH decision paths get exercised: 0.05
    // passes the out-of-turn `rng() < 0.4` free-action gate, 0.95 fails it,
    // 0.42 covers mid-threshold behavior. A single constant above 0.4 would
    // leave the out-of-turn path entirely untested.
    for (const rngValue of [0.05, 0.42, 0.95]) {
      const fixedRng = () => rngValue;
      let checked = 0;
      for (const { match, seat } of snapshots) {
        if (match.phase !== "roundActive" || !match.round) continue;
        const hiddenCount = match.round.stock.length + match.round.hands.reduce(
          (n, h, s) => n + (s === seat ? 0 : h.length),
          0,
        );
        if (hiddenCount < 2) continue; // nothing to reshuffle meaningfully
        const original = chooseBotAction(match, seat, fixedRng);
        const reshuffled = chooseBotAction(reshuffleHidden(match, seat, 1), seat, fixedRng);
        expect(reshuffled).toEqual(original);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(20);
    }
  });
});

describe("fair play — deck conservation sanity for the reshuffle helper", () => {
  it("reshuffleHidden preserves the full deck multiset (self-check on the test helper itself)", () => {
    const configs = { playerCount: 3, decks: 2 } as const;
    let seen: MatchState | null = null;
    const policies: SeatPolicy[] = new Array(3).fill(
      (match: MatchState, seat: number, rng: () => number) => {
        if (!seen && match.round) seen = structuredClone(match) as MatchState;
        return randomPolicy(match, seat, rng);
      },
    );
    playPolicyMatch({ ...configs, seed: 1, targetScore: 100, maxRounds: 3, policies });
    expect(seen).not.toBeNull();
    const match = seen as unknown as MatchState;
    const reshuffled = reshuffleHidden(match, 0, 1);
    const zonesOf = (m: MatchState) => [
      ...m.round!.hands.flat(),
      ...m.round!.stock,
      ...m.round!.line,
      ...m.round!.sets.flatMap((s) => s.cards),
    ];
    expect(zonesOf(reshuffled).slice().sort()).toEqual(zonesOf(match).slice().sort());
    // Seat 0's own hand is untouched by the reshuffle.
    expect(reshuffled.round!.hands[0]).toEqual(match.round!.hands[0]);
  });
});
