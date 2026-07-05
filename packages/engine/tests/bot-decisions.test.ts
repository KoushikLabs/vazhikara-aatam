import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.js";
import { applyAction } from "../src/round.js";
import { cc, mkMatch } from "./helpers.js";

const rng = () => 0.5; // fixed midpoint RNG for deterministic threshold behavior in these targeted tests

describe("chooseBotAction — discard choice", () => {
  it("prefers discarding a low-point, useless card over a high-point card that completes a near-meld", () => {
    // Hand: 5S/5H are a near-meld pair (one card from a group); AS is a lone
    // high-point card with no melds/near-melds/danger relevance.
    const match = mkMatch({
      hands: [["5S", "5H", "AS", "2H", "3H", "9C"], ["7D", "8D", "9D"]],
      line: ["7C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const action = chooseBotAction(match, 0, rng);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("discard");
    if (action!.type === "discard") {
      // Should not break the 5S/5H near-meld or the 2H/3H run fragment; the
      // lone Ace (highest points, no structural value) is the worst offender
      // among 9C/AS candidates once melds/near-melds are protected.
      expect(action!.cardId).not.toBe("5S#1");
      expect(action!.cardId).not.toBe("5H#1");
    }
  });

  it("prefers a safe discard over one that feeds an opponent's displayed group", () => {
    // Opponent (seat 1) has a displayed group of 9s — discarding another 9
    // is dangerous (visibly attachable). Hand also has a safe low card.
    const match = mkMatch({
      hands: [["9H", "2C", "3D"], ["8S", "8H"]],
      sets: [{ kind: "group", createdBy: 1, cards: ["9S", "9D", "9C"] }],
      line: ["7C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    const action = chooseBotAction(match, 0, rng);
    expect(action).not.toBeNull();
    if (action!.type === "discard") {
      expect(action!.cardId).not.toBe("9H#1");
    }
  });
});

describe("chooseBotAction — draw/pickup choice", () => {
  it("takes an obviously great pickup: depth-1 completing a high-value meld", () => {
    // Line's last card is 9D; hand holds 9S/9H, so picking it up (depth 1)
    // immediately melds a group worth 15 points with zero leftover liability.
    const match = mkMatch({
      hands: [["9S", "9H", "2C", "3D", "4H"], ["7D", "8D", "6D"]],
      line: ["5C", "9D"],
      stock: ["2S", "3S", "4S", "5S", "6S", "7S"],
      turn: 0,
      phase: "awaitTake",
    });
    const action = chooseBotAction(match, 0, rng);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("pickupLine");
    if (action!.type === "pickupLine") {
      expect(action!.meldCardIds.sort()).toEqual(cc(["9S", "9H", "9D"]).sort());
    }
  });

  it("refuses an obviously bad deep pickup (high leftover liability, no real payoff)", () => {
    // Picking up from the bottom scoops many high-point cards with no use to
    // the hand, and the mandatory meld barely breaks even — a stock draw is
    // clearly better than dragging in that liability.
    const match = mkMatch({
      hands: [["2S", "2H", "3D", "4C", "5H"], ["7D", "8D", "6D"]],
      line: ["AC", "AD", "KC", "KD", "QH", "3S"],
      stock: ["2C", "3C", "4S", "5S", "6S", "7S", "8S"],
      turn: 0,
      phase: "awaitTake",
    });
    const action = chooseBotAction(match, 0, rng);
    expect(action).not.toBeNull();
    // Either drawStock, or a declareDead — never a deep, unprofitable pickup.
    expect(action!.type).not.toBe("pickupLine");
  });
});

describe("chooseBotAction — declare sequencing", () => {
  it("walks a one-turn-declarable hand through to the declare discard", () => {
    // After drawing, hand is: 2D 3D 4D (run, own-run requirement met),
    // 7S 7H 7C (group), and one leftover card 9H — a single display of each
    // meld reaches hand size 1, and the final discard is legal (own run).
    let match = mkMatch({
      hands: [["2D", "3D", "4D", "7S", "7H", "7C", "9H"], ["6D", "8D", "9D"]],
      line: ["5C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    let guard = 0;
    let declared = false;
    while (guard++ < 10) {
      const action = chooseBotAction(match, 0, rng);
      expect(action).not.toBeNull();
      const result = applyAction(match, action!);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      match = result.state;
      if (match.round?.phase === "ended") {
        declared = true;
        break;
      }
    }
    expect(declared).toBe(true);
    expect(match.round?.result?.declarer).toBe(0);
  });

  it("finds a declare whose loose cards are a NEAR-MELD pair attachable to a displayed group (review repro)", () => {
    // Hand: 3S 4S 5S (run) + 9H 9D (a pair — evaluateHand calls this a
    // near-meld, NOT deadwood) + KC. Seat 1 displays a group of 9s, so both
    // nines attach; display run → attach 9H → attach 9D → declare-discard KC.
    // The declare gate must not count near-meld cards as stranded.
    let match = mkMatch({
      hands: [["3S", "4S", "5S", "9H", "9D", "KC"], ["6D", "8D", "QD"]],
      sets: [{ kind: "group", createdBy: 1, cards: ["9S#1", "9S#2", "9C"] }],
      line: ["5C"],
      turn: 0,
      phase: "awaitDiscard",
    });
    let guard = 0;
    let declared = false;
    while (guard++ < 10) {
      const action = chooseBotAction(match, 0, rng);
      expect(action).not.toBeNull();
      const result = applyAction(match, action!);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      match = result.state;
      if (match.round?.phase === "ended") {
        declared = true;
        break;
      }
    }
    expect(declared).toBe(true);
    expect(match.round?.result?.declarer).toBe(0);
  });
});

describe("chooseBotAction — stock-empty behavior", () => {
  it("banks displayable melds BEFORE declaring the round dead (review repro — dead rounds score table minus hand)", () => {
    // Stock empty, no legal pickup (K♣ melds with nothing here). The bot
    // must display the 3♠4♠5♠ run first (+15 banked, −15 off the hand — a
    // 30-point swing), THEN declare dead, ending at +5 instead of −25.
    let match = mkMatch({
      hands: [["3S", "4S", "5S", "9H", "2D"], ["7D", "8D", "6D"]],
      line: ["KC"],
      stock: [],
      turn: 0,
      phase: "awaitTake",
    });
    const first = chooseBotAction(match, 0, rng);
    expect(first).not.toBeNull();
    expect(first!.type).toBe("display");
    let result = applyAction(match, first!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    match = result.state;

    const second = chooseBotAction(match, 0, rng);
    expect(second).not.toBeNull();
    expect(second!.type).toBe("declareDead");
    result = applyAction(match, second!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    match = result.state;

    expect(match.round?.result?.declarer).toBeNull();
    expect(match.round?.result?.scores[0]).toBe(15 - 10); // banked run, 9♥+2♦ left in hand
  });

  it("never stalls when the stock is empty and it is the bot's turn to take", () => {
    const match = mkMatch({
      hands: [["2S", "3S", "9H"], ["7D", "8D", "6D"]],
      line: ["KC", "QD"],
      stock: [],
      turn: 0,
      phase: "awaitTake",
    });
    const action = chooseBotAction(match, 0, rng);
    expect(action).not.toBeNull();
  });
});

describe("chooseBotAction — determinism", () => {
  it("returns identical actions for the same seed/state across repeated calls", () => {
    const match = mkMatch({
      hands: [["2D", "3D", "9H", "8C", "7S", "7H", "7C"], ["6D", "8D", "9D"]],
      line: ["5C", "6C"],
      stock: ["2C", "3C", "4S"],
      turn: 0,
      phase: "awaitTake",
    });
    const mulberry32 = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const a = chooseBotAction(match, 0, mulberry32(777));
    const b = chooseBotAction(match, 0, mulberry32(777));
    expect(a).toEqual(b);
  });
});
