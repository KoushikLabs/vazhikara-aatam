/**
 * Black-box conformance tests, batch A.
 *
 * Every expectation here is derived from PLAN.md Part 1 (game rules) ONLY —
 * never from the implementation and never from standard rummy conventions.
 * Each test cites the spec passage it enforces.
 *
 * Focus areas: meld legality (circular runs, wrap seams, duplicates, groups
 * with multi-deck copies) and discard-line pickup mechanics (scoop depth,
 * the mandatory brand-new meld containing the chosen card, meld sourcing,
 * leftovers to hand, line truncation).
 */
import { describe, expect, it } from "vitest";
import { applyAction, classifyMeld, isValidGroup, isValidRun } from "../src/index.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe("circular run legality (spec: 'Rank order is circular ... K and A are adjacent. Direction does not matter.')", () => {
  it("accepts Q-K-A — the wrap on the high side of the ace", () => {
    // K-A adjacency works from both directions, not just K-A-2.
    expect(isValidRun(cc(["QH", "KH", "AH"]))).toBe(true);
    // "Direction does not matter" and input order must not matter either.
    expect(isValidRun(cc(["KH", "AH", "QH"]))).toBe(true);
    expect(isValidRun(cc(["AH", "QH", "KH"]))).toBe(true);
    expect(classifyMeld(cc(["QH", "KH", "AH"]))).toBe("run");
  });

  it("accepts a 12-card circular run missing only the queen (K-A-2-...-J)", () => {
    // Circularly contiguous even though a linear sort sees a J→K gap.
    const ids = cc(["KH", "AH", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH"]);
    expect(isValidRun(ids)).toBe(true);
  });

  it("rejects 13 cards with a duplicated rank standing in for a missing one", () => {
    // Spec: "Each rank may appear at most once per run" — a naive
    // length-13 = full-circle shortcut would wrongly accept this.
    const ids = cc([
      "AS", "2S", "3S", "4S", "5S", "5S#2", "6S", "7S", "8S", "10S", "JS", "QS", "KS",
    ]);
    expect(isValidRun(ids)).toBe(false);
  });

  it("rejects a mixed suit exactly at the K-A wrap seam", () => {
    // Spec: runs are "all of the same suit ... never mixed suits" — the
    // wrap seam gets no special exemption.
    expect(isValidRun(cc(["KS", "AS", "2H"]))).toBe(false);
    expect(isValidRun(cc(["KS", "AH", "2S"]))).toBe(false);
  });

  it("rejects two separated segments even when one of them wraps K-A", () => {
    // K-A-2 and 6-7-8 are each contiguous, but the combined six cards are
    // not "consecutive-rank cards": the circle has two gaps (3-5 and 9-Q).
    expect(isValidRun(cc(["KS", "AS", "2S", "6S", "7S", "8S"]))).toBe(false);
  });

  it("rejects a duplicate rank sitting on the wrap seam (K-A-2 plus a second ace)", () => {
    // "no duplicates within a run, even with multiple decks"
    expect(isValidRun(cc(["KS", "AS", "2S", "AS#2"]))).toBe(false);
  });
});

describe("group legality with multi-deck copies (spec: 'identical duplicates are legal in a group')", () => {
  it("accepts three identical copies of the very same physical card (three decks)", () => {
    // 9♠ 9♠ 9♠ from three decks: same rank, suits unrestricted.
    expect(isValidGroup(["9S#1", "9S#2", "9S#3"])).toBe(true);
    expect(classifyMeld(["9S#1", "9S#2", "9S#3"])).toBe("group");
  });
});

describe("displaying a wrap run as a free action (spec: displays allowed 'at ANY time, even during other players' turns')", () => {
  it("lets a non-turn player display Q-K-A and records per-card ownership", () => {
    const match = mkMatch({
      hands: [
        ["2C", "3C", "4C", "5C", "6C"],
        ["QD", "KD", "AD", "9C", "10C"],
      ],
      stock: ["2H", "3H", "4H"],
      line: ["7C"],
      turn: 0,
      phase: "awaitTake",
    });
    const res = applyAction(match, { type: "display", seat: 1, cardIds: cc(["QD", "KD", "AD"]) });
    expectOk(res);
    const round = res.state.round!;
    expect(round.sets).toHaveLength(1);
    expect(round.sets[0]!.kind).toBe("run");
    expect(round.sets[0]!.createdBy).toBe(1);
    expect(sorted(round.sets[0]!.cards)).toEqual(sorted(cc(["QD", "KD", "AD"])));
    // Spec (scoring): "Every card on the table is credited to the player who
    // physically placed it" — the engine must track placement per card.
    for (const id of cc(["QD", "KD", "AD"])) {
      expect(round.placedBy[id]).toBe(1);
    }
    expect(sorted(round.hands[1]!)).toEqual(sorted(cc(["9C", "10C"])));
    // The display never touches whose turn it is.
    expect(round.turn).toBe(0);
    expect(round.phase).toBe("awaitTake");
  });
});

