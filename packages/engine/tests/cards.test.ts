import { describe, expect, it } from "vitest";
import {
  buildDecks,
  cardFromId,
  cardPoints,
  makeCardId,
  mulberry32,
  shuffle,
  sumPoints,
} from "../src/cards.js";

describe("card points", () => {
  it("scores A = 15", () => {
    expect(cardPoints("AS#1")).toBe(15);
    expect(cardPoints(1)).toBe(15);
  });
  it("scores K, Q, J, 10 = 10", () => {
    for (const id of ["KS#1", "QH#1", "JD#1", "10C#1"]) {
      expect(cardPoints(id)).toBe(10);
    }
  });
  it("scores 2 through 9 = 5", () => {
    for (const token of ["2", "3", "4", "5", "6", "7", "8", "9"]) {
      expect(cardPoints(`${token}S#1`)).toBe(5);
    }
  });
  it("sums points over ids", () => {
    expect(sumPoints(["AS#1", "KS#1", "5S#1"])).toBe(30);
  });
});

describe("card ids", () => {
  it("round-trips ranks and suits including 10", () => {
    const id = makeCardId(10, "H", 3);
    expect(id).toBe("10H#3");
    const card = cardFromId(id);
    expect(card).toMatchObject({ rank: 10, suit: "H", copy: 3 });
  });
  it("parses face cards and aces", () => {
    expect(cardFromId("AS#1")).toMatchObject({ rank: 1, suit: "S", copy: 1 });
    expect(cardFromId("KC#2")).toMatchObject({ rank: 13, suit: "C", copy: 2 });
    expect(cardFromId("JD#3")).toMatchObject({ rank: 11, suit: "D", copy: 3 });
  });
  it("rejects malformed ids", () => {
    expect(() => cardFromId("XX#1")).toThrow();
    expect(() => cardFromId("9S")).toThrow();
    expect(() => cardFromId("9S#0")).toThrow();
  });
});

describe("deck building", () => {
  it.each([
    [1, 52],
    [2, 104],
    [3, 156],
  ])("%i deck(s) → %i unique per-copy ids, no jokers", (decks, count) => {
    const ids = buildDecks(decks);
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
  });
  it("gives duplicate physical cards distinct ids across decks", () => {
    const ids = buildDecks(2);
    expect(ids).toContain("9S#1");
    expect(ids).toContain("9S#2");
    expect(ids).not.toContain("9S#3");
  });
});

describe("seeded shuffle", () => {
  it("is deterministic for the same seed", () => {
    const deck = buildDecks(1);
    expect(shuffle(deck, mulberry32(42))).toEqual(shuffle(deck, mulberry32(42)));
  });
  it("differs across seeds and preserves the multiset", () => {
    const deck = buildDecks(1);
    const a = shuffle(deck, mulberry32(1));
    const b = shuffle(deck, mulberry32(2));
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...deck].sort());
    expect(deck[0]).toBe("AS#1"); // input untouched
  });
});
