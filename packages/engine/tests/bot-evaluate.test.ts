import { describe, expect, it } from "vitest";
import { evaluateHand } from "../src/bot.js";
import { cc } from "./helpers.js";

function idsOf(groups: string[][]): string[][] {
  return groups.map((g) => cc(g));
}

describe("evaluateHand", () => {
  it("finds a run meld and prefers it over splitting into deadwood", () => {
    const hand = cc(["2D", "3D", "4D", "9S", "KH"]);
    const evalResult = evaluateHand(hand);
    expect(evalResult.melds).toContainEqual(cc(["2D", "3D", "4D"]));
    expect(evalResult.deadwood.sort()).toEqual(cc(["9S", "KH"]).sort());
  });

  it("finds a group meld (same rank, mixed suits, duplicates allowed)", () => {
    const hand = cc(["7S", "7H", "7D", "2C", "3C"]);
    const evalResult = evaluateHand(hand);
    expect(evalResult.melds).toContainEqual(expect.arrayContaining(cc(["7S", "7H", "7D"])));
    expect(evalResult.melds[0]!).toHaveLength(3);
  });

  it("finds a duplicate-rank group across two decks", () => {
    const hand = cc(["9S#1", "9S#2", "9H#1", "2C", "3C"]);
    const evalResult = evaluateHand(hand);
    const groupMeld = evalResult.melds.find((m) => m.length === 3);
    expect(groupMeld?.sort()).toEqual(cc(["9S#1", "9S#2", "9H#1"]).sort());
  });

  it("finds a same-rank pair as a near-meld (one card from a group)", () => {
    const hand = cc(["5S", "5H", "9D", "2C"]);
    const evalResult = evaluateHand(hand);
    expect(evalResult.melds).toEqual([]);
    expect(evalResult.nearMelds).toContainEqual(
      expect.objectContaining({ kind: "group", needed: 1 }),
    );
    const pairNear = evalResult.nearMelds.find((n) => n.kind === "group");
    expect(pairNear?.cards.sort()).toEqual(cc(["5S", "5H"]).sort());
  });

  it("finds adjacent same-suit run fragments as near-melds", () => {
    const hand = cc(["4D", "5D", "9S", "2C"]);
    const evalResult = evaluateHand(hand);
    const runNear = evalResult.nearMelds.find((n) => n.kind === "run");
    expect(runNear?.cards.sort()).toEqual(cc(["4D", "5D"]).sort());
  });

  it("finds the circular K-A pair as a run near-meld (K and A are adjacent on the circle)", () => {
    const hand = cc(["KD", "AD", "9S", "2C"]);
    const evalResult = evaluateHand(hand);
    const runNear = evalResult.nearMelds.find((n) => n.kind === "run" && n.cards.includes("AD#1"));
    expect(runNear).toBeDefined();
    expect(runNear?.cards.sort()).toEqual(cc(["KD", "AD"]).sort());
  });

  it("finds a gap-1 run fragment (e.g. 4 and 6, missing the 5)", () => {
    const hand = cc(["4H", "6H", "9S", "2C"]);
    const evalResult = evaluateHand(hand);
    const runNear = evalResult.nearMelds.find((n) => n.kind === "run");
    expect(runNear?.cards.sort()).toEqual(cc(["4H", "6H"]).sort());
  });

  it("computes deadwood points correctly for leftover cards", () => {
    // Ace (15) + 9 (5) left over, nothing else forms melds/near-melds.
    const hand = cc(["AS", "9C"]);
    const evalResult = evaluateHand(hand);
    expect(evalResult.deadwood.sort()).toEqual(cc(["AS", "9C"]).sort());
    expect(evalResult.deadwoodPoints).toBe(15 + 5);
  });

  it("partitions a mixed hand into melds, near-melds, and deadwood without double-counting cards", () => {
    const hand = cc(["2D", "3D", "4D", "7S", "7H", "9C", "9D", "KH", "5S"]);
    const evalResult = evaluateHand(hand);
    const allUsed = [
      ...evalResult.melds.flat(),
      ...evalResult.nearMelds.flatMap((n) => n.cards),
      ...evalResult.deadwood,
    ];
    expect(allUsed.sort()).toEqual([...hand].sort());
    expect(new Set(allUsed).size).toBe(allUsed.length); // no card counted twice
  });

  it("handles an empty hand", () => {
    const evalResult = evaluateHand([]);
    expect(evalResult.melds).toEqual([]);
    expect(evalResult.nearMelds).toEqual([]);
    expect(evalResult.deadwood).toEqual([]);
    expect(evalResult.deadwoodPoints).toBe(0);
  });

  it("finds a full 13-card circular run", () => {
    const hand = cc([
      "AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS",
    ]);
    const evalResult = evaluateHand(hand);
    expect(evalResult.melds).toHaveLength(1);
    expect(evalResult.melds[0]).toHaveLength(13);
    expect(evalResult.deadwood).toEqual([]);
  });
});
