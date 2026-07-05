import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ack, RoomView } from "../src/protocol.js";
import { c, cc, craftMatch } from "./craft.js";
import { createLobby, emitAck, expectAckOk, startTestServer, type TestClient, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  ts = await startTestServer();
});
afterEach(async () => {
  await ts.close();
});

/** Start a 2-human room and swap in a crafted match state for exact scenarios. */
async function craftedRoom(spec: Parameters<typeof craftMatch>[0]) {
  const lobby = await createLobby(ts, ["A", "B"]);
  expectAckOk(await emitAck(lobby.host.socket, "room:start"));
  await lobby.guest.waitState((v) => v.phase === "playing");
  const room = ts.server.rooms.get(lobby.code)!;
  room.match = craftMatch(spec);
  return { ...lobby, room };
}

describe("out-of-turn free actions over real sockets", () => {
  it("lets a player display and attach during the other player's turn", async () => {
    const { host, guest } = await craftedRoom({
      hands: [["9C", "8H", "4D"], ["QS", "KS", "AS", "2S", "5H"]],
      turn: 0, // seat 0's turn — seat 1 acts anyway
      phase: "awaitTake",
    });
    // seat 1 displays a circular-wrap run out of turn
    const displayed = await emitAck(guest.socket, "game:action", {
      type: "display",
      cardIds: cc(["QS", "KS", "AS"]),
    });
    expectAckOk(displayed);
    // ... and immediately attaches to its own new set, still out of turn
    const attached = await emitAck(guest.socket, "game:action", {
      type: "attach",
      setId: "set-1",
      cardIds: cc(["2S"]),
    });
    expectAckOk(attached);

    const view = await host.waitState(
      (v) => (v.game?.round?.sets[0]?.cards.length ?? 0) === 4,
    );
    expect(view.game!.round!.sets[0]!.cards).toEqual(cc(["QS", "KS", "AS", "2S"]));
    expect(view.game!.round!.turn).toBe(0); // turn never moved
    expect(view.game!.round!.handCounts[1]).toBe(1);
    // the interleaved turn continues normally for seat 0
    expectAckOk(await emitAck(host.socket, "game:action", { type: "drawStock" }));
  });

  it("bounces illegal out-of-turn actions with engine reasons", async () => {
    const { guest } = await craftedRoom({
      hands: [["9C", "8H"], ["QS", "KS", "2H", "5H"]],
      turn: 0,
    });
    expect(
      await emitAck(guest.socket, "game:action", { type: "display", cardIds: cc(["QS", "KS", "2H"]) }),
    ).toMatchObject({ ok: false, code: "INVALID_MELD" });
    expect(
      await emitAck(guest.socket, "game:action", { type: "attach", setId: "set-1", cardIds: cc(["5H"]) }),
    ).toMatchObject({ ok: false, code: "NEED_OWN_SET" });
  });
});

