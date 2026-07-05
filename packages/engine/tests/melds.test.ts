import { describe, expect, it } from "vitest";
import {
  attachedSetCards,
  classifyMeld,
  isValidGroup,
  isValidRun,
  nextRank,
  prevRank,
  runOrder,
} from "../src/melds.js";
import { cc } from "./helpers.js";

describe("circular rank order", () => {
  it("wraps K → A and A → K", () => {
    expect(nextRank(13)).toBe(1);
    expect(prevRank(1)).toBe(13);
    expect(nextRank(1)).toBe(2);
    expect(prevRank(2)).toBe(1);
  });
});

describe("groups", () => {
  it("accepts 3+ of the same rank, suits unrestricted", () => {
    expect(isValidGroup(cc(["AS", "AH", "AD"]))).toBe(true);
    expect(isValidGroup(cc(["QS", "QH", "QD", "QC"]))).toBe(true);
  });
  it("accepts identical duplicates from multiple decks (9♠ 9♠ 9♥)", () => {
    expect(isValidGroup(["9S#1", "9S#2", "9H#1"])).toBe(true);
  });
  it("can grow without limit up to all copies in play", () => {
    const all = ["2S#1", "2S#2", "2S#3", "2H#1", "2H#2", "2H#3", "2D#1", "2D#2"];
    expect(isValidGroup(all)).toBe(true);
  });
  it("rejects fewer than 3 cards or mixed ranks", () => {
    expect(isValidGroup(cc(["AS", "AH"]))).toBe(false);
    expect(isValidGroup(cc(["AS", "AH", "KD"]))).toBe(false);
  });
});

describe("runs (circular, same suit)", () => {
  it("accepts plain ascending runs", () => {
    expect(isValidRun(cc(["2D", "3D", "4D"]))).toBe(true);
    expect(isValidRun(cc(["9C", "10C", "JC", "QC"]))).toBe(true);
  });
  it("accepts runs across the K-A boundary: K-A-2 and J-Q-K-A-2", () => {
    expect(isValidRun(cc(["KH", "AH", "2H"]))).toBe(true);
    expect(isValidRun(cc(["JH", "QH", "KH", "AH", "2H"]))).toBe(true);
    expect(isValidRun(cc(["QS", "KS", "AS"]))).toBe(true);
  });
  it("ignores input order and canonicalizes", () => {
    expect(runOrder(cc(["2H", "KH", "AH"]))).toEqual(cc(["KH", "AH", "2H"]));
    expect(runOrder(cc(["4D", "2D", "3D"]))).toEqual(cc(["2D", "3D", "4D"]));
    expect(runOrder(cc(["AS", "2S", "3S", "KS"]))).toEqual(cc(["KS", "AS", "2S", "3S"]));
  });
  it("accepts the full 13-card circle and nothing longer", () => {
    const all13 = cc(["AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS"]);
    expect(isValidRun(all13)).toBe(true);
    expect(runOrder(all13)?.[0]).toBe("AS#1"); // canonical full circle starts at the ace
    // 14 cards must repeat a rank, which is always rejected
    expect(isValidRun([...all13, "AS#2"])).toBe(false);
  });
  it("rejects duplicate ranks even from different decks", () => {
    expect(isValidRun(["4D#1", "4D#2", "5D#1", "6D#1"])).toBe(false);
    expect(isValidRun(["4D#1", "5D#1", "5D#2"])).toBe(false);
  });
  it("rejects mixed suits — runs are never cross-suit", () => {
    expect(isValidRun(cc(["2D", "3D", "4H"]))).toBe(false);
    expect(isValidRun(cc(["KH", "AS", "2H"]))).toBe(false);
  });
  it("rejects gaps and disconnected segments", () => {
    expect(isValidRun(cc(["AD", "2D", "4D"]))).toBe(false);
    expect(isValidRun(cc(["2C", "3C", "KC"]))).toBe(false);
    expect(isValidRun(cc(["2C", "3C", "4C", "9C", "10C", "JC"]))).toBe(false);
  });
  it("rejects fewer than 3 cards", () => {
    expect(isValidRun(cc(["2D", "3D"]))).toBe(false);
  });
});

describe("classifyMeld", () => {
  it("labels groups and runs", () => {
    expect(classifyMeld(cc(["7S", "7H", "7D"]))).toBe("group");
    expect(classifyMeld(cc(["QH", "KH", "AH"]))).toBe("run");
  });
  it("returns null for invalid melds", () => {
    expect(classifyMeld(cc(["7S", "7H", "8D"]))).toBeNull();
    expect(classifyMeld(cc(["2D", "3D"]))).toBeNull();
  });
});

describe("attachedSetCards", () => {
  it("extends runs in either circular direction", () => {
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), cc(["5D"]))).toEqual(
      cc(["2D", "3D", "4D", "5D"]),
    );
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), cc(["AD"]))).toEqual(
      cc(["AD", "2D", "3D", "4D"]),
    );
  });
  it("extends runs around the K-A corner", () => {
    expect(attachedSetCards("run", cc(["AH", "2H", "3H"]), cc(["KH"]))).toEqual(
      cc(["KH", "AH", "2H", "3H"]),
    );
    expect(attachedSetCards("run", cc(["QH", "KH", "AH"]), cc(["2H"]))).toEqual(
      cc(["QH", "KH", "AH", "2H"]),
    );
  });
  it("accepts multi-card extensions, both ends at once", () => {
    expect(attachedSetCards("run", cc(["4S", "5S", "6S"]), cc(["7S", "3S", "8S"]))).toEqual(
      cc(["3S", "4S", "5S", "6S", "7S", "8S"]),
    );
  });
  it("completes the full 13-card circle but never more", () => {
    const run = cc(["4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS"]);
    const completion = cc(["AS", "2S", "3S"]);
    const full = attachedSetCards("run", run, completion);
    expect(full).toHaveLength(13);
    expect(attachedSetCards("run", full!, ["4S#2"])).toBeNull();
  });
  it("rejects duplicate ranks, wrong suits, and non-adjacent cards", () => {
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), ["4D#2"])).toBeNull();
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), cc(["5H"]))).toBeNull();
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), cc(["7D"]))).toBeNull();
    expect(attachedSetCards("run", cc(["2D", "3D", "4D"]), cc(["5D", "8D"]))).toBeNull();
  });
  it("extends groups with same-rank cards including duplicate copies", () => {
    expect(attachedSetCards("group", cc(["AS", "AH", "AD"]), cc(["AC"]))).toHaveLength(4);
    expect(attachedSetCards("group", ["9S#1", "9H#1", "9D#1"], ["9S#2"])).toHaveLength(4);
  });
  it("rejects group attachments of a different rank", () => {
    expect(attachedSetCards("group", cc(["AS", "AH", "AD"]), cc(["KS"]))).toBeNull();
  });
  it("rejects empty attachments", () => {
    expect(attachedSetCards("group", cc(["AS", "AH", "AD"]), [])).toBeNull();
  });
});
