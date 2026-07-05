import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomView } from "../src/protocol.js";
import { craftMatch } from "./craft.js";
import { createLobby, emitAck, expectAckOk, startTestServer, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  ts = await startTestServer();
});
afterEach(async () => {
  await ts.close();
});

describe("reconnect", () => {
  it("reclaims the seat mid-round and receives the full current state", async () => {
    const { host, guest, code, guestToken } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await guest.waitState((v) => v.phase === "playing");
    const room = ts.server.rooms.get(code)!;
    room.match = craftMatch({
      hands: [["9C", "8H"], ["QS", "KS", "AS", "5H"]],
      sets: [{ kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] }],
      turn: 1,
      phase: "awaitTake",
    });

    // the kid's phone locks
    guest.socket.disconnect();
    const sawDrop = await host.waitState((v) => v.seats[1]?.connected === false);
    expect(sawDrop.seats[1]!.connected).toBe(false);

    // ... and comes back on a fresh socket with the stored token
    const revived = ts.connect();
    const res = await emitAck<{ seat: number; view: RoomView }>(revived.socket, "room:reconnect", {
      code,
      token: guestToken,
    });
    expectAckOk(res);
    expect(res.seat).toBe(1);
    expect(res.view.phase).toBe("playing");
    expect(res.view.game!.round!.hands[1]).toEqual(room.match!.round!.hands[1]);
    expect(res.view.game!.round!.hands[0]).toBeNull(); // still redacted

    await host.waitState((v) => v.seats[1]?.connected === true);
    // the reclaimed seat plays on: it is their turn
    expectAckOk(await emitAck(revived.socket, "game:action", { type: "drawStock" }));
  });

  it("rejects bad tokens and unknown rooms", async () => {
    const { code } = await createLobby(ts, ["Amma", "Kid"]);
    const stranger = ts.connect();
    expect(
      await emitAck(stranger.socket, "room:reconnect", { code, token: "not-a-token" }),
    ).toMatchObject({ ok: false, code: "BAD_TOKEN" });
    expect(
      await emitAck(stranger.socket, "room:reconnect", { code: "NOSUCH", token: "x" }),
    ).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });

  it("kicks the old socket when the same seat reconnects from another window", async () => {
    const { guest, code, guestToken } = await createLobby(ts, ["Amma", "Kid"]);
    const kicked = new Promise<string>((resolve) => guest.socket.on("room:kicked", resolve));
    const second = ts.connect();
    expectAckOk(await emitAck(second.socket, "room:reconnect", { code, token: guestToken }));
    expect(await kicked).toMatch(/another window/);
    // the seat still works from the new socket
    const room = ts.server.rooms.get(code)!;
    expect(room.seats[1]).toMatchObject({ kind: "human" });
  });

  it("pauses bots while no human is connected and resumes on reconnect", async () => {
    const host = ts.connect();
    const created = await emitAck<{ code: string; token: string }>(host.socket, "room:create", {
      nickname: "Human",
      settings: { botCount: 2, targetScore: 500 },
    });
    expectAckOk(created);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await host.waitState((v) => v.phase === "playing");

    host.socket.disconnect();
    await new Promise((r) => setTimeout(r, 60)); // let any in-flight bot tick land
    const room = ts.server.rooms.get(created.code)!;
    const frozen = JSON.stringify(room.match);
    await new Promise((r) => setTimeout(r, 120)); // bots tick every ~2ms when alive
    expect(JSON.stringify(room.match)).toBe(frozen);

    const revived = ts.connect();
    expectAckOk(await emitAck(revived.socket, "room:reconnect", { code: created.code, token: created.token }));
    await new Promise((r) => setTimeout(r, 150));
    expect(JSON.stringify(room.match)).not.toBe(frozen);
  });
});

describe("room garbage collection", () => {
  it("drops idle rooms with nobody connected, keeps live ones", async () => {
    const ts2 = await startTestServer({ roomTtlMs: 50, sweepIntervalMs: 25 });
    try {
      const abandoned = ts2.connect();
      const created = await emitAck<{ code: string }>(abandoned.socket, "room:create", {
        nickname: "Ghost",
      });
      expectAckOk(created);
      const livingClient = ts2.connect();
      const living = await emitAck<{ code: string }>(livingClient.socket, "room:create", {
        nickname: "Here",
      });
      expectAckOk(living);

      abandoned.socket.disconnect();
      await new Promise((r) => setTimeout(r, 200));

      expect(ts2.server.rooms.get(created.code)).toBeUndefined();
      expect(ts2.server.rooms.get(living.code)).toBeDefined();
      const late = ts2.connect();
      expect(
        await emitAck(late.socket, "room:join", { code: created.code, nickname: "X" }),
      ).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
    } finally {
      await ts2.close();
    }
  });
});
