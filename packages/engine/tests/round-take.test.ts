import { describe, expect, it } from "vitest";
import { applyAction } from "../src/round.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

describe("drawing from stock", () => {
  it("moves the top stock card to the hand and awaits the discard", () => {
    const match = mkMatch({
      hands: [["2S", "5H"], ["9C", "9D"]],
      stock: ["4C", "8D"],
      turn: 0,
    });
    const result = applyAction(match, { type: "drawStock", seat: 0 });
    expectOk(result);
    const round = result.state.round!;
    expect(round.hands[0]).toEqual(cc(["2S", "5H", "8D"])); // top = last stock element
    expect(round.stock).toEqual(cc(["4C"]));
    expect(round.phase).toBe("awaitDiscard");
    // input state untouched
    expect(match.round!.hands[0]).toHaveLength(2);
  });

  it("rejects drawing out of turn, twice, or from an empty stock", () => {
    const base = mkMatch({ hands: [["2S", "5H"], ["9C", "9D"]], turn: 0 });
    expect(applyAction(base, { type: "drawStock", seat: 1 })).toMatchObject({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
    const drawn = applyAction(base, { type: "drawStock", seat: 0 });
    expectOk(drawn);
    expect(applyAction(drawn.state, { type: "drawStock", seat: 0 })).toMatchObject({
      ok: false,
      code: "WRONG_PHASE",
    });
    const empty = mkMatch({ hands: [["2S", "5H"], ["9C", "9D"]], stock: [], turn: 0 });
    expect(applyAction(empty, { type: "drawStock", seat: 0 })).toMatchObject({
      ok: false,
      code: "STOCK_EMPTY",
    });
  });
});

describe("discarding", () => {
  it("appends to the line, passes the turn clockwise, wraps at the last seat", () => {
    const match = mkMatch({
      hands: [["2S", "5H"], ["9C"], ["9D"]],
      line: ["7C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const result = applyAction(match, { type: "discard", seat: 0, cardId: c("5H") });
    expectOk(result);
    const round = result.state.round!;
    expect(round.line).toEqual(cc(["7C", "5H"]));
    expect(round.hands[0]).toEqual(cc(["2S"]));
    expect(round.turn).toBe(1);
    expect(round.phase).toBe("awaitTake");

    const last = mkMatch({
      hands: [["2S"], ["9C"], ["9D", "4H"]],
      turn: 2,
      phase: "awaitDiscard",
    });
    const wrapped = applyAction(last, { type: "discard", seat: 2, cardId: c("4H") });
    expectOk(wrapped);
    expect(wrapped.state.round!.turn).toBe(0);
  });

  it("rejects discarding before taking cards, out of turn, or a card you don't hold", () => {
    const awaitingTake = mkMatch({ hands: [["2S", "5H"], ["9C"]], turn: 0 });
    expect(applyAction(awaitingTake, { type: "discard", seat: 0, cardId: c("2S") })).toMatchObject(
      { ok: false, code: "WRONG_PHASE" },
    );
    const awaitingDiscard = mkMatch({
      hands: [["2S", "5H"], ["9C"]],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(
      applyAction(awaitingDiscard, { type: "discard", seat: 1, cardId: c("9C") }),
    ).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    expect(
      applyAction(awaitingDiscard, { type: "discard", seat: 0, cardId: c("9C") }),
    ).toMatchObject({ ok: false, code: "CARD_NOT_AVAILABLE" });
  });
});

describe("picking up from the discard line", () => {
  // The spec's own example: line A♠ 2♦ J♥ K♣, take from the 2♦.
  const specExample = () =>
    mkMatch({
      hands: [["3D", "4D", "9C", "8H"], ["6S", "6H"]],
      line: ["AS", "2D", "JH", "KC"],
      turn: 0,
    });

  it("scoops the chosen card plus everything after it and lays the mandatory new set", () => {
    const result = applyAction(specExample(), {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "3D", "4D"]),
    });
    expectOk(result);
    const round = result.state.round!;
    expect(round.line).toEqual(cc(["AS"]));
    expect(round.sets).toHaveLength(1);
    expect(round.sets[0]).toMatchObject({ kind: "run", createdBy: 0 });
    expect(round.sets[0]!.cards).toEqual(cc(["2D", "3D", "4D"]));
    // the other scooped cards (J♥, K♣) went to the hand
    expect([...round.hands[0]!].sort()).toEqual(cc(["9C", "8H", "JH", "KC"]).sort());
    for (const id of cc(["2D", "3D", "4D"])) {
      expect(round.placedBy[id]).toBe(0);
    }
    expect(round.phase).toBe("awaitDiscard");
  });

  it("accepts a group as the mandatory set too", () => {
    const match = mkMatch({
      hands: [["2H", "2S", "9C", "8H"], ["6S", "6H"]],
      line: ["AS", "2D", "JH", "KC"],
      turn: 0,
    });
    const result = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "2H", "2S"]),
    });
    expectOk(result);
    expect(result.state.round!.sets[0]).toMatchObject({ kind: "group", createdBy: 0 });
  });

  it("enforces the mandatory meld even at depth 1 (most recent discard)", () => {
    const match = mkMatch({
      hands: [["KD", "KH", "9C", "8H"], ["6S", "6H"]],
      line: ["AS", "2D", "JH", "KC"],
      turn: 0,
    });
    const good = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 3,
      meldCardIds: cc(["KC", "KD", "KH"]),
    });
    expectOk(good);
    expect(good.state.round!.line).toEqual(cc(["AS", "2D", "JH"]));
    expect(good.state.round!.hands[0]).toEqual(cc(["9C", "8H"]));
  });

  it("allows the meld to come entirely from the scooped cards", () => {
    const match = mkMatch({
      hands: [["9C", "8H"], ["6S", "6H"]],
      line: ["AS", "5D", "6D", "7D"],
      turn: 0,
    });
    const result = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["5D", "6D", "7D"]),
    });
    expectOk(result);
    expect(result.state.round!.hands[0]).toEqual(cc(["9C", "8H"]));
    expect(result.state.round!.line).toEqual(cc(["AS"]));
  });

  it("can empty the line by taking the flipped starter card", () => {
    const match = mkMatch({
      hands: [["7H", "7S", "9C", "8H"], ["6S", "6H"]],
      line: ["7C"],
      turn: 0,
    });
    const result = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 0,
      meldCardIds: cc(["7C", "7H", "7S"]),
    });
    expectOk(result);
    expect(result.state.round!.line).toEqual([]);
  });

  it("melds hand cards and non-chosen scooped cards together", () => {
    const match = mkMatch({
      hands: [["2S", "9C", "8H"], ["6S", "6H"]],
      line: ["AS", "2D", "2H", "KC"],
      turn: 0,
    });
    const result = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "2H", "2S"]), // chosen + scooped + hand
    });
    expectOk(result);
    const round = result.state.round!;
    expect(round.line).toEqual(cc(["AS"]));
    expect([...round.hands[0]!].sort()).toEqual(cc(["9C", "8H", "KC"]).sort());
    expect(round.sets[0]!.cards.slice().sort()).toEqual(cc(["2D", "2H", "2S"]).sort());
  });

  it("rejects a meld using a line card SHALLOWER than the chosen one — it was not scooped", () => {
    // 2♥ sits before the chosen 2♦ in the line: it stays in the line and is
    // not available to the mandatory meld.
    const match = mkMatch({
      hands: [["2S", "9C", "8H"], ["6S", "6H"]],
      line: ["2H", "7C", "2D"],
      turn: 0,
    });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 2,
        meldCardIds: cc(["2D", "2H", "2S"]),
      }),
    ).toMatchObject({ ok: false, code: "CARD_NOT_AVAILABLE" });
  });

  it("rejects a meld using cards from the stock or another player's hand", () => {
    const match = mkMatch({
      hands: [["2S", "9C", "8H"], ["2C", "6H"]],
      stock: ["2H"],
      line: ["7C", "2D"],
      turn: 0,
    });
    for (const outside of ["2H", "2C"]) {
      expect(
        applyAction(match, {
          type: "pickupLine",
          seat: 0,
          lineIndex: 1,
          meldCardIds: cc(["2D", "2S", outside]),
        }),
      ).toMatchObject({ ok: false, code: "CARD_NOT_AVAILABLE" });
    }
  });

  it("rejects a meld that does not include the chosen (deepest) card", () => {
    const match = mkMatch({
      hands: [["3D", "4D", "5D", "8H"], ["6S", "6H"]],
      line: ["AS", "2D", "JH", "KC"],
      turn: 0,
    });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 1,
        meldCardIds: cc(["3D", "4D", "5D"]),
      }),
    ).toMatchObject({ ok: false, code: "MELD_MISSING_CHOSEN_CARD" });
  });

  it("rejects using table cards — the mandatory set must be brand-new, not an attachment", () => {
    // Seat 0 already displays 3♦ 4♦ 5♦; the 2♦ in the line would extend it,
    // but that never satisfies a pickup.
    const match = mkMatch({
      hands: [["9C", "8H", "KD"], ["6S", "6H"]],
      line: ["AS", "2D"],
      sets: [{ kind: "run", createdBy: 0, cards: ["3D", "4D", "5D"] }],
      turn: 0,
    });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 1,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    ).toMatchObject({ ok: false, code: "CARD_NOT_AVAILABLE" });
  });

  it("rejects melds that are too small, invalid, duplicated, or from a bad line index", () => {
    const match = specExample();
    expect(
      applyAction(match, { type: "pickupLine", seat: 0, lineIndex: 1, meldCardIds: cc(["2D", "3D"]) }),
    ).toMatchObject({ ok: false, code: "MELD_TOO_SMALL" });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 1,
        meldCardIds: cc(["2D", "9C", "8H"]),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_MELD" });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 1,
        meldCardIds: [c("2D"), c("3D"), c("3D")],
      }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_CARDS" });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 9,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    ).toMatchObject({ ok: false, code: "BAD_LINE_INDEX" });
  });

  it("rejects pickups out of turn or after already taking", () => {
    const match = specExample();
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 1,
        lineIndex: 1,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    ).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    const drawn = applyAction(match, { type: "drawStock", seat: 0 });
    expectOk(drawn);
    expect(
      applyAction(drawn.state, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 1,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    ).toMatchObject({ ok: false, code: "WRONG_PHASE" });
  });

  it("rejects a pickup that would leave no card to discard", () => {
    // Hand 3♦ 4♦, line ends 2♦: melding all of it leaves an empty hand.
    const match = mkMatch({
      hands: [["3D", "4D"], ["6S", "6H"]],
      line: ["2D"],
      turn: 0,
    });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 0,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    ).toMatchObject({ ok: false, code: "WOULD_EMPTY_HAND" });
  });

  it("rejects a pickup stranding the player on one card with no run of their own", () => {
    const match = mkMatch({
      hands: [["2H", "2S", "9C"], ["6S", "6H"]],
      line: ["2D"],
      turn: 0,
    });
    expect(
      applyAction(match, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 0,
        meldCardIds: cc(["2D", "2H", "2S"]),
      }),
    ).toMatchObject({ ok: false, code: "WOULD_STRAND" });
    // ... but the same shape is fine when the mandatory meld itself is a run
    const runMatch = mkMatch({
      hands: [["3D", "4D", "9C"], ["6S", "6H"]],
      line: ["2D"],
      turn: 0,
    });
    expectOk(
      applyAction(runMatch, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 0,
        meldCardIds: cc(["2D", "3D", "4D"]),
      }),
    );
    // ... or when a run of their own is already displayed
    const withRun = mkMatch({
      hands: [["2H", "2S", "9C"], ["6S", "6H"]],
      line: ["2D"],
      sets: [{ kind: "run", createdBy: 0, cards: ["5H", "6H", "7H"] }],
      turn: 0,
    });
    expectOk(
      applyAction(withRun, {
        type: "pickupLine",
        seat: 0,
        lineIndex: 0,
        meldCardIds: cc(["2D", "2H", "2S"]),
      }),
    );
  });
});
