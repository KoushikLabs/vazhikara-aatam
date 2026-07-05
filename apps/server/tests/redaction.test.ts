import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLobby, emitAck, expectAckOk, startTestServer, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  ts = await startTestServer();
});
afterEach(async () => {
  await ts.close();
});

describe("hidden-information redaction", () => {
  it("shows each player their own hand only; stock and other hands are counts", async () => {
    const { host, guest, code } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    const hostView = await host.waitState((v) => v.phase === "playing");
    const guestView = await guest.waitState((v) => v.phase === "playing");

    const room = ts.server.rooms.get(code)!;
    const truth = room.match!.round!;

    // own hands are visible and match the authoritative state
    expect(hostView.game!.round!.hands[0]).toEqual(truth.hands[0]);
    expect(guestView.game!.round!.hands[1]).toEqual(truth.hands[1]);
    // the other player's hand is null, only a count
    expect(hostView.game!.round!.hands[1]).toBeNull();
    expect(guestView.game!.round!.hands[0]).toBeNull();
    expect(hostView.game!.round!.handCounts).toEqual([10, 10]);
    // the stock is never serialized — only its count
    expect(hostView.game!.round!.stockCount).toBe(52 - 20 - 1);
    expect("stock" in hostView.game!.round!).toBe(false);

    // no card id from the opponent's hand or the stock leaks anywhere in the payload
    const serialized = JSON.stringify(hostView);
    for (const hidden of [...truth.hands[1]!, ...truth.stock]) {
      expect(serialized.includes(`"${hidden}"`)).toBe(false);
    }
  });

  it("never ships the match seed — the deal could be replayed from it", async () => {
    // The deal is a pure function of (seed, roundsPlayed, decks, dealer): a
    // client holding the seed could reconstruct every hidden hand and the
    // exact stock order. The client config must be exactly the public fields.
    const { host } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    const view = await host.waitState((v) => v.phase === "playing");
    expect(Object.keys(view.game!.config).sort()).toEqual(["decks", "playerCount", "targetScore"]);
    expect("seed" in view.game!.config).toBe(false);
    expect(JSON.stringify(view).includes("seed")).toBe(false);
  });

  it("keeps redaction correct as the game progresses", async () => {
    const { host, guest, code } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await guest.waitState((v) => v.phase === "playing");
    const room = ts.server.rooms.get(code)!;
    expect(room.match!.round!.turn).toBe(1); // left of dealer 0

    // guest draws: they see 11 cards, host sees count 11 and one fewer stock card
    expectAckOk(await emitAck(guest.socket, "game:action", { type: "drawStock" }));
    const guestView = await guest.waitState((v) => v.game?.round?.handCounts[1] === 11);
    const hostView = await host.waitState((v) => v.game?.round?.handCounts[1] === 11);
    expect(guestView.game!.round!.hands[1]).toHaveLength(11);
    expect(hostView.game!.round!.hands[1]).toBeNull();
    expect(hostView.game!.round!.stockCount).toBe(52 - 20 - 2);

    // guest discards: the thrown card becomes public in the line for both
    const thrown = room.match!.round!.hands[1]![0]!;
    expectAckOk(await emitAck(guest.socket, "game:action", { type: "discard", cardId: thrown }));
    const after = await host.waitState((v) => (v.game?.round?.line.length ?? 0) === 2);
    expect(after.game!.round!.line[1]).toBe(thrown);
    expect(after.game!.round!.turn).toBe(0);
  });
});
