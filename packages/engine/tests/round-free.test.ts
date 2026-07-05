import { describe, expect, it } from "vitest";
import { applyAction } from "../src/round.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

describe("displaying new sets (free action)", () => {
  it("works on your own turn in either sub-phase", () => {
    const take = mkMatch({ hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]], turn: 0 });
    expectOk(applyAction(take, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }));
    const discardPhase = mkMatch({
      hands: [["7S", "7H", "7D", "2C", "4H"], ["9C", "9D"]],
      turn: 0,
      phase: "awaitDiscard",
    });
    expectOk(
      applyAction(discardPhase, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }),
    );
  });

  it("works OUT OF TURN — during another player's turn, in any sub-phase", () => {
    for (const phase of ["awaitTake", "awaitDiscard"] as const) {
      const match = mkMatch({
        hands: [["2C", "4H", "8D"], ["QS", "KS", "AS", "9D"]],
        turn: 0,
        phase,
      });
      const result = applyAction(match, {
        type: "display",
        seat: 1,
        cardIds: cc(["QS", "KS", "AS"]),
      });
      expectOk(result);
      const round = result.state.round!;
      expect(round.sets[0]).toMatchObject({ kind: "run", createdBy: 1 });
      expect(round.sets[0]!.cards).toEqual(cc(["QS", "KS", "AS"]));
      expect(round.hands[1]).toEqual(cc(["9D"]));
      expect(round.turn).toBe(0); // the turn is unaffected
      expect(round.phase).toBe(phase);
    }
  });

  it("records per-card placement ownership", () => {
    const match = mkMatch({ hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]], turn: 0 });
    const result = applyAction(match, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) });
    expectOk(result);
    for (const id of cc(["7S", "7H", "7D"])) {
      expect(result.state.round!.placedBy[id]).toBe(0);
    }
  });

  it("rejects invalid melds, missing cards, and undersized sets", () => {
    const match = mkMatch({ hands: [["7S", "7H", "8D", "2C"], ["9C", "9D"]], turn: 0 });
    expect(
      applyAction(match, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "8D"]) }),
    ).toMatchObject({ ok: false, code: "INVALID_MELD" });
    expect(
      applyAction(match, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7C"]) }),
    ).toMatchObject({ ok: false, code: "CARD_NOT_AVAILABLE" });
    expect(
      applyAction(match, { type: "display", seat: 0, cardIds: cc(["7S", "7H"]) }),
    ).toMatchObject({ ok: false, code: "MELD_TOO_SMALL" });
  });

  it("rejects the same physical card listed twice", () => {
    const match = mkMatch({ hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]], turn: 0 });
    expect(
      applyAction(match, { type: "display", seat: 0, cardIds: [c("7S"), c("7S"), c("7H")] }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_CARDS" });
  });

  it("enforces the hand floor: a display may never empty the hand", () => {
    const match = mkMatch({ hands: [["7S", "7H", "7D"], ["9C", "9D"]], turn: 1 });
    expect(
      applyAction(match, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }),
    ).toMatchObject({ ok: false, code: "HAND_FLOOR" });
  });

  it("allows melding down to exactly one card out of turn or before taking", () => {
    const outOfTurn = mkMatch({ hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]], turn: 1 });
    expectOk(applyAction(outOfTurn, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }));
    const beforeTake = mkMatch({ hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]], turn: 0 });
    expectOk(applyAction(beforeTake, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }));
  });

  it("blocks the turn player from stranding on one card with no run before the discard", () => {
    const noRun = mkMatch({
      hands: [["7S", "7H", "7D", "2C"], ["9C", "9D"]],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(
      applyAction(noRun, { type: "display", seat: 0, cardIds: cc(["7S", "7H", "7D"]) }),
    ).toMatchObject({ ok: false, code: "WOULD_STRAND" });
    // displaying a RUN down to one card is the declare setup — allowed
    const withRun = mkMatch({
      hands: [["5S", "6S", "7S", "2C"], ["9C", "9D"]],
      turn: 0,
      phase: "awaitDiscard",
    });
    expectOk(applyAction(withRun, { type: "display", seat: 0, cardIds: cc(["5S", "6S", "7S"]) }));
  });
});

