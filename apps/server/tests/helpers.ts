import type { AddressInfo } from "node:net";
import { mulberry32 } from "@vazhikara/engine";
import { io as connectClient, type Socket } from "socket.io-client";
import { createGameServer, type GameServer, type GameServerOptions } from "../src/server.js";
import type { Ack, RoomView } from "../src/protocol.js";

export interface TestClient {
  socket: Socket;
  /** Every room:state view received, in order. */
  states: RoomView[];
  /**
   * Resolves with the first state matching the predicate — scanning history
   * from `sinceIndex` first (a match may have landed before the call), then
   * waiting for new broadcasts.
   */
  waitState(
    predicate: (view: RoomView) => boolean,
    timeoutMs?: number,
    sinceIndex?: number,
  ): Promise<RoomView>;
  latest(): RoomView | undefined;
}

export interface TestServer {
  server: GameServer;
  port: number;
  url: string;
  connect(): TestClient;
  close(): Promise<void>;
}

export async function startTestServer(opts: GameServerOptions = {}): Promise<TestServer> {
  const server = createGameServer({
    botDelayMs: () => 2,
    intermissionMs: 15,
    roomTtlMs: 60_000,
    sweepIntervalMs: 30_000,
    seedFn: () => 424242,
    botRng: mulberry32(7),
    ...opts,
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const port = (server.httpServer.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  const clients: TestClient[] = [];

  function connect(): TestClient {
    const socket = connectClient(url, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    const states: RoomView[] = [];
    const waiters: Array<{ predicate: (v: RoomView) => boolean; resolve: (v: RoomView) => void }> = [];
    socket.on("room:state", (view: RoomView) => {
      states.push(view);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.predicate(view)) {
          const [w] = waiters.splice(i, 1);
          w!.resolve(view);
        }
      }
    });
    const client: TestClient = {
      socket,
      states,
      latest: () => states[states.length - 1],
      waitState(predicate, timeoutMs = 8000, sinceIndex = 0) {
        // A matching state may have arrived before the waiter registered.
        for (let i = states.length - 1; i >= sinceIndex; i--) {
          if (predicate(states[i]!)) return Promise.resolve(states[i]!);
        }
        return new Promise<RoomView>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`waitState timed out after ${timeoutMs}ms (${states.length} states seen)`)),
            timeoutMs,
          );
          waiters.push({
            predicate,
            resolve: (v) => {
              clearTimeout(timer);
              resolve(v);
            },
          });
        });
      },
    };
    clients.push(client);
    return client;
  }

  return {
    server,
    port,
    url,
    connect,
    close: async () => {
      for (const c of clients) if (c.socket.connected) c.socket.disconnect();
      await server.close();
      await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    },
  };
}

/** Emit with an ack callback, promisified, with a timeout. */
export function emitAck<T = unknown>(
  socket: Socket,
  event: string,
  ...args: unknown[]
): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 8000);
    socket.emit(event, ...args, (res: Ack<T>) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

export function expectAckOk<T>(ack: Ack<T>): asserts ack is { ok: true } & T {
  if (!ack.ok) throw new Error(`expected ok ack, got ${ack.code}: ${ack.message}`);
}

/** Create a room + join a second player; returns both clients ready in the lobby. */
export async function createLobby(ts: TestServer, nicknames: [string, string]) {
  const host = ts.connect();
  const guest = ts.connect();
  const created = await emitAck<{ code: string; seat: number; token: string; view: RoomView }>(
    host.socket,
    "room:create",
    { nickname: nicknames[0] },
  );
  expectAckOk(created);
  const joined = await emitAck<{ code: string; seat: number; token: string; view: RoomView }>(
    guest.socket,
    "room:join",
    { code: created.code, nickname: nicknames[1] },
  );
  expectAckOk(joined);
  return { host, guest, code: created.code, hostToken: created.token, guestToken: joined.token };
}