describe("line pickup — the spec's own worked example (line A♠ 2♦ J♥ K♣, take from the 2♦)", () => {
  it("scoops 2♦ J♥ K♣, lays 2♦ 3♦ 4♦, leftovers go to hand, line truncates to A♠", () => {
    const match = mkMatch({
      hands: [
        ["3D", "4D", "9C", "10C"],
        ["5H", "6H", "7H", "8H", "9H"],
      ],
      line: ["AS", "2D", "JH", "KC"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
      phase: "awaitTake",
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["2D", "3D", "4D"]),
    });
    expectOk(res);
    const round = res.state.round!;
    // Line truncation: everything from the chosen card onward left the line;
    // the prefix stays, in order.
    expect(round.line).toEqual([c("AS")]);
    // The mandatory brand-new set, containing the chosen card.
    expect(round.sets).toHaveLength(1);
    expect(round.sets[0]!.kind).toBe("run");
    expect(round.sets[0]!.createdBy).toBe(0);
    expect(sorted(round.sets[0]!.cards)).toEqual(sorted(cc(["2D", "3D", "4D"])));
    for (const id of cc(["2D", "3D", "4D"])) {
      expect(round.placedBy[id]).toBe(0);
    }
    // "The other scooped cards simply go into your hand."
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["9C", "10C", "JH", "KC"])));
    // Taking cards does not end the turn: the discard is still owed.
    expect(round.turn).toBe(0);
    expect(round.phase).toBe("awaitDiscard");

    // The subsequent discard appends after the surviving prefix.
    const res2 = applyAction(res.state, { type: "discard", seat: 0, cardId: c("9C") });
    expectOk(res2);
    expect(res2.state.round!.line).toEqual(cc(["AS", "9C"]));
    expect(res2.state.round!.turn).toBe(1);
    expect(res2.state.round!.phase).toBe("awaitTake");
  });
});

