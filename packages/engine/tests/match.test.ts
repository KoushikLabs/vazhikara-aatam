import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/cards.js";
import { applyRoundResult, createMatch, defaultDecks, startNextRound } from "../src/match.js";
import { applyAction } from "../src/round.js";
import { c, expectOk, mkMatch } from "./helpers.js";
import type { RoundState } from "../src/types.js";

describe("match configuration", () => {
  it.each([
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [6, 3],
  ])("defaults %i players to %i deck(s)", (players, decks) => {
    expect(defaultDecks(players)).toBe(decks);
    const created = createMatch({ playerCount: players, seed: 1 });
    expectOk(created);
    expect(created.match.config.decks).toBe(decks);
  });

  it("lets the host override the deck count", () => {
    const created = createMatch({ playerCount: 2, decks: 3, seed: 1 });
    expectOk(created);
    expect(created.match.config.decks).toBe(3);
  });

  it("defaults the target score to 500 and accepts custom targets", () => {
    const def = createMatch({ playerCount: 2, seed: 1 });
    expectOk(def);
    expect(def.match.config.targetScore).toBe(500);
    const custom = createMatch({ playerCount: 2, targetScore: 1000, seed: 1 });
    expectOk(custom);
    expect(custom.match.config.targetScore).toBe(1000);
  });

  it("rejects impossible configs", () => {
    expect(createMatch({ playerCount: 1, seed: 1 })).toMatchObject({ code: "INVALID_CONFIG" });
    expect(createMatch({ playerCount: 7, seed: 1 })).toMatchObject({ code: "INVALID_CONFIG" });
    expect(createMatch({ playerCount: 2, decks: 0, seed: 1 })).toMatchObject({
      code: "INVALID_CONFIG",
    });
    expect(createMatch({ playerCount: 2, decks: 4, seed: 1 })).toMatchObject({
      code: "INVALID_CONFIG",
    });
    // 6 players need 61 cards; one deck has 52
    expect(createMatch({ playerCount: 6, decks: 1, seed: 1 })).toMatchObject({
      code: "INVALID_CONFIG",
    });
    expect(createMatch({ playerCount: 2, targetScore: 0, seed: 1 })).toMatchObject({
      code: "INVALID_CONFIG",
    });
  });
});

describe("round setup", () => {
  it("deals 10 cards each, flips one starter, and leaves the rest as stock", () => {
    for (const [players, decks] of [
      [2, 1],
      [4, 2],
      [6, 3],
    ] as const) {
      const created = createMatch({ playerCount: players, decks, seed: 7 });
      expectOk(created);
      const started = startNextRound(created.match);
      expectOk(started);
      const round = started.state.round!;
      round.hands.forEach((hand) => expect(hand).toHaveLength(10));
      expect(round.line).toHaveLength(1);
      expect(round.stock).toHaveLength(52 * decks - 10 * players - 1);
      expect(round.sets).toEqual([]);
      expect(started.state.phase).toBe("roundActive");
    }
  });

  it("gives the first turn to the player left of the dealer", () => {
    const created = createMatch({ playerCount: 4, seed: 1 });
    expectOk(created);
    const started = startNextRound(created.match);
    expectOk(started);
    expect(started.state.round!.dealer).toBe(0);
    expect(started.state.round!.turn).toBe(1);
  });

  it("deals deterministically for the same seed, differently with an injected RNG", () => {
    const m1 = createMatch({ playerCount: 2, seed: 42 });
    const m2 = createMatch({ playerCount: 2, seed: 42 });
    const m3 = createMatch({ playerCount: 2, seed: 42 });
    expectOk(m1);
    expectOk(m2);
    expectOk(m3);
    const a = startNextRound(m1.match);
    const b = startNextRound(m2.match);
    const alt = startNextRound(m3.match, mulberry32(999));
    expectOk(a);
    expectOk(b);
    expectOk(alt);
    expect(a.state.round!.hands).toEqual(b.state.round!.hands);
    expect(alt.state.round!.hands).not.toEqual(a.state.round!.hands);
  });

  it("refuses to start a round while one is active", () => {
    const created = createMatch({ playerCount: 2, seed: 1 });
    expectOk(created);
    const started = startNextRound(created.match);
    expectOk(started);
    expect(startNextRound(started.state)).toMatchObject({ ok: false, code: "MATCH_NOT_ACTIVE" });
  });
});