describe("arrival-order serialization", () => {
  it("resolves two racing conflicting attaches: exactly one wins, one bounces", async () => {
    // Both seats hold a copy of 5♦; the run can only take one.
    const { host, guest } = await craftedRoom({
      hands: [["5D#1", "9C", "8H"], ["5D#2", "QC", "JH"]],
      sets: [
        { kind: "run", createdBy: 0, cards: ["2D", "3D", "4D"] },
        { kind: "group", createdBy: 1, cards: ["7S", "7H", "7C"] },
      ],
      turn: 0,
    });
    const [first, second] = await Promise.all([
      emitAck(host.socket, "game:action", { type: "attach", setId: "set-1", cardIds: ["5D#1"] }),
      emitAck(guest.socket, "game:action", { type: "attach", setId: "set-1", cardIds: ["5D#2"] }),
    ]);
    const oks = [first, second].filter((r) => r.ok);
    const rejections = [first, second].filter((r) => !r.ok) as Extract<Ack, { ok: false }>[];
    expect(oks).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.code).toBe("INVALID_ATTACH"); // duplicate rank in a run

    const view = await host.waitState((v) => (v.game?.round?.sets[0]?.cards.length ?? 0) === 4);
    expect(view.game!.round!.sets[0]!.cards.filter((id) => id.startsWith("5D"))).toHaveLength(1);
  });

  it("processes a burst of actions from both players without losing consistency", async () => {
    const { host, guest, room } = await craftedRoom({
      hands: [
        ["6S", "6H", "6D", "9C", "8H"],
        ["10C", "JC", "QC", "4H", "3H"],
      ],
      turn: 0,
      stock: ["2C", "3C", "4C", "5C"],
    });
    const results = await Promise.all([
      emitAck(host.socket, "game:action", { type: "drawStock" }),
      emitAck(host.socket, "game:action", { type: "display", cardIds: cc(["6S", "6H", "6D"]) }),
      emitAck(guest.socket, "game:action", { type: "display", cardIds: cc(["10C", "JC", "QC"]) }),
      emitAck(guest.socket, "game:action", { type: "drawStock" }), // not their turn — must bounce
    ]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({ ok: true });
    // The guest's draw always bounces, but the reason depends on arrival
    // order relative to the host's draw: both are correct serializations.
    expect(results[3]!.ok).toBe(false);
    expect(["NOT_YOUR_TURN", "WRONG_PHASE"]).toContain((results[3] as { code: string }).code);
    expect(room.match!.round!.sets).toHaveLength(2);
    // card conservation on the server's authoritative state
    const zones =
      room.match!.round!.hands.flat().length +
      room.match!.round!.stock.length +
      room.match!.round!.line.length +
      room.match!.round!.sets.reduce((n, s) => n + s.cards.length, 0);
    expect(zones).toBe(5 + 5 + 4 + 1); // hands + stock + line(1 starter)
  });
});

