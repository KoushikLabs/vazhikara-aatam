import { describe, it, expect } from "vitest";
import type { TableSet } from "@vazhikara/engine";
import {
  canAttach,
  canDisplay,
  hasOwnDisplayedSet,
  isDeclareEligible,
  previewPickup,
  sortHand,
  suggestPickupMeld,
  validatePickupMeld,
  handPoints,
  type PickupContext,
  type StrandContext,
} from "../src/lib/hints.js";

const free: StrandContext = { preDiscardTurn: false, ownRunDisplayed: false };
const preDiscard: StrandContext = { preDiscardTurn: true, ownRunDisplayed: false };
const preDiscardWithRun: StrandContext = { preDiscardTurn: true, ownRunDisplayed: true };

describe("sortHand", () => {
  it("sorts by suit then rank", () => {
    const hand = ["3H#1", "AS#1", "2S#1", "KD#1"];
    // Rank order is numeric (A=1 sorts before 2), suit groups S < H < D < C.
    expect(sortHand(hand, "suit")).toEqual(["AS#1", "2S#1", "3H#1", "KD#1"]);
  });

  it("sorts by rank then suit", () => {
    const hand = ["3H#1", "AS#1", "2S#1", "KD#1"];
    expect(sortHand(hand, "rank")).toEqual(["AS#1", "2S#1", "3H#1", "KD#1"]);
  });
});

describe("canDisplay", () => {
  it("accepts a valid group leaving cards in hand", () => {
    const hand = ["AS#1", "AH#1", "AD#1", "2C#1"];
    expect(canDisplay(hand, ["AS#1", "AH#1", "AD#1"], free)).toBe(true);
  });

  it("rejects fewer than 3 cards", () => {
    const hand = ["AS#1", "AH#1", "AD#1", "2C#1"];
    expect(canDisplay(hand, ["AS#1", "AH#1"], free)).toBe(false);
  });

  it("rejects a selection that would empty the hand (hand-floor)", () => {
    const hand = ["AS#1", "AH#1", "AD#1"];
    expect(canDisplay(hand, ["AS#1", "AH#1", "AD#1"], free)).toBe(false);
  });

  it("rejects an invalid meld shape", () => {
    const hand = ["AS#1", "2H#1", "5D#1", "9C#1"];
    expect(canDisplay(hand, ["AS#1", "2H#1", "5D#1"], free)).toBe(false);
  });

  it("rejects cards not in the hand (stale selection)", () => {
    const hand = ["AS#1", "AH#1", "2C#1"];
    expect(canDisplay(hand, ["AS#1", "AH#1", "AD#1"], free)).toBe(false);
  });

  it("mirrors the engine's strand guard: no group display down to 1 card pre-discard without an own run", () => {
    const hand = ["AS#1", "AH#1", "AD#1", "2C#1"];
    const group = ["AS#1", "AH#1", "AD#1"];
    expect(canDisplay(hand, group, preDiscard)).toBe(false);
    expect(canDisplay(hand, group, preDiscardWithRun)).toBe(true);
    // displaying a RUN down to 1 card satisfies the requirement itself
    const runHand = ["2D#1", "3D#1", "4D#1", "9C#1"];
    expect(canDisplay(runHand, ["2D#1", "3D#1", "4D#1"], preDiscard)).toBe(true);
    // out of turn the same group display is fine
    expect(canDisplay(hand, group, free)).toBe(true);
  });
});

describe("canAttach", () => {
  const runSet: TableSet = { id: "set-1", kind: "run", createdBy: 0, cards: ["2D#1", "3D#1", "4D#1"] };

  it("accepts extending a run with the next card, leaving cards in hand", () => {
    const hand = ["5D#1", "9C#1"];
    expect(canAttach(hand, ["5D#1"], runSet, free)).toBe(true);
  });

  it("rejects a non-adjacent card", () => {
    const hand = ["7D#1", "9C#1"];
    expect(canAttach(hand, ["7D#1"], runSet, free)).toBe(false);
  });

  it("rejects attaching the entire hand (hand-floor)", () => {
    const hand = ["5D#1"];
    expect(canAttach(hand, ["5D#1"], runSet, free)).toBe(false);
  });

  it("rejects an empty selection", () => {
    const hand = ["5D#1"];
    expect(canAttach(hand, [], runSet, free)).toBe(false);
  });

  it("rejects cards not in the hand (stale selection)", () => {
    const hand = ["9C#1", "8H#1"];
    expect(canAttach(hand, ["5D#1"], runSet, free)).toBe(false);
  });

  it("mirrors the engine's strand guard for pre-discard attaches down to 1 card", () => {
    const hand = ["5D#1", "9C#1"];
    expect(canAttach(hand, ["5D#1"], runSet, preDiscard)).toBe(false);
    expect(canAttach(hand, ["5D#1"], runSet, preDiscardWithRun)).toBe(true);
  });
});

