import { describe, expect, it } from "vitest";
import { applyAction } from "../src/round.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

describe("declaring (going out)", () => {
  it("ends the round when the last card is discarded with an own run displayed", () => {
    const match = mkMatch({
      hands: [["2C"], ["9C", "9D"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] }],
      line: ["7C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const result = applyAction(match, { type: "discard", seat: 0, cardId: c("2C") });
    expectOk(result);
    const state = result.state;
    expect(state.round!.phase).toBe("ended");
    expect(state.round!.result!.declarer).toBe(0);
    expect(state.phase).toBe("betweenRounds");
    // the declare card lands on the line and scores for nobody
    expect(state.round!.line).toEqual(cc(["7C", "2C"]));
    expect(state.round!.result!.tablePoints[0]).toBe(15); // 5+6+7 of hearts only
  });

  it("rejects going out with no own run at all (defense in depth)", () => {
    const match = mkMatch({
      hands: [["2C"], ["9C", "9D"]],
      sets: [{ kind: "group", createdBy: 0, cards: ["8H", "8D", "8C"] }],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(applyAction(match, { type: "discard", seat: 0, cardId: c("2C") })).toMatchObject({
      ok: false,
      code: "DECLARE_NEEDS_OWN_RUN",
    });
  });

  it("does not count cards attached to ANOTHER player's run", () => {
    // Seat 0 attached 5♦ onto seat 1's run (placedBy says so) and displayed
    // only a group of its own — the sequence requirement is not met.
    const match = mkMatch({
      hands: [["2C"], ["9C", "9D"]],
      sets: [
        { kind: "group", createdBy: 0, cards: ["8H", "8D", "8C"] },
        { kind: "run", createdBy: 1, cards: ["2D", "3D", "4D", "5D"], placedBy: [1, 1, 1, 0] },
      ],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(applyAction(match, { type: "discard", seat: 0, cardId: c("2C") })).toMatchObject({
      ok: false,
      code: "DECLARE_NEEDS_OWN_RUN",
    });
  });

  it("counts a run laid down as a pickup's mandatory meld", () => {
    const match = mkMatch({
      hands: [["3D", "4D", "9C"], ["6S", "6H"]],
      line: ["7C", "2D"],
      stock: ["8C"],
      turn: 0,
    });
    const picked = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "3D", "4D"]),
    });
    expectOk(picked);
    const declared = applyAction(picked.state, { type: "discard", seat: 0, cardId: c("9C") });
    expectOk(declared);
    expect(declared.state.round!.result!.declarer).toBe(0);
  });

  it("plays a full declare turn: draw, display run, display group, then declare", () => {
    const match = mkMatch({
      hands: [["5S", "6S", "7S", "QH", "QD", "QC"], ["9C", "9D"]],
      stock: ["8C"],
      turn: 0,
    });
    let state = match;
    const steps = [
      { type: "drawStock", seat: 0 } as const,
      { type: "display", seat: 0, cardIds: cc(["5S", "6S", "7S"]) } as const,
      { type: "display", seat: 0, cardIds: cc(["QH", "QD", "QC"]) } as const,
    ];
    for (const step of steps) {
      const result = applyAction(state, step);
      expectOk(result);
      state = result.state;
    }
    expect(state.round!.hands[0]).toEqual(cc(["8C"]));
    const declared = applyAction(state, { type: "discard", seat: 0, cardId: c("8C") });
    expectOk(declared);
    const result = declared.state.round!.result!;
    expect(result.declarer).toBe(0);
    expect(result.tablePoints[0]).toBe(15 + 30); // 5♠6♠7♠ + Q Q Q
    expect(result.scores[0]).toBe(45);
    expect(result.scores[1]).toBe(-10); // 9♣ 9♦ in hand, nothing on the table
  });
});

describe("dead rounds", () => {
  it("ends with no declarer when the stock is empty and the player passes", () => {
    const match = mkMatch({
      hands: [["2C", "9H"], ["9C", "9D"]],
      sets: [{ kind: "group", createdBy: 1, cards: ["8H", "8D", "8C"] }],
      stock: [],
      turn: 0,
    });
    const result = applyAction(match, { type: "declareDead", seat: 0 });
    expectOk(result);
    const round = result.state.round!;
    expect(round.phase).toBe("ended");
    expect(round.result!.declarer).toBeNull();
    // everyone scores table minus hand
    expect(round.result!.scores[0]).toBe(0 - 10); // 2♣ + 9♥ in hand
    expect(round.result!.scores[1]).toBe(15 - 10); // three 8s on table, two 9s in hand
  });

  it("is available even when a legal pickup exists — passing is the player's choice", () => {
    const match = mkMatch({
      hands: [["3D", "4D", "9C", "8H"], ["6S", "6H"]],
      line: ["7C", "2D"],
      stock: [],
      turn: 0,
    });
    expectOk(applyAction(match, { type: "declareDead", seat: 0 }));
  });

  it("still allows picking up from the line instead of dying", () => {
    const match = mkMatch({
      hands: [["3D", "4D", "9C", "8H"], ["6S", "6H"]],
      line: ["7C", "2D"],
      stock: [],
      turn: 0,
    });
    const picked = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "3D", "4D"]),
    });
    expectOk(picked);
    expect(picked.state.round!.phase).toBe("awaitDiscard");
  });

  it("lets players display sets before the round dies (free actions still work)", () => {
    const match = mkMatch({
      hands: [["2C", "9H"], ["8H", "8D", "8C", "AC"]],
      stock: [],
      turn: 0,
    });
    const displayed = applyAction(match, {
      type: "display",
      seat: 1,
      cardIds: cc(["8H", "8D", "8C"]),
    });
    expectOk(displayed);
    const dead = applyAction(displayed.state, { type: "declareDead", seat: 0 });
    expectOk(dead);
    expect(dead.state.round!.result!.scores[1]).toBe(15 - 15); // banked 15, holds A♣
  });

  it("rejects declaring dead while the stock has cards, out of turn, or after taking", () => {
    const stocked = mkMatch({ hands: [["2C", "9H"], ["9C", "9D"]], stock: ["8C"], turn: 0 });
    expect(applyAction(stocked, { type: "declareDead", seat: 0 })).toMatchObject({
      ok: false,
      code: "STOCK_NOT_EMPTY",
    });
    const empty = mkMatch({ hands: [["2C", "9H"], ["9C", "9D"]], stock: [], turn: 0 });
    expect(applyAction(empty, { type: "declareDead", seat: 1 })).toMatchObject({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
    const afterTake = mkMatch({
      hands: [["2C", "9H"], ["9C", "9D"]],
      stock: [],
      line: ["7C", "2D"],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(applyAction(afterTake, { type: "declareDead", seat: 0 })).toMatchObject({
      ok: false,
      code: "WRONG_PHASE",
    });
  });
});

describe("after the round ends", () => {
  it("rejects every further round action", () => {
    const match = mkMatch({
      hands: [["2C"], ["9C", "9D"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] }],
      turn: 0,
      phase: "awaitDiscard",
    });
    const ended = applyAction(match, { type: "discard", seat: 0, cardId: c("2C") });
    expectOk(ended);
    for (const action of [
      { type: "drawStock", seat: 1 } as const,
      { type: "display", seat: 1, cardIds: cc(["9C", "9D", "9H"]) } as const,
      { type: "discard", seat: 1, cardId: c("9C") } as const,
    ]) {
      expect(applyAction(ended.state, action)).toMatchObject({
        ok: false,
        code: "MATCH_NOT_ACTIVE",
      });
    }
  });
});
