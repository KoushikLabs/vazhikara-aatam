/**
 * Black-box conformance tests (batch B) — every expectation is derived from
 * PLAN.md Part 1 ONLY, never from the implementation. Focus areas: free
 * actions (display/attach at any time, own-set prerequisite, hand floor),
 * declaring (own-run requirement, declare card scores nobody), scoring
 * (per-card placement ownership, attacher credit, negatives, dead rounds),
 * and match win/tie logic.
 */
import { describe, expect, it } from "vitest";
import { applyAction, startNextRound } from "../src/index.js";
import type {
  ActionResult,
  MatchState,
  RejectCode,
  RoundResult,
} from "../src/types.js";
import { c, cc, expectOk, mkMatch } from "./helpers.js";

function expectReject(res: ActionResult, code?: RejectCode): void {
  expect(res.ok).toBe(false);
  if (!res.ok && code) expect(res.code).toBe(code);
}

/** Round result, whether the engine keeps it on the round or in history. */
function lastResult(state: MatchState): RoundResult {
  const r = state.round?.result ?? state.history[state.history.length - 1];
  if (!r) throw new Error("expected a round result after the round ended");
  return r;
}

describe("free actions (spec: allowed at ANY time, even during other players' turns)", () => {
  it("out of turn: attach is rejected without an own displayed set, then display + attach succeed", () => {
    // PLAN.md: "Prerequisite: you must already have at least one set of your
    // own displayed before you may attach to anything." Display has no
    // prerequisite and both are legal during another player's turn.
    const m = mkMatch({
      hands: [["JC", "10C"], ["JD", "10D"], ["2H", "3H", "4H", "7C", "9C"]],
      sets: [{ kind: "group", createdBy: 0, cards: ["7S", "7H", "7D"] }],
      line: ["QD"],
      turn: 0,
      phase: "awaitTake",
    });

    // Seat 2 (not on turn) may not attach yet — no own set displayed.
    expectReject(
      applyAction(m, { type: "attach", seat: 2, setId: "set-1", cardIds: [c("7C")] }),
      "NEED_OWN_SET",
    );

    // Displaying a new run out of turn is legal with no prerequisite.
    const r1 = applyAction(m, { type: "display", seat: 2, cardIds: cc(["2H", "3H", "4H"]) });
    expectOk(r1);

    // Now the attach to ANOTHER player's group is legal, still out of turn.
    const r2 = applyAction(r1.state, {
      type: "attach",
      seat: 2,
      setId: "set-1",
      cardIds: [c("7C")],
    });
    expectOk(r2);
    const round = r2.state.round!;
    const group = round.sets.find((s) => s.id === "set-1")!;
    expect(group.cards).toContain(c("7C"));
    // Per-card placement ownership: the attacher is credited, not the owner.
    expect(round.placedBy[c("7C")]).toBe(2);
    // Attachments never make the set the attacher's own.
    expect(group.createdBy).toBe(0);
    expect(round.hands[2]).toEqual([c("9C")]);
  });

  it("the mandatory meld laid during a line pickup satisfies the own-set prerequisite for attaching", () => {
    // PLAN.md: pickup forces "a brand-new set of 3+ cards that includes the
    // chosen card". That set is one the player laid down, so afterwards the
    // attach prerequisite ("at least one set of your own displayed") is met.
    const m = mkMatch({
      hands: [["9S", "9H", "5H", "2C#2", "6D"], ["KD"]],
      sets: [{ kind: "run", createdBy: 1, cards: ["2H", "3H", "4H"] }],
      line: ["QD", "9D"],
      turn: 0,
      phase: "awaitTake",
    });

    // Before the pickup, seat 0 owns no set: attaching is rejected (and the
    // rejection is for the missing own set — free actions have no phase gate).
    expectReject(
      applyAction(m, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("5H")] }),
      "NEED_OWN_SET",
    );

    // Depth-1 pickup of the 9D with the mandatory brand-new group.
    const r1 = applyAction(m, {
      type: "pickupLine",
      seat: 0,
      lineIndex: 1,
      meldCardIds: cc(["9D", "9S", "9H"]),
    });
    expectOk(r1);
    const newSet = r1.state.round!.sets.find((s) => s.cards.includes(c("9D")))!;
    expect(newSet.createdBy).toBe(0);
    // Mandatory-meld cards are placed by (and will score for) the picker.
    expect(r1.state.round!.placedBy[c("9D")]).toBe(0);
    expect(r1.state.round!.placedBy[c("9S")]).toBe(0);

    // The own-set prerequisite is now satisfied; attach to seat 1's run works.
    const r2 = applyAction(r1.state, {
      type: "attach",
      seat: 0,
      setId: "set-1",
      cardIds: [c("5H")],
    });
    expectOk(r2);
    expect(r2.state.round!.placedBy[c("5H")]).toBe(0);
  });

  it("hand floor applies to out-of-turn attaches: never below 1 card, exactly 1 is fine", () => {
    // PLAN.md: "no display or attach action may reduce your hand below 1
    // card" — going out happens only via the declare discard, so an
    // out-of-turn player can never reach 0 cards.
    const m = mkMatch({
      hands: [["KD", "QD"], ["JD"], ["4C", "4S#2"]],
      sets: [
        { kind: "run", createdBy: 2, cards: ["9H", "10H", "JH"] },
        { kind: "group", createdBy: 0, cards: ["4S", "4H", "4D"] },
      ],
      line: ["QC"],
      stock: ["KS#2"],
      turn: 0,
      phase: "awaitTake",
    });

    // Attaching both cards would empty seat 2's hand — illegal even out of turn.
    expectReject(
      applyAction(m, { type: "attach", seat: 2, setId: "set-2", cardIds: cc(["4C", "4S#2"]) }),
    );

    // Attaching one card down to exactly 1 in hand is legal out of turn.
    const r = applyAction(m, { type: "attach", seat: 2, setId: "set-2", cardIds: [c("4C")] });
    expectOk(r);
    expect(r.state.round!.hands[2]).toEqual([c("4S#2")]);
  });

  it("attaches duplicate copies to ANOTHER player's group, credited card-by-card to the attacher", () => {
    // PLAN.md: groups allow identical duplicates and "can grow without limit
    // via attachments"; every attached card scores for the attacher.
    const m = mkMatch({
      hands: [["QD"], ["9H#2", "9C", "KD"]],
      sets: [
        { kind: "group", createdBy: 0, cards: ["9S#1", "9S#2", "9H#1"] },
        { kind: "run", createdBy: 1, cards: ["AS", "2S", "3S"] },
      ],
      line: ["QC"],
      turn: 0,
      phase: "awaitTake",
    });

    const r = applyAction(m, {
      type: "attach",
      seat: 1,
      setId: "set-1",
      cardIds: cc(["9H#2", "9C"]),
    });
    expectOk(r);
    const round = r.state.round!;
    const group = round.sets.find((s) => s.id === "set-1")!;
    expect(group.cards).toHaveLength(5);
    expect(round.placedBy["9H#2"]).toBe(1);
    expect(round.placedBy[c("9C")]).toBe(1);
    // The original owner keeps ownership of the original three cards only.
    expect(round.placedBy["9S#1"]).toBe(0);
    expect(group.createdBy).toBe(0);
    expect(round.hands[1]).toEqual([c("KD")]);
  });

  it("extends another player's run across the K-A corner, and rejects duplicate ranks / wrong suits", () => {
    // PLAN.md: rank order is circular (K and A adjacent); each rank at most
    // once per run; runs are strictly same-suit.
    const m = mkMatch({
      hands: [["2S", "AS#2", "3H"], ["KD"]],
      sets: [
        { kind: "run", createdBy: 1, cards: ["QS", "KS", "AS"] },
        { kind: "group", createdBy: 0, cards: ["6S", "6H", "6D"] },
      ],
      line: ["QC"],
      turn: 0,
      phase: "awaitTake",
    });

    // Q-K-A + 2S wraps the corner: legal.
    const r1 = applyAction(m, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("2S")] });
    expectOk(r1);
    expect(r1.state.round!.sets.find((s) => s.id === "set-1")!.cards).toHaveLength(4);

    // A second Ace would duplicate a rank within the run: illegal.
    expectReject(
      applyAction(r1.state, { type: "attach", seat: 0, setId: "set-1", cardIds: ["AS#2"] }),
    );
    // 3H continues the sequence numerically but is the wrong suit: illegal.
    expectReject(
      applyAction(r1.state, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("3H")] }),
    );
  });

  it("hand floor applies to out-of-turn displays: the whole hand may never be displayed", () => {
    // PLAN.md hand-floor rule: "You must always retain at least one card to throw".
    const whole = mkMatch({
      hands: [["KD", "QD"], ["5S", "5H", "5D"]],
      line: ["QC"],
      turn: 0,
      phase: "awaitTake",
    });
    expectReject(
      applyAction(whole, { type: "display", seat: 1, cardIds: cc(["5S", "5H", "5D"]) }),
    );

    const keepOne = mkMatch({
      hands: [["KD", "QD"], ["5S", "5H", "5D", "9C"]],
      line: ["QC"],
      turn: 0,
      phase: "awaitTake",
    });
    const r = applyAction(keepOne, { type: "display", seat: 1, cardIds: cc(["5S", "5H", "5D"]) });
    expectOk(r);
    expect(r.state.round!.hands[1]).toEqual([c("9C")]);
  });

  it("out-of-turn attach interleaves between the turn player's take and discard", () => {
    // PLAN.md: free actions are legal at ANY time — this makes the game
    // real-time; actions are just processed in arrival order.
    const m = mkMatch({
      hands: [["KD", "QD"], ["QS", "2D"]],
      sets: [{ kind: "run", createdBy: 1, cards: ["9S", "10S", "JS"] }],
      line: ["7C"],
      stock: ["6C", "8C"],
      turn: 0,
      phase: "awaitTake",
    });

    // Seat 0 draws the top stock card.
    const r1 = applyAction(m, { type: "drawStock", seat: 0 });
    expectOk(r1);
    expect(r1.state.round!.hands[0]).toContain(c("8C"));

    // Seat 1 attaches to their own run while seat 0 is between take and discard.
    const r2 = applyAction(r1.state, {
      type: "attach",
      seat: 1,
      setId: "set-1",
      cardIds: [c("QS")],
    });
    expectOk(r2);
    expect(r2.state.round!.placedBy[c("QS")]).toBe(1);

    // Seat 0's turn is undisturbed: the discard still works and passes the turn.
    const r3 = applyAction(r2.state, { type: "discard", seat: 0, cardId: c("KD") });
    expectOk(r3);
    expect(r3.state.round!.turn).toBe(1);
    expect(r3.state.round!.phase).toBe("awaitTake");
  });

  it("extends an own run downward through the Ace, out of turn, with the target set as the only own set", () => {
    // PLAN.md: "runs extend in either direction around the circle"; the
    // attach prerequisite is satisfied by the target set itself being yours.
    const m = mkMatch({
      hands: [["AH", "9C"], ["KC", "QC"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2H", "3H", "4H"] }],
      line: ["QD"],
      turn: 1,
      phase: "awaitTake",
    });
    const r = applyAction(m, { type: "attach", seat: 0, setId: "set-1", cardIds: [c("AH")] });
    expectOk(r);
    const set = r.state.round!.sets.find((s) => s.id === "set-1")!;
    expect(set.cards).toHaveLength(4);
    expect(set.cards).toContain(c("AH"));
    expect(r.state.round!.placedBy[c("AH")]).toBe(0);
  });
});