describe("line pickup — mandatory meld shapes and sourcing", () => {
  it("accepts a K-A-2 wrap run as the mandatory meld at depth 1", () => {
    // Pickup melds are ordinary sets, so circular runs qualify.
    const match = mkMatch({
      hands: [
        ["KS", "2S", "9C", "10C"],
        ["5H", "6H", "7H", "8H", "9H"],
      ],
      line: ["7C", "AS"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["KS", "AS", "2S"]),
    });
    expectOk(res);
    const round = res.state.round!;
    expect(round.sets).toHaveLength(1);
    expect(round.sets[0]!.kind).toBe("run");
    expect(sorted(round.sets[0]!.cards)).toEqual(sorted(cc(["KS", "AS", "2S"])));
    expect(round.line).toEqual([c("7C")]);
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["9C", "10C"])));
  });

  it("requires the chosen COPY itself — a twin of the chosen card from hand does not satisfy the meld", () => {
    // Spec: the new set "includes the chosen (deepest) card". With per-copy
    // ids, 9S#2 from hand is a different physical card than the chosen 9S#1.
    const match = mkMatch({
      hands: [
        ["9S#2", "9H", "9D", "10C", "JC"],
        ["5H", "6H", "7H", "8H", "2H"],
      ],
      line: ["7C", "9S"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const bad = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: ["9S#2", c("9H"), c("9D")],
    });
    expect(bad.ok).toBe(false);

    const good = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: ["9S#1", c("9H"), c("9D")],
    });
    expectOk(good);
    // The twin stays in hand, untouched.
    expect(sorted(good.state.round!.hands[0]!)).toEqual(sorted(["9S#2", c("10C"), c("JC")]));
  });

  it("rejects a meld sourced from line cards BEFORE the chosen card (not scooped)", () => {
    // Spec: "you take that card plus every card discarded after it"; the meld
    // "may use cards from your hand and/or the other cards you just scooped".
    // Cards ahead of the chosen card stay in the line and are untouchable.
    const match = mkMatch({
      hands: [
        ["9C", "10C", "JC"],
        ["5H", "6H", "7H", "8H", "2H"],
      ],
      line: ["4D", "5D", "6D"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 2, // chosen card is 6D; 4D and 5D are NOT scooped
      meldCardIds: cc(["4D", "5D", "6D"]),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects melds sourced from the stock or another player's hand", () => {
    const match = mkMatch({
      hands: [
        ["9H", "2H", "3H"],
        ["9D", "5H", "6H", "7H", "8H"], // 9D belongs to seat 1
      ],
      line: ["7C", "9C"],
      stock: ["2C", "3C", "9S"], // 9S is buried in the stock
      turn: 0,
    });
    const usesOpponentCard = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["9C", "9H", "9D"]),
    });
    expect(usesOpponentCard.ok).toBe(false);

    const usesStockCard = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["9C", "9H", "9S"]),
    });
    expect(usesStockCard.ok).toBe(false);
  });

  it("allows the meld to mix the chosen card, other scooped cards, and hand cards", () => {
    // Spec: "The new set may use cards from your hand and/or the other cards
    // you just scooped from the line."
    const match = mkMatch({
      hands: [
        ["7D", "2C", "3C"],
        ["JD", "QD", "KD", "2H", "3H"],
      ],
      line: ["7C", "5D", "6D", "9C"],
      stock: ["4C", "5C", "6C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1, // scoops 5D (chosen), 6D, 9C
      meldCardIds: cc(["5D", "6D", "7D"]),
    });
    expectOk(res);
    const round = res.state.round!;
    expect(sorted(round.sets[0]!.cards)).toEqual(sorted(cc(["5D", "6D", "7D"])));
    // Leftover scoop (9C) joins the hand; melded hand card (7D) leaves it.
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["2C", "3C", "9C"])));
    expect(round.line).toEqual([c("7C")]);
  });

  it("allows the meld to pick non-adjacent scooped cards, leaving the skipped one in hand", () => {
    // Nothing in the spec requires the melded scooped cards to be contiguous
    // in the line — only that all scooped cards were "discarded after" the
    // chosen one, and leftovers go to hand.
    const match = mkMatch({
      hands: [
        ["10C", "JC", "QC"],
        ["2H", "3H", "4H", "6H", "7H"],
      ],
      line: ["7C", "9H", "5S", "9D", "9C"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1, // scoops 9H (chosen), 5S, 9D, 9C
      meldCardIds: cc(["9H", "9D", "9C"]),
    });
    expectOk(res);
    const round = res.state.round!;
    expect(round.sets[0]!.kind).toBe("group");
    expect(round.line).toEqual([c("7C")]);
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["10C", "JC", "QC", "5S"])));
  });

  it("accepts a group with identical duplicate copies as the mandatory meld", () => {
    // Spec: "with multiple decks, identical duplicates are legal in a group".
    const match = mkMatch({
      hands: [
        ["9S#2", "9H", "10C", "JC"],
        ["5H", "6H", "7H", "8H", "2H"],
      ],
      line: ["7C", "9S"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: ["9S#1", "9S#2", c("9H")],
    });
    expectOk(res);
    const round = res.state.round!;
    expect(round.sets[0]!.kind).toBe("group");
    expect(sorted(round.sets[0]!.cards)).toEqual(sorted(["9S#1", "9S#2", c("9H")]));
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["10C", "JC"])));
  });

  it("accepts a mandatory meld larger than three cards", () => {
    // Spec says "a brand-new set of 3+ cards" — no upper bound below 13.
    const match = mkMatch({
      hands: [
        ["4H", "5H", "6H", "7H", "9C", "10C"],
        ["JD", "QD", "KD", "2H", "3H"],
      ],
      line: ["7C", "3H"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["3H", "4H", "5H", "6H", "7H"]),
    });
    expectOk(res);
    const round = res.state.round!;
    expect(round.sets).toHaveLength(1);
    expect(round.sets[0]!.cards).toHaveLength(5);
    expect(round.sets[0]!.kind).toBe("run");
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["9C", "10C"])));
  });

  it("is legal for the meld to consume the whole prior hand when scooped leftovers restock it", () => {
    // The pickup is one atomic action: hand and/or scooped cards feed the
    // meld, and "the other scooped cards simply go into your hand". After
    // this pickup the player holds two leftover cards — plenty to satisfy
    // the mandatory discard ("you must discard exactly one card").
    const match = mkMatch({
      hands: [
        ["5H", "6H"],
        ["JD", "QD", "KD", "2H", "3H"],
      ],
      line: ["7C", "4H", "8C", "9C"],
      stock: ["2C", "3C", "4C"],
      turn: 0,
    });
    const res = applyAction(match, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1, // scoops 4H (chosen), 8C, 9C
      meldCardIds: cc(["4H", "5H", "6H"]),
    });
    expectOk(res);
    const round = res.state.round!;
    expect(sorted(round.hands[0]!)).toEqual(sorted(cc(["8C", "9C"])));
    expect(round.phase).toBe("awaitDiscard");

    const res2 = applyAction(res.state, { type: "discard", seat: 0, cardId: c("8C") });
    expectOk(res2);
    expect(res2.state.round!.hands[0]).toEqual([c("9C")]);
    expect(res2.state.round!.turn).toBe(1);
  });
});
