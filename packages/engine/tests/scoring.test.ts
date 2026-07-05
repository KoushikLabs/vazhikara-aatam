import { describe, expect, it } from "vitest";
import { applyAction } from "../src/round.js";
import { scoreRound } from "../src/scoring.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

describe("scoreRound", () => {
  it("credits every table card to the seat that placed it, not the set owner", () => {
    // Seat 0 owns a run; seat 1 attached two cards to it. Seat 1's group also
    // holds one card attached by seat 0.
    const match = mkMatch({
      hands: [["2C"], ["9H", "9C"]],
      sets: [
        {
          kind: "run",
          createdBy: 0,
          cards: ["2D", "3D", "4D", "5D", "6D"],
          placedBy: [0, 0, 0, 1, 1],
        },
        { kind: "group", createdBy: 1, cards: ["KS", "KH", "KD"], placedBy: [1, 1, 0] },
      ],
    });
    const result = scoreRound(match.round!, 2, 0);
    expect(result.tablePoints[0]).toBe(5 + 5 + 5 + 10); // 2♦3♦4♦ + the K♦ attached to seat 1's group
    expect(result.tablePoints[1]).toBe(5 + 5 + 10 + 10); // 5♦6♦ attached + K♠K♥
  });

  it("gives the declarer their table sum and others table minus hand", () => {
    const match = mkMatch({
      hands: [[], ["9H", "9C"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] },
        { kind: "group", createdBy: 1, cards: ["KS", "KH", "KD"] },
      ],
    });
    const result = scoreRound(match.round!, 2, 0);
    expect(result.scores[0]).toBe(15);
    expect(result.scores[1]).toBe(30 - 10);
  });

  it("produces the spec's negative example: 20 on the table, 70 in hand → −50", () => {
    const match = mkMatch({
      hands: [[], ["AS", "AH", "KS", "KH", "QS", "QH"]], // 15+15+10+10+10+10 = 70
      sets: [
        { kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] },
        { kind: "group", createdBy: 1, cards: ["4S", "4H", "4D", "4C"] }, // 20
      ],
    });
    const result = scoreRound(match.round!, 2, 0);
    expect(result.tablePoints[1]).toBe(20);
    expect(result.handPoints[1]).toBe(70);
    expect(result.scores[1]).toBe(-50);
  });

  it("scores a dead round as table minus hand for everyone", () => {
    const match = mkMatch({
      hands: [["2C"], ["AS"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] },
        { kind: "group", createdBy: 1, cards: ["KS", "KH", "KD"] },
      ],
    });
    const result = scoreRound(match.round!, 2, null);
    expect(result.declarer).toBeNull();
    expect(result.scores[0]).toBe(15 - 5);
    expect(result.scores[1]).toBe(30 - 15);
  });

  it("ignores cards left in the discard line — starter, discards, and declare card", () => {
    const match = mkMatch({
      hands: [[], ["9H"]],
      line: ["AC", "AD", "AH", "AS"], // 60 points nobody placed as melds
      sets: [{ kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] }],
    });
    const result = scoreRound(match.round!, 2, 0);
    expect(result.scores[0]).toBe(15);
    expect(result.scores[1]).toBe(-5); // only the 9♥ in hand counts against seat 1
  });
});

describe("end-to-end scoring through the reducer", () => {
  it("keeps attachment points with the attacher when the set owner declares", () => {
    // Seat 1 attaches A♦ to seat 0's run out of turn; seat 0 then declares.
    const match = mkMatch({
      hands: [["8C", "2C"], ["AD", "KH", "QH", "JH", "9C"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] }],
      stock: ["8D"],
      turn: 0,
    });
    // seat 1 needs its own set first, then attaches to seat 0's run
    let state = match;
    for (const action of [
      { type: "display", seat: 1, cardIds: cc(["KH", "QH", "JH"]) } as const,
      { type: "attach", seat: 1, setId: "set-1", cardIds: cc(["AD"]) } as const,
      { type: "drawStock", seat: 0 } as const,
    ]) {
      const result = applyAction(state, action);
      expectOk(result);
      state = result.state;
    }
    // seat 0's hand: 8C 2C 8D → attach nothing, discard down… hand is 3 cards;
    // display is impossible, so discard one and let the round continue — then
    // force the declare by constructing the final discard directly.
    expect(state.round!.sets[0]!.cards).toEqual(cc(["AD", "2D", "3D", "4D"]));
    expect(state.round!.placedBy[c("AD")]).toBe(1);

    // fast-forward: seat 0 declares on a later turn shape
    const endgame = mkMatch({
      hands: [["2C"], ["9C"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["AD", "2D", "3D", "4D"], placedBy: [1, 0, 0, 0] },
        { kind: "run", createdBy: 1, cards: ["JH", "QH", "KH"] },
      ],
      turn: 0,
      phase: "awaitDiscard",
    });
    const declared = applyAction(endgame, { type: "discard", seat: 0, cardId: c("2C") });
    expectOk(declared);
    const result = declared.state.round!.result!;
    expect(result.declarer).toBe(0);
    expect(result.tablePoints[0]).toBe(15); // 2♦ 3♦ 4♦ only — not seat 1's A♦
    expect(result.scores[0]).toBe(15);
    expect(result.tablePoints[1]).toBe(15 + 30); // A♦ attachment + J♥Q♥K♥ run
    expect(result.scores[1]).toBe(45 - 5); // minus the 9♣ in hand
  });
});