describe("declaring (spec: at least one set YOU laid down must be a proper run)", () => {
  it("rejects a declare backed only by an own group plus cards attached to another player's run", () => {
    // PLAN.md: "at least one of the sets you yourself laid down must be a
    // proper run... Cards you attached to other players' runs do not count."
    const m = mkMatch({
      hands: [["KD"], ["9C"]],
      sets: [
        { kind: "group", createdBy: 0, cards: ["8S", "8H", "8D"] },
        // Seat 0 attached the 7H to seat 1's run — that does NOT count.
        { kind: "run", createdBy: 1, cards: ["4H", "5H", "6H", "7H"], placedBy: [1, 1, 1, 0] },
      ],
      line: ["QC"],
      turn: 0,
      phase: "awaitDiscard",
    });
    expectReject(
      applyAction(m, { type: "discard", seat: 0, cardId: c("KD") }),
      "DECLARE_NEEDS_OWN_RUN",
    );
  });

  it("a run the declarer laid down still counts after an opponent extended it, and credit stays split", () => {
    // PLAN.md: the run requirement is about who laid the set down; per-card
    // scoring ownership tracks who placed each card.
    const m = mkMatch({
      hands: [["QD"], ["AC"]],
      sets: [
        // Seat 0's run; seat 1 attached the 5H (worth 5) to it earlier.
        { kind: "run", createdBy: 0, cards: ["2H", "3H", "4H", "5H"], placedBy: [0, 0, 0, 1] },
        { kind: "group", createdBy: 1, cards: ["9S", "9H", "9D"] },
      ],
      line: ["QC"],
      turn: 0,
      phase: "awaitDiscard",
    });

    const r = applyAction(m, { type: "discard", seat: 0, cardId: c("QD") });
    expectOk(r);
    const result = lastResult(r.state);
    expect(result.declarer).toBe(0);
    // Declarer: 2H+3H+4H = 15. The 5H belongs to seat 1's tally.
    expect(result.tablePoints[0]).toBe(15);
    expect(result.tablePoints[1]).toBe(20); // 5 (attached 5H) + 15 (own group)
    expect(result.scores[0]).toBe(15); // declarer: table sum only
    expect(result.scores[1]).toBe(5); // 20 table − 15 hand (AC)
    expect(r.state.totals).toEqual([15, 5]);
  });

  it("the declare card scores nothing for anyone", () => {
    // PLAN.md: "(The declare card scores nothing for anyone; it just ends
    // the round.)" — declaring with an Ace must not add 15 anywhere.
    const m = mkMatch({
      hands: [["AD"], ["2D"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["3S", "4S", "5S"] }],
      line: ["QC"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const r = applyAction(m, { type: "discard", seat: 0, cardId: c("AD") });
    expectOk(r);
    const result = lastResult(r.state);
    expect(result.declarer).toBe(0);
    expect(result.tablePoints[0]).toBe(15); // run only — no 15 for the Ace
    expect(result.handPoints[0]).toBe(0); // not counted as held either
    expect(result.tablePoints[1]).toBe(0);
    expect(result.scores).toEqual([15, -5]); // seat 1: 0 table − 5 hand
  });

  it("the declarer may shed the penultimate card by attaching to an OPPONENT's run and is credited for it", () => {
    // PLAN.md: declarer "scores the sum of all card points they placed on
    // the table" — including cards attached to other players' sets.
    const m = mkMatch({
      hands: [["8S", "9C"], ["2C#2"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["2H", "3H", "4H"] },
        { kind: "run", createdBy: 1, cards: ["5S", "6S", "7S"] },
      ],
      line: ["QC"],
      turn: 0,
      phase: "awaitDiscard",
    });

    const r1 = applyAction(m, { type: "attach", seat: 0, setId: "set-2", cardIds: [c("8S")] });
    expectOk(r1);
    const r2 = applyAction(r1.state, { type: "discard", seat: 0, cardId: c("9C") });
    expectOk(r2);
    const result = lastResult(r2.state);
    expect(result.declarer).toBe(0);
    expect(result.tablePoints[0]).toBe(20); // 15 own run + 5 attached to opponent's run
    expect(result.tablePoints[1]).toBe(15);
    expect(result.scores).toEqual([20, 10]); // seat 1: 15 − 5 (2C#2 in hand)
  });

  it("a discard with more than one card left is a normal discard, even with an own run displayed", () => {
    // PLAN.md: going out requires everything but EXACTLY ONE card on the
    // table; otherwise the discard just ends the turn and play continues.
    const m = mkMatch({
      hands: [["5C", "9D"], ["KC"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2H", "3H", "4H"] }],
      line: ["QC"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const r = applyAction(m, { type: "discard", seat: 0, cardId: c("9D") });
    expectOk(r);
    expect(r.state.phase).toBe("roundActive");
    const round = r.state.round!;
    expect(round.result).toBeNull();
    expect(round.phase).toBe("awaitTake");
    expect(round.turn).toBe(1);
    expect(round.line[round.line.length - 1]).toBe(c("9D"));
  });
});

describe("scoring (spec: per-card placement ownership, negatives, dead rounds)", () => {
  it("reproduces the spec's −50 example end-to-end through a dead round, and the match continues", () => {
    // PLAN.md: non-declarer scores table − hand, "can be negative (e.g. 20 on
    // the table, 70 in hand → −50)"; dead round = stock empty, no declarer.
    const m = mkMatch({
      hands: [["2D"], ["AS", "AH", "KS", "KH", "QS", "JS"]], // seat 1 holds 70
      sets: [
        { kind: "run", createdBy: 1, cards: ["8H", "9H", "10H"] }, // 20 on the table
        { kind: "run", createdBy: 0, cards: ["2S", "3S", "4S"] }, // 15
      ],
      line: ["7C"],
      stock: [],
      turn: 0,
      phase: "awaitTake",
    });

    const r = applyAction(m, { type: "declareDead", seat: 0 });
    expectOk(r);
    const result = lastResult(r.state);
    expect(result.declarer).toBeNull();
    expect(result.scores[1]).toBe(-50); // 20 − 70
    expect(result.scores[0]).toBe(10); // 15 − 5
    expect(r.state.totals).toEqual([10, -50]); // totals may go negative
    expect(r.state.winner).toBeNull();
    expect(r.state.phase).toBe("betweenRounds"); // nobody reached the target

    // The next round can start normally: fresh 10-card hands and a starter.
    const next = startNextRound(r.state);
    expectOk(next);
    expect(next.state.round!.hands.every((h) => h.length === 10)).toBe(true);
    expect(next.state.round!.line).toHaveLength(1);
  });

  it("splits a group grown by three seats card-by-card, and gives the dead-round trigger no declarer bonus", () => {
    // PLAN.md: "Every card on the table is credited to the player who
    // physically placed it"; in a dead round EVERYONE scores table − hand —
    // the player who ended it is not treated as a declarer.
    const m = mkMatch({
      hands: [["KD"], ["2C#2"], ["QH", "JH"]],
      sets: [
        {
          kind: "group",
          createdBy: 0,
          cards: ["7S", "7H", "7D", "7C", "7S#2"],
          placedBy: [0, 0, 0, 1, 2], // seat 1 attached 7C, seat 2 attached 7S#2
        },
        { kind: "run", createdBy: 1, cards: ["9S", "10S", "JS"] },
        { kind: "run", createdBy: 2, cards: ["3D", "4D", "5D"] },
      ],
      line: ["QD"],
      stock: [],
      turn: 0,
      phase: "awaitTake",
    });

    const r = applyAction(m, { type: "declareDead", seat: 0 });
    expectOk(r);
    const result = lastResult(r.state);
    expect(result.declarer).toBeNull();
    expect(result.tablePoints).toEqual([15, 30, 20]); // 3×7 | 7C + 9-10-J | 7S#2 + 3-4-5
    expect(result.handPoints).toEqual([10, 5, 20]);
    // Seat 0 triggered the dead round but still scores table − hand (5, not 15).
    expect(result.scores).toEqual([5, 25, 0]);
  });
});

describe("match win and tie logic (spec: reach or exceed target; higher total among crossers)", () => {
  it("a dead round that brings a player exactly to the target finishes the match", () => {
    // PLAN.md: "Round scores accumulate across rounds... First player to
    // reach or exceed the target wins" — no exception for dead rounds, and
    // reaching the target exactly is enough.
    const m = mkMatch({
      hands: [["5C#2"], ["KC"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["9D", "10D", "JD", "QD"] }, // 35
        { kind: "run", createdBy: 1, cards: ["2H", "3H", "4H"] }, // 15
      ],
      line: ["7C"],
      stock: [],
      turn: 0,
      phase: "awaitTake",
      totals: [470, 0],
      targetScore: 500,
    });

    const r = applyAction(m, { type: "declareDead", seat: 0 });
    expectOk(r);
    expect(r.state.totals).toEqual([500, 5]); // 470 + (35 − 5) | 0 + (15 − 10)
    expect(r.state.phase).toBe("finished");
    expect(r.state.winner).toBe(0);
  });

  it("when two players cross together, the higher total wins even though the other one declared", () => {
    // PLAN.md: "If multiple players cross the target in the same round, the
    // higher total wins" — being the declarer confers no tiebreak.
    const m = mkMatch({
      hands: [["2C#2"], ["9C"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["10H", "JH", "QH", "KH"] }, // 40
        { kind: "run", createdBy: 1, cards: ["2S", "3S", "4S"] }, // 15
        { kind: "group", createdBy: 1, cards: ["5D", "5H", "5C"] }, // 15
      ],
      line: ["QC"],
      turn: 1,
      phase: "awaitDiscard",
      totals: [480, 476],
      targetScore: 500,
    });

    // Seat 1 declares (own run displayed, one card left).
    const r = applyAction(m, { type: "discard", seat: 1, cardId: c("9C") });
    expectOk(r);
    const result = lastResult(r.state);
    expect(result.declarer).toBe(1);
    expect(r.state.totals).toEqual([515, 506]); // 480 + (40−5) | 476 + 30
    expect(r.state.phase).toBe("finished");
    expect(r.state.winner).toBe(0); // higher total, despite seat 1 declaring
  });
});