describe("attaching to displayed sets (free action)", () => {
  const withSets = () =>
    mkMatch({
      hands: [["5D", "AD", "7C", "9H"], ["AC", "KH", "2H"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] },
        { kind: "group", createdBy: 1, cards: ["AS", "AH", "AD#2"] },
      ],
      turn: 1,
    });

  it("extends your own run in either direction, any time", () => {
    const up = applyAction(withSets(), { type: "attach", seat: 0, setId: "set-1", cardIds: [c("5D")] });
    expectOk(up);
    expect(up.state.round!.sets[0]!.cards).toEqual(cc(["2D", "3D", "4D", "5D"]));
    const down = applyAction(withSets(), {
      type: "attach",
      seat: 0,
      setId: "set-1",
      cardIds: [c("AD")],
    });
    expectOk(down);
    expect(down.state.round!.sets[0]!.cards).toEqual(cc(["AD", "2D", "3D", "4D"]));
  });

  it("attaches to ANY player's set, crediting the attacher, not the set owner", () => {
    // seat 1 attaches its A♣ to seat 0's... no — to its own group; then seat 0
    // attaches to seat 1's group: cross-player attachment.
    const match = mkMatch({
      hands: [["AD", "7C", "9H"], ["AC", "KH", "2H"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["2S", "3S", "4S"] },
        { kind: "group", createdBy: 1, cards: ["AS", "AH", "AD#2"] },
      ],
      turn: 1,
    });
    const result = applyAction(match, {
      type: "attach",
      seat: 0,
      setId: "set-2",
      cardIds: [c("AD")],
    });
    expectOk(result);
    const round = result.state.round!;
    expect(round.sets[1]!.cards).toContain(c("AD"));
    expect(round.sets[1]!.createdBy).toBe(1); // still seat 1's set
    expect(round.placedBy[c("AD")]).toBe(0); // but the card belongs to seat 0
  });

  it("supports multi-card attachments in one action", () => {
    const match = mkMatch({
      hands: [["5D", "6D", "AD", "9H"], ["AC"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] }],
      turn: 1,
    });
    const result = applyAction(match, {
      type: "attach",
      seat: 0,
      setId: "set-1",
      cardIds: cc(["6D", "AD", "5D"]),
    });
    expectOk(result);
    expect(result.state.round!.sets[0]!.cards).toEqual(cc(["AD", "2D", "3D", "4D", "5D", "6D"]));
  });

  it("requires a displayed set of your own first", () => {
    const match = mkMatch({
      hands: [["5D", "AD", "7C"], ["AC", "KH", "2H"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] }],
      turn: 0,
    });
    // seat 1 has no set of their own → cannot attach anywhere
    expect(
      applyAction(match, { type: "attach", seat: 1, setId: "set-1", cardIds: [c("AC")] }),
    ).toMatchObject({ ok: false, code: "NEED_OWN_SET" });
  });

  it("rejects the same physical card attached twice in one action", () => {
    const match = withSets();
    expect(
      applyAction(match, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("5D"), c("5D")] }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_CARDS" });
  });

  it("rejects illegal extensions and unknown sets", () => {
    const match = withSets();
    expect(
      applyAction(match, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("7C")] }),
    ).toMatchObject({ ok: false, code: "INVALID_ATTACH" });
    expect(
      applyAction(match, { type: "attach", seat: 0, setId: "set-2", cardIds: [c("9H")] }),
    ).toMatchObject({ ok: false, code: "INVALID_ATTACH" });
    expect(
      applyAction(match, { type: "attach", seat: 0, setId: "set-9", cardIds: [c("5D")] }),
    ).toMatchObject({ ok: false, code: "SET_NOT_FOUND" });
    expect(
      applyAction(match, { type: "attach", seat: 0, setId: "set-1", cardIds: [] }),
    ).toMatchObject({ ok: false, code: "INVALID_ATTACH" });
  });

  it("enforces the hand floor and the stranding guard", () => {
    const oneCard = mkMatch({
      hands: [["5D"], ["AC", "KH"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] }],
      turn: 1,
    });
    expect(
      applyAction(oneCard, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("5D")] }),
    ).toMatchObject({ ok: false, code: "HAND_FLOOR" });

    // Turn player pre-discard, group displayed but no run: attaching down to
    // one card would leave them unable to finish the turn legally.
    const strand = mkMatch({
      hands: [["9S", "2C"], ["AC", "KH"]],
      sets: [{ kind: "group", createdBy: 0, cards: ["9H", "9D", "9C"] }],
      turn: 0,
      phase: "awaitDiscard",
    });
    expect(
      applyAction(strand, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("9S")] }),
    ).toMatchObject({ ok: false, code: "WOULD_STRAND" });

    // Same attach with an own run on the table is the declare setup — fine.
    const fine = mkMatch({
      hands: [["9S", "2C"], ["AC", "KH"]],
      sets: [
        { kind: "group", createdBy: 0, cards: ["9H", "9D", "9C"] },
        { kind: "run", createdBy: 0, cards: ["4H", "5H", "6H"] },
      ],
      turn: 0,
      phase: "awaitDiscard",
    });
    expectOk(applyAction(fine, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("9S")] }));
  });
});