describe("hasOwnDisplayedSet", () => {
  it("true only when the seat created at least one set", () => {
    const sets: TableSet[] = [{ id: "set-1", kind: "group", createdBy: 1, cards: ["AS#1", "AH#1", "AD#1"] }];
    expect(hasOwnDisplayedSet(sets, 1)).toBe(true);
    expect(hasOwnDisplayedSet(sets, 0)).toBe(false);
  });
});

describe("isDeclareEligible", () => {
  it("true only with exactly 1 card in hand and an own displayed run", () => {
    const sets: TableSet[] = [{ id: "set-1", kind: "run", createdBy: 0, cards: ["2D#1", "3D#1", "4D#1"] }];
    expect(isDeclareEligible(["AS#1"], sets, 0)).toBe(true);
  });

  it("false with more than 1 card in hand", () => {
    const sets: TableSet[] = [{ id: "set-1", kind: "run", createdBy: 0, cards: ["2D#1", "3D#1", "4D#1"] }];
    expect(isDeclareEligible(["AS#1", "2H#1"], sets, 0)).toBe(false);
  });

  it("false when the only own set is a group, not a run", () => {
    const sets: TableSet[] = [{ id: "set-1", kind: "group", createdBy: 0, cards: ["AS#1", "AH#1", "AD#1"] }];
    expect(isDeclareEligible(["9C#1"], sets, 0)).toBe(false);
  });

  it("false when the run belongs to another seat (attached cards don't count)", () => {
    const sets: TableSet[] = [{ id: "set-1", kind: "run", createdBy: 1, cards: ["2D#1", "3D#1", "4D#1"] }];
    expect(isDeclareEligible(["9C#1"], sets, 0)).toBe(false);
  });
});

describe("previewPickup", () => {
  it("returns the chosen card plus everything after it in throw order", () => {
    const line = ["AS#1", "2D#1", "JH#1", "KC#1"];
    expect(previewPickup(line, 1)).toEqual({ chosenId: "2D#1", scooped: ["2D#1", "JH#1", "KC#1"] });
  });

  it("returns null for an out-of-range index", () => {
    const line = ["AS#1"];
    expect(previewPickup(line, 5)).toBeNull();
    expect(previewPickup(line, -1)).toBeNull();
  });
});

describe("suggestPickupMeld / validatePickupMeld", () => {
  const roomy: PickupContext = { handSize: 6, scoopedSize: 2, ownRunDisplayed: false };

  it("suggests and validates a group meld from hand + scooped", () => {
    const chosen = "9S#1";
    const hand = ["9H#1", "5C#1", "7H#1", "8H#1", "QD#1", "KD#1"];
    const otherScooped = ["9D#1"];
    const meld = suggestPickupMeld(chosen, hand, otherScooped, roomy);
    expect(meld).not.toBeNull();
    expect(meld).toContain(chosen);
    expect(validatePickupMeld(chosen, meld!, roomy)).toEqual({ ok: true, kind: "group" });
  });

  it("returns null when no meld exists", () => {
    const chosen = "9S#1";
    const hand = ["5C#1", "7H#1"];
    expect(suggestPickupMeld(chosen, hand, [], { handSize: 2, scoopedSize: 1, ownRunDisplayed: false })).toBeNull();
  });

  it("rejects a meld missing the chosen card", () => {
    const verdict = validatePickupMeld("9S#1", ["AH#1", "AD#1", "AC#1"], roomy);
    expect(verdict.ok).toBe(false);
  });

  it("mirrors the engine's WOULD_EMPTY_HAND guard", () => {
    // hand [3D,4D], chosen 2D at depth 1: melding all of it leaves 0 cards
    const ctx: PickupContext = { handSize: 2, scoopedSize: 1, ownRunDisplayed: false };
    const verdict = validatePickupMeld("2D#1", ["2D#1", "3D#1", "4D#1"], ctx);
    expect(verdict).toMatchObject({ ok: false });
    expect(suggestPickupMeld("2D#1", ["3D#1", "4D#1"], [], ctx)).toBeNull();
  });

  it("mirrors the engine's WOULD_STRAND guard, with the run-meld and own-run escapes", () => {
    // group meld leaving exactly 1 card, no own run → invalid
    const ctx: PickupContext = { handSize: 3, scoopedSize: 1, ownRunDisplayed: false };
    expect(validatePickupMeld("2D#1", ["2D#1", "2H#1", "2S#1"], ctx).ok).toBe(false);
    // same shape but the meld itself is a run → valid
    expect(validatePickupMeld("2D#1", ["2D#1", "3D#1", "4D#1"], ctx).ok).toBe(true);
    // same group meld but an own run is already displayed → valid
    expect(
      validatePickupMeld("2D#1", ["2D#1", "2H#1", "2S#1"], { ...ctx, ownRunDisplayed: true }).ok,
    ).toBe(true);
  });
});

describe("handPoints", () => {
  it("sums card points correctly", () => {
    // A=15, K=10, 5=5
    expect(handPoints(["AS#1", "KH#1", "5D#1"])).toBe(30);
  });
});
