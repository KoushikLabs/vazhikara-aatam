import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import sirv from "sirv";
import { Server, type Socket } from "socket.io";
import { applyAction, type Action } from "@vazhikara/engine";
import { chooseBotAction } from "./bots.js";
import { redactMatch } from "./redact.js";
import { RoomManager, type Room } from "./rooms.js";
import type {
  Ack,
  AckError,
  ClientAction,
  CreateRoomRequest,
  JoinRoomRequest,
  JoinedRoom,
  ReconnectRequest,
  ReconnectedRoom,
  RoomSettings,
  RoomView,
} from "./protocol.js";

interface ClientToServerEvents {
  "room:create": (req: CreateRoomRequest, cb: (ack: Ack<JoinedRoom>) => void) => void;
  "room:join": (req: JoinRoomRequest, cb: (ack: Ack<JoinedRoom>) => void) => void;
  "room:reconnect": (req: ReconnectRequest, cb: (ack: Ack<ReconnectedRoom>) => void) => void;
  "room:configure": (req: Partial<RoomSettings>, cb: (ack: Ack) => void) => void;
  "room:start": (cb: (ack: Ack) => void) => void;
  "round:next": (cb: (ack: Ack) => void) => void;
  "game:action": (action: ClientAction, cb: (ack: Ack) => void) => void;
}
interface ServerToClientEvents {
  "room:state": (view: RoomView) => void;
  "room:kicked": (reason: string) => void;
}
interface SocketData {
  code?: string | undefined;
  seat?: number | undefined;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface GameServerOptions {
  httpServer?: http.Server;
  /** Delay before each bot decision tick. Overridden in tests for speed. */
  botDelayMs?: () => number;
  /** Pause between rounds before the next deal (host can skip via round:next). */
  intermissionMs?: number;
  /** Idle time after which a room with no connected humans is dropped. */
  roomTtlMs?: number;
  sweepIntervalMs?: number;
  /** Match seed source — injectable for deterministic tests. */
  seedFn?: () => number;
  /** Bot decision RNG — injectable for deterministic tests. */
  botRng?: () => number;
}

export interface GameServer {
  httpServer: http.Server;
  io: GameIo;
  rooms: RoomManager;
  close(): Promise<void>;
}

const err = (code: AckError["code"], message: string): AckError => ({ ok: false, code, message });

const ACTION_TYPES = new Set(["drawStock", "pickupLine", "display", "attach", "discard", "declareDead"]);

/** Runtime shape check for untrusted action payloads (typing is compile-time only). */
function sanitizeClientAction(payload: unknown): ClientAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const a = payload as Record<string, unknown>;
  if (typeof a.type !== "string" || !ACTION_TYPES.has(a.type)) return null;
  const isCardIds = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= 60 && v.every((x) => typeof x === "string" && x.length <= 10);
  switch (a.type) {
    case "drawStock":
    case "declareDead":
      return { type: a.type };
    case "pickupLine":
      if (!Number.isInteger(a.lineIndex) || !isCardIds(a.meldCardIds)) return null;
      return { type: "pickupLine", lineIndex: a.lineIndex as number, meldCardIds: a.meldCardIds };
    case "display":
      if (!isCardIds(a.cardIds)) return null;
      return { type: "display", cardIds: a.cardIds };
    case "attach":
      if (typeof a.setId !== "string" || a.setId.length > 20 || !isCardIds(a.cardIds)) return null;
      return { type: "attach", setId: a.setId, cardIds: a.cardIds };
    case "discard":
      if (typeof a.cardId !== "string" || a.cardId.length > 10) return null;
      return { type: "discard", cardId: a.cardId };
    default:
      return null;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the built web app lives, if it's been built at all. `WEB_DIST` env
 * wins when set; otherwise it's resolved relative to this file's location
 * (apps/server/src → ../../../web/dist), which is robust whether the server
 * runs its TS source directly (tsx) or a compiled dist/ copy. Returns null
 * (never throws) when nothing is there yet — dev and tests keep passing.
 */
export function resolveWebDist(): string | null {
  const candidate = process.env.WEB_DIST ?? path.resolve(__dirname, "../../web/dist");
  try {
    if (fs.statSync(path.join(candidate, "index.html")).isFile()) return candidate;
  } catch {
    // not built — fall through
  }
  return null;
}

/**
 * Plain "OK" text handler for /healthz and (when no build exists) the app
 * root — kept trivially fetchable so dev/tests don't need a build step.
 */
function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const webDist = resolveWebDist();
  const serveStatic = webDist ? sirv(webDist, { single: true, dev: false }) : null;

  const httpServer =
    options.httpServer ??
    http.createServer((req, res) => {
      if (req.url === "/healthz") return healthHandler(req, res);
      if (serveStatic) {
        // sirv(single:true) only calls next() for paths it cannot serve at
        // all (extension misses — SPA routes get index.html). Answer those
        // with a real 404: a stale phone requesting an old hashed bundle
        // must see a failure, not a cacheable 200 "OK" with the wrong MIME.
        return serveStatic(req, res, () => {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        });
      }
      return healthHandler(req, res);
    });
  // The shipped topology is same-origin (the server serves the frontend), so
  // production has no reason to reflect foreign origins; dev keeps the open
  // reflection for the vite proxy and test harnesses.
  const io: GameIo = new Server(httpServer, {
    cors: { origin: process.env.NODE_ENV === "production" ? false : true },
  });
  const botDelayMs = options.botDelayMs ?? (() => 400 + Math.random() * 600);
  const intermissionMs = options.intermissionMs ?? 8000;
  const roomTtlMs = options.roomTtlMs ?? 30 * 60 * 1000;
  const sweepIntervalMs = options.sweepIntervalMs ?? 60 * 1000;
  const seedFn = options.seedFn ?? (() => randomInt(2 ** 31));
  const botRng = options.botRng ?? Math.random;

  const rooms = new RoomManager({ roomTtlMs, seedFn });
  const sweeper = setInterval(() => rooms.sweep(), sweepIntervalMs);
  sweeper.unref?.();

  function buildView(room: Room, seat: number): RoomView {
    return {
      code: room.code,
      phase: room.phase,
      hostSeat: 0,
      yourSeat: seat,
      seats: room.seats.map((s) => ({
        nickname: s.nickname,
        isBot: s.kind === "bot",
        connected: s.kind === "bot" ? true : s.socketId !== null,
      })),
      settings: { ...room.settings },
      game: room.match ? redactMatch(room.match, seat) : null,
    };
  }

  /** Push each connected human their own redacted view, then let bots react. */
  function broadcast(room: Room): void {
    for (const [seat, s] of room.seats.entries()) {
      if (s.kind !== "human" || s.socketId === null) continue;
      io.sockets.sockets.get(s.socketId)?.emit("room:state", buildView(room, seat));
    }
    afterStateChange(room);
  }

  /**
   * Drive the room forward: schedule bot decision ticks and the between-round
   * intermission. Everything pauses while no human is connected — a game
   * should not play itself in an empty room.
   */
  function afterStateChange(room: Room): void {
    if (rooms.get(room.code) !== room) return;
    if (room.phase !== "playing" || !room.match) return;
    if (!rooms.hasConnectedHuman(room)) return;
    if (room.match.phase === "betweenRounds") {
      scheduleIntermission(room);
      return;
    }
    if (room.match.phase !== "roundActive") return;
    for (const [seat, s] of room.seats.entries()) {
      if (s.kind !== "bot" || room.pendingBotSeats.has(seat)) continue;
      room.pendingBotSeats.add(seat);
      const timer = setTimeout(() => {
        room.timers.delete(timer);
        room.pendingBotSeats.delete(seat);
        botTick(room, seat);
      }, botDelayMs());
      room.timers.add(timer);
    }
  }

  function scheduleIntermission(room: Room): void {
    if (room.intermissionTimer) return;
    const timer = setTimeout(() => {
      room.timers.delete(timer);
      room.intermissionTimer = null;
      if (rooms.get(room.code) !== room) return;
      if (room.phase !== "playing" || room.match?.phase !== "betweenRounds") return;
      if (!rooms.hasConnectedHuman(room)) return; // paused; resumes on reconnect
      const advanced = rooms.advanceRound(room);
      if (advanced.ok) broadcast(room);
    }, intermissionMs);
    room.intermissionTimer = timer;
    room.timers.add(timer);
  }

  /** A host skip must cancel the pending auto-advance, or the stale timer
   * would cut the NEXT round's intermission short. */
  function cancelIntermission(room: Room): void {
    if (!room.intermissionTimer) return;
    clearTimeout(room.intermissionTimer);
    room.timers.delete(room.intermissionTimer);
    room.intermissionTimer = null;
  }

  function botTick(room: Room, seat: number): void {
    if (rooms.get(room.code) !== room) return;
    if (room.phase !== "playing" || !room.match) return;
    if (!rooms.hasConnectedHuman(room)) return;
    if (room.match.phase !== "roundActive") {
      afterStateChange(room);
      return;
    }
    const action = chooseBotAction(room.match, seat, botRng);
    if (!action) {
      // Nothing the bot wants to do out of turn; if it IS its turn, retry soon
      // rather than stalling the game forever.
      if (room.match.round?.turn === seat) afterStateChange(room);
      return;
    }
    const result = applyAction(room.match, action);
    if (!result.ok) {
      // State moved under the bot (a human acted between schedule and fire) —
      // just reschedule against the fresh state.
      afterStateChange(room);
      return;
    }
    commit(room, result.state);
  }

  function commit(room: Room, next: NonNullable<Room["match"]>): void {
    room.match = next;
    if (next.phase === "finished") room.phase = "over";
    rooms.touch(room);
    broadcast(room);
  }

  function boundRoom(socket: GameSocket): { room: Room; seat: number } | AckError {
    const { code, seat } = socket.data;
    if (code === undefined || seat === undefined) return err("NOT_IN_ROOM", "join a room first");
    const room = rooms.get(code);
    if (!room) return err("ROOM_NOT_FOUND", "that room no longer exists");
    return { room, seat };
  }

  io.on("connection", (socket: GameSocket) => {
    socket.on("room:create", (req, cb) => {
      if (typeof cb !== "function") return;
      const created = rooms.create(req?.nickname, socket.id, req?.settings);
      if (!created.ok) return cb(created);
      socket.data.code = created.room.code;
      socket.data.seat = created.seat;
      cb({
        ok: true,
        code: created.room.code,
        seat: created.seat,
        token: created.token,
        view: buildView(created.room, created.seat),
      });
    });

    socket.on("room:join", (req, cb) => {
      if (typeof cb !== "function") return;
      const joined = rooms.join(req?.code ?? "", req?.nickname, socket.id);
      if (!joined.ok) return cb(joined);
      socket.data.code = joined.room.code;
      socket.data.seat = joined.seat;
      cb({
        ok: true,
        code: joined.room.code,
        seat: joined.seat,
        token: joined.token,
        view: buildView(joined.room, joined.seat),
      });
      broadcast(joined.room);
    });

    socket.on("room:reconnect", (req, cb) => {
      if (typeof cb !== "function") return;
      const res = rooms.reconnect(req?.code ?? "", req?.token ?? "", socket.id);
      if (!res.ok) return cb(res);
      if (res.previousSocketId && res.previousSocketId !== socket.id) {
        const old = io.sockets.sockets.get(res.previousSocketId);
        if (old) {
          old.data.code = undefined;
          old.data.seat = undefined;
          old.emit("room:kicked", "this seat reconnected from another window");
          old.disconnect(true);
        }
      }
      socket.data.code = res.room.code;
      socket.data.seat = res.seat;
      cb({ ok: true, seat: res.seat, view: buildView(res.room, res.seat) });
      broadcast(res.room);
    });

    socket.on("room:configure", (req, cb) => {
      if (typeof cb !== "function") return;
      const bound = boundRoom(socket);
      if ("ok" in bound) return cb(bound);
      if (bound.seat !== 0) return cb(err("NOT_HOST", "only the host can change settings"));
      const applied = rooms.applySettings(bound.room, req ?? {});
      cb(applied.ok ? { ok: true } : applied);
      if (applied.ok) broadcast(bound.room);
    });

    socket.on("room:start", (cb) => {
      if (typeof cb !== "function") return;
      const bound = boundRoom(socket);
      if ("ok" in bound) return cb(bound);
      if (bound.seat !== 0) return cb(err("NOT_HOST", "only the host can start the game"));
      const started = rooms.start(bound.room);
      cb(started.ok ? { ok: true } : started);
      if (started.ok) broadcast(bound.room);
    });

    socket.on("round:next", (cb) => {
      if (typeof cb !== "function") return;
      const bound = boundRoom(socket);
      if ("ok" in bound) return cb(bound);
      if (bound.seat !== 0) return cb(err("NOT_HOST", "only the host can advance the round"));
      const advanced = rooms.advanceRound(bound.room);
      cb(advanced.ok ? { ok: true } : advanced);
      if (advanced.ok) {
        cancelIntermission(bound.room);
        broadcast(bound.room);
      }
    });

    socket.on("game:action", (payload, cb) => {
      if (typeof cb !== "function") return;
      const bound = boundRoom(socket);
      if ("ok" in bound) return cb(bound);
      const { room, seat } = bound;
      if (room.phase !== "playing" || !room.match) {
        return cb(err("BAD_ACTION", "no game in progress"));
      }
      const clean = sanitizeClientAction(payload);
      if (!clean) return cb(err("BAD_ACTION", "malformed action payload"));
      // The seat comes from the socket binding, never from the payload —
      // clients cannot act for other players.
      const action = { ...clean, seat } as Action;
      const result = applyAction(room.match, action);
      if (!result.ok) return cb(result);
      cb({ ok: true });
      commit(room, result.state);
    });

    socket.on("disconnect", () => {
      const { code } = socket.data;
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const seat = rooms.markDisconnected(room, socket.id);
      if (seat !== null) broadcast(room);
    });
  });

  return {
    httpServer,
    io,
    rooms,
    close: async () => {
      clearInterval(sweeper);
      rooms.clear();
      await io.close();
    },
  };
}
