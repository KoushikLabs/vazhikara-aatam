import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomView } from "../src/protocol.js";
import { createLobby, emitAck, expectAckOk, startTestServer, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  ts = await startTestServer();
});
afterEach(async () => {
  await ts.close();
});

describe("room lifecycle", () => {
  it("creates a room with an unguessable code and the creator as host seat 0", async () => {
    const host = ts.connect();
    const created = await emitAck<{ code: string; seat: number; token: string; view: RoomView }>(
      host.socket,
      "room:create",
      { nickname: "Amma" },
    );
    expectAckOk(created);
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.seat).toBe(0);
    expect(created.token).toMatch(/[0-9a-f-]{36}/);
    expect(created.view.phase).toBe("lobby");
    expect(created.view.seats).toEqual([{ nickname: "Amma", isBot: false, connected: true }]);
  });

  it("joins by code, broadcasts the lobby, and rejects bad joins", async () => {
    const { host, guest, code } = await createLobby(ts, ["Amma", "Kid"]);
    const hostView = await host.waitState((v) => v.seats.length === 2);
    expect(hostView.seats[1]).toEqual({ nickname: "Kid", isBot: false, connected: true });

    const third = ts.connect();
    expect(await emitAck(third.socket, "room:join", { code: "ZZZZZZ", nickname: "X" })).toMatchObject({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });
    expect(await emitAck(third.socket, "room:join", { code, nickname: "kid" })).toMatchObject({
      ok: false,
      code: "NICKNAME_TAKEN",
    });
    expect(await emitAck(third.socket, "room:join", { code, nickname: "   " })).toMatchObject({
      ok: false,
      code: "BAD_NICKNAME",
    });
    void guest;
  });

  it("host configures settings; non-hosts cannot; bad values rejected", async () => {
    const { host, guest } = await createLobby(ts, ["Amma", "Kid"]);
    const configured = await emitAck(host.socket, "room:configure", {
      targetScore: 200,
      botCount: 2,
      decks: 3,
    });
    expectAckOk(configured);
    const view = await guest.waitState((v) => v.settings.targetScore === 200);
    expect(view.settings).toEqual({ decks: 3, targetScore: 200, botCount: 2 });

    expect(await emitAck(guest.socket, "room:configure", { targetScore: 300 })).toMatchObject({
      ok: false,
      code: "NOT_HOST",
    });
    expect(await emitAck(host.socket, "room:configure", { decks: 9 })).toMatchObject({
      ok: false,
      code: "BAD_SETTINGS",
    });
    expect(await emitAck(host.socket, "room:configure", { botCount: 5 })).toMatchObject({
      ok: false,
      code: "BAD_SETTINGS", // 2 humans + 5 bots > 6
    });
  });

  it("start deals a round, appends bots, and locks the room to new joiners", async () => {
    const { host, guest, code } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:configure", { botCount: 1, targetScore: 500 }));
    expect(await emitAck(guest.socket, "room:start")).toMatchObject({ ok: false, code: "NOT_HOST" });
    expectAckOk(await emitAck(host.socket, "room:start"));

    const view = await host.waitState((v) => v.phase === "playing");
    expect(view.seats).toHaveLength(3);
    expect(view.seats[2]).toMatchObject({ nickname: "Bot 1", isBot: true, connected: true });
    expect(view.game?.phase).toBe("roundActive");
    expect(view.game?.round?.handCounts).toEqual([10, 10, 10]);
    expect(view.game?.config.decks).toBe(2); // auto for 3 players

    const late = ts.connect();
    expect(await emitAck(late.socket, "room:join", { code, nickname: "Late" })).toMatchObject({
      ok: false,
      code: "ROOM_STARTED",
    });
  });

  it("carries a host deck override through to the dealt match", async () => {
    const { host, guest } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:configure", { decks: 3 })); // auto would be 1
    expectAckOk(await emitAck(host.socket, "room:start"));
    const view = await guest.waitState((v) => v.phase === "playing");
    expect(view.game!.config.decks).toBe(3);
    expect(view.game!.round!.stockCount).toBe(52 * 3 - 20 - 1);
  });

  it("cannot start alone or with invalid totals", async () => {
    const host = ts.connect();
    const created = await emitAck<{ code: string }>(host.socket, "room:create", { nickname: "Solo" });
    expectAckOk(created);
    expect(await emitAck(host.socket, "room:start")).toMatchObject({ ok: false, code: "BAD_SETTINGS" });
    // solo + bots is the supported solo mode
    expectAckOk(await emitAck(host.socket, "room:configure", { botCount: 2 }));
    expectAckOk(await emitAck(host.socket, "room:start"));
    const view = await host.waitState((v) => v.phase === "playing");
    expect(view.seats.filter((s) => s.isBot)).toHaveLength(2);
  });

  it("stamps the acting seat from the socket — payload seat spoofing is ignored", async () => {
    const { host, code } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await host.waitState((v) => v.phase === "playing");
    const room = ts.server.rooms.get(code)!;
    const turn = room.match!.round!.turn;
    // With 2 players and dealer 0, seat 1 takes the first turn — the HOST
    // (seat 0) sends a draw pretending to be the turn seat.
    expect(turn).toBe(1);
    const spoofed = await emitAck(host.socket, "game:action", { type: "drawStock", seat: turn });
    expect(spoofed).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
  });

  it("rejects malformed action payloads without crashing", async () => {
    const { host, code } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await host.waitState((v) => v.phase === "playing");
    for (const bad of [
      null,
      42,
      { type: "hackTheGibson" },
      { type: "discard" },
      { type: "pickupLine", lineIndex: "zero", meldCardIds: ["2D#1"] },
      { type: "display", cardIds: [1, 2, 3] },
    ]) {
      expect(await emitAck(host.socket, "game:action", bad)).toMatchObject({
        ok: false,
        code: "BAD_ACTION",
      });
    }
    expect(ts.server.rooms.get(code)).toBeDefined();
  });
});