function endedRound(scores: number[], declarer: number | null): RoundState {
  const n = scores.length;
  return {
    phase: "ended",
    turn: 0,
    dealer: 0,
    hands: Array.from({ length: n }, () => []),
    stock: [],
    line: [],
    sets: [],
    placedBy: {},
    nextSetId: 1,
    result: {
      declarer,
      tablePoints: scores.map(() => 0),
      handPoints: scores.map(() => 0),
      scores,
    },
  };
}

describe("match accumulation and winning", () => {
  const freshMatch = (targetScore: number, playerCount = 3) => {
    const created = createMatch({ playerCount, targetScore, seed: 1 });
    expectOk(created);
    return created.match;
  };

  it("accumulates round scores, including negatives, and rotates the dealer", () => {
    let match = freshMatch(500);
    match = applyRoundResult(match, endedRound([45, -50, 10], 0));
    expect(match.totals).toEqual([45, -50, 10]);
    expect(match.dealer).toBe(1);
    expect(match.phase).toBe("betweenRounds");
    expect(match.roundsPlayed).toBe(1);
    match = applyRoundResult(match, endedRound([-5, 100, 0], 1));
    expect(match.totals).toEqual([40, 50, 10]);
    expect(match.dealer).toBe(2);
    expect(match.winner).toBeNull();
  });

  it("declares a winner on reaching the target exactly, or exceeding it", () => {
    let match = freshMatch(100);
    match = applyRoundResult(match, endedRound([100, 20, 0], 0));
    expect(match.winner).toBe(0);
    expect(match.phase).toBe("finished");

    let over = freshMatch(100);
    over = applyRoundResult(over, endedRound([130, 20, 0], 0));
    expect(over.winner).toBe(0);
  });

  it("gives the win to the higher total when several players cross together", () => {
    let match = freshMatch(100);
    match = applyRoundResult(match, endedRound([110, 130, 0], 1));
    expect(match.winner).toBe(1);
  });

  it("plays another round when the top crossers are exactly tied", () => {
    let match = freshMatch(100);
    match = applyRoundResult(match, endedRound([120, 120, 0], 0));
    expect(match.winner).toBeNull();
    expect(match.phase).toBe("betweenRounds");
    // the tie breaks next round
    match = applyRoundResult(match, endedRound([15, 0, 0], 0));
    expect(match.winner).toBe(0);
    expect(match.totals).toEqual([135, 120, 0]);
  });

  it("a declare that crosses the target finishes the match through the reducer", () => {
    const match = mkMatch({
      hands: [["2C"], ["9C", "9D"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["10H", "JH", "QH"] }],
      turn: 0,
      phase: "awaitDiscard",
      targetScore: 30,
    });
    const declared = applyAction(match, { type: "discard", seat: 0, cardId: c("2C") });
    expectOk(declared);
    expect(declared.state.phase).toBe("finished");
    expect(declared.state.winner).toBe(0);
    expect(declared.state.totals[0]).toBe(30);
  });
});

describe("guard rails", () => {
  it("rejects actions when no round is active or from a bad seat", () => {
    const created = createMatch({ playerCount: 2, seed: 1 });
    expectOk(created);
    expect(applyAction(created.match, { type: "drawStock", seat: 0 })).toMatchObject({
      ok: false,
      code: "MATCH_NOT_ACTIVE",
    });
    const started = startNextRound(created.match);
    expectOk(started);
    expect(applyAction(started.state, { type: "drawStock", seat: 5 })).toMatchObject({
      ok: false,
      code: "BAD_SEAT",
    });
  });
});