describe("full games", () => {
  async function playScripted(
    client: TestClient,
    seat: number,
    stop: (v: RoomView) => boolean,
  ): Promise<RoomView> {
    // Minimal legal player: draw (or declare dead), then discard the first card.
    // No melding — this exercises rejections, redaction, and turn flow.
    let cursor = 0;
    for (let guard = 0; guard < 3000; guard++) {
      const view = await client.waitState(
        (v) => stop(v) || (v.game?.round?.phase !== "ended" && v.game?.round?.turn === seat),
        20000,
        cursor,
      );
      if (stop(view)) return view;
      // Exclude everything already seen: the state we act on is consumed, and
      // the broadcast triggered by our own action arrives after this point.
      cursor = client.states.length;
      const round = view.game!.round!;
      if (round.phase === "awaitTake") {
        const drew = await emitAck(client.socket, "game:action", { type: "drawStock" });
        if (!drew.ok && drew.code === "STOCK_EMPTY") {
          await emitAck(client.socket, "game:action", { type: "declareDead" });
        }
      } else if (round.phase === "awaitDiscard") {
        const hand = round.hands[seat]!;
        await emitAck(client.socket, "game:action", { type: "discard", cardId: hand[0]! });
      }
    }
    throw new Error("scripted player never reached the stop condition");
  }

  it("drives a REAL-DEAL two-human game through multiple rounds and intermissions", async () => {
    const { host, guest } = await createLobby(ts, ["Amma", "Kid"]);
    expectAckOk(await emitAck(host.socket, "room:start"));
    await guest.waitState((v) => v.phase === "playing");

    // Both humans play draw/discard until two full rounds have completed
    // (they never meld, so rounds end dead when the stock drains and the
    // between-round intermission auto-deals the next one).
    const twoRounds = (v: RoomView) => (v.game?.roundsPlayed ?? 0) >= 2;
    const [hostFinal, guestFinal] = await Promise.all([
      playScripted(host, 0, twoRounds),
      playScripted(guest, 1, twoRounds),
    ]);

    for (const final of [hostFinal, guestFinal]) {
      expect(final.game!.roundsPlayed).toBeGreaterThanOrEqual(2);
      expect(final.game!.history.length).toBe(final.game!.roundsPlayed);
      for (const result of final.game!.history) {
        expect(result.declarer).toBeNull(); // nobody melded → dead rounds
        result.scores.forEach((s) => expect(s).toBeLessThanOrEqual(0));
      }
    }
    // redaction held in EVERY broadcast either client ever received
    for (const [client, other] of [
      [host, 1],
      [guest, 0],
    ] as const) {
      for (const v of client.states) {
        if (!v.game?.round) continue;
        expect(v.game.round.hands[other]).toBeNull();
        expect("stock" in v.game.round).toBe(false);
        expect("seed" in v.game.config).toBe(false);
      }
    }
    // the dealer rotated across rounds: both seats dealt at least once
    const dealersSeen = new Set(
      host.states.filter((v) => v.game?.round?.phase === "awaitTake").map((v) => v.game!.round!.dealer),
    );
    expect(dealersSeen.size).toBeGreaterThanOrEqual(2);
  }, 60000);

  it("plays a human + 2 bots room to completion over real sockets", async () => {
    const host = ts.connect();
    const created = await emitAck<{ code: string; seat: number }>(host.socket, "room:create", {
      nickname: "Human",
      settings: { botCount: 2, targetScore: 40 },
    });
    expectAckOk(created);
    expectAckOk(await emitAck(host.socket, "room:start"));

    const finalView = await playScripted(host, 0, (v) => v.phase === "over");
    expect(finalView.phase).toBe("over");
    expect(finalView.game!.phase).toBe("finished");
    expect(finalView.game!.winner).not.toBeNull();
    expect(finalView.game!.history.length).toBeGreaterThanOrEqual(1);
    expect(finalView.game!.totals).toHaveLength(3);
    // the human never melded, so every round scored them table(0) − hand
    expect(finalView.game!.totals[0]).toBeLessThanOrEqual(0);
    // round results were broadcast along the way
    expect(
      host.states.some((v) => v.game?.round?.result != null),
    ).toBe(true);
  }, 60000);

  it("advances rounds via host round:next skip without waiting out the intermission", async () => {
    const ts2 = await startTestServer({ intermissionMs: 60_000 });
    try {
      const { host, guest, room } = await (async () => {
        const lobby = await createLobby(ts2, ["A", "B"]);
        expectAckOk(await emitAck(lobby.host.socket, "room:start"));
        await lobby.guest.waitState((v) => v.phase === "playing");
        const room = ts2.server.rooms.get(lobby.code)!;
        // hand seat 1 an immediate declare: their turn, own run, one spare card
        room.match = craftMatch({
          hands: [["9C", "8H", "4D"], ["2C"]],
          sets: [{ kind: "run", createdBy: 1, cards: ["JH", "QH", "KH"] }],
          turn: 1,
          phase: "awaitDiscard",
          targetScore: 500,
        });
        return { ...lobby, room };
      })();
      expectAckOk(await emitAck(guest.socket, "game:action", { type: "discard", cardId: c("2C") }));
      const ended = await host.waitState((v) => v.game?.phase === "betweenRounds");
      expect(ended.game!.round!.result!.declarer).toBe(1);
      // guest cannot advance; host can, immediately
      expect(await emitAck(guest.socket, "round:next")).toMatchObject({ ok: false, code: "NOT_HOST" });
      const cursor = host.states.length; // the pre-craft deal also broadcast roundActive
      expectAckOk(await emitAck(host.socket, "round:next"));
      const dealt = await host.waitState((v) => v.game?.phase === "roundActive", 8000, cursor);
      expect(dealt.game!.roundsPlayed).toBe(1);
      expect(dealt.game!.round!.handCounts).toEqual([10, 10]);
      expect(room.match!.round!.dealer).toBe(0); // crafted dealer 1 rotated to 0
    } finally {
      await ts2.close();
    }
  });
});
