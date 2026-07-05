import { randomInt, randomUUID } from "node:crypto";
import { createMatch, startNextRound, type MatchState } from "@vazhikara/engine";
import type { AckError, RoomPhase, RoomSettings } from "./protocol.js";

export interface HumanSeat {
  kind: "human";
  nickname: string;
  /** Reconnect token — the seat's durable identity across connections. */
  token: string;
  socketId: string | null;
}
export interface BotSeat {
  kind: "bot";
  nickname: string;
}
export type RoomSeat = HumanSeat | BotSeat;

export interface Room {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  /** Humans in join order (host is seat 0); bots appended at start. */
  seats: RoomSeat[];
  match: MatchState | null;
  lastActivity: number;
  /** All pending timers for this room — cleared when the room is deleted. */
  timers: Set<ReturnType<typeof setTimeout>>;
  /** Bot seats with a decision tick already scheduled. */
  pendingBotSeats: Set<number>;
  /** Pending between-rounds auto-advance, cancellable by a host skip. */
  intermissionTimer: ReturnType<typeof setTimeout> | null;
}

export type Result<T = unknown> = ({ ok: true } & T) | AckError;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L lookalikes
const CODE_LENGTH = 6;
const MAX_PLAYERS = 6;

const err = (code: AckError["code"], message: string): AckError => ({ ok: false, code, message });

function validNickname(nickname: unknown): string | null {
  if (typeof nickname !== "string") return null;
  const trimmed = nickname.trim();
  if (trimmed.length < 1 || trimmed.length > 20) return null;
  return trimmed;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly opts: {
      roomTtlMs: number;
      seedFn: () => number;
    },
  ) {}

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  roomCount(): number {
    return this.rooms.size;
  }

  touch(room: Room): void {
    room.lastActivity = Date.now();
  }

  create(nickname: string, socketId: string, settings?: Partial<RoomSettings>): Result<{ room: Room; seat: number; token: string }> {
    const name = validNickname(nickname);
    if (!name) return err("BAD_NICKNAME", "nickname must be 1–20 characters");
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      phase: "lobby",
      settings: { decks: null, targetScore: 500, botCount: 0 },
      seats: [],
      match: null,
      lastActivity: Date.now(),
      timers: new Set(),
      pendingBotSeats: new Set(),
      intermissionTimer: null,
    };
    if (settings) {
      const applied = this.applySettings(room, settings);
      if (!applied.ok) return applied;
    }
    const token = randomUUID();
    room.seats.push({ kind: "human", nickname: name, token, socketId });
    this.rooms.set(code, room);
    return { ok: true, room, seat: 0, token };
  }

  join(code: string, nickname: string, socketId: string): Result<{ room: Room; seat: number; token: string }> {
    const room = this.get(code);
    if (!room) return err("ROOM_NOT_FOUND", "no room with that code");
    if (room.phase === "playing") return err("ROOM_STARTED", "the game has already started — ask for a reconnect link if you were in it");
    if (room.phase === "over") return err("ROOM_OVER", "that game is over");
    const name = validNickname(nickname);
    if (!name) return err("BAD_NICKNAME", "nickname must be 1–20 characters");
    if (room.seats.some((s) => s.nickname.toLowerCase() === name.toLowerCase())) {
      return err("NICKNAME_TAKEN", "someone in the room already uses that nickname");
    }
    if (room.seats.length + room.settings.botCount >= MAX_PLAYERS) {
      return err("ROOM_FULL", "the room is full");
    }
    const token = randomUUID();
    room.seats.push({ kind: "human", nickname: name, token, socketId });
    this.touch(room);
    return { ok: true, room, seat: room.seats.length - 1, token };
  }

  reconnect(code: string, token: string, socketId: string): Result<{ room: Room; seat: number; previousSocketId: string | null }> {
    const room = this.get(code);
    if (!room) return err("ROOM_NOT_FOUND", "no room with that code");
    const seat = room.seats.findIndex((s) => s.kind === "human" && s.token === token);
    if (seat === -1) return err("BAD_TOKEN", "that reconnect token does not belong to this room");
    const human = room.seats[seat] as HumanSeat;
    const previousSocketId = human.socketId;
    human.socketId = socketId;
    this.touch(room);
    return { ok: true, room, seat, previousSocketId };
  }

  markDisconnected(room: Room, socketId: string): number | null {
    const seat = room.seats.findIndex((s) => s.kind === "human" && s.socketId === socketId);
    if (seat === -1) return null;
    (room.seats[seat] as HumanSeat).socketId = null;
    this.touch(room);
    return seat;
  }

  hasConnectedHuman(room: Room): boolean {
    return room.seats.some((s) => s.kind === "human" && s.socketId !== null);
  }

  applySettings(room: Room, partial: Partial<RoomSettings>): Result {
    if (room.phase !== "lobby") return err("NOT_LOBBY", "settings can only change in the lobby");
    const next = { ...room.settings };
    if (partial.decks !== undefined) {
      if (partial.decks !== null && (!Number.isInteger(partial.decks) || partial.decks < 1 || partial.decks > 3)) {
        return err("BAD_SETTINGS", "decks must be 1–3 or null for auto");
      }
      next.decks = partial.decks;
    }
    if (partial.targetScore !== undefined) {
      if (!Number.isInteger(partial.targetScore) || partial.targetScore < 1 || partial.targetScore > 100000) {
        return err("BAD_SETTINGS", "target score must be a positive integer");
      }
      next.targetScore = partial.targetScore;
    }
    if (partial.botCount !== undefined) {
      if (!Number.isInteger(partial.botCount) || partial.botCount < 0 || partial.botCount > 5) {
        return err("BAD_SETTINGS", "bot count must be 0–5");
      }
      next.botCount = partial.botCount;
    }
    if (room.seats.length + next.botCount > MAX_PLAYERS) {
      return err("BAD_SETTINGS", `that would exceed ${MAX_PLAYERS} players`);
    }
    room.settings = next;
    this.touch(room);
    return { ok: true };
  }

  /** Host starts the game: append bots, create the match, deal the first round. */
  start(room: Room): Result {
    if (room.phase !== "lobby") return err("NOT_LOBBY", "the game has already started");
    const total = room.seats.length + room.settings.botCount;
    if (total < 2 || total > MAX_PLAYERS) {
      return err("BAD_SETTINGS", `need 2–${MAX_PLAYERS} players (humans + bots), got ${total}`);
    }
    const created = createMatch({
      playerCount: total,
      ...(room.settings.decks !== null ? { decks: room.settings.decks } : {}),
      targetScore: room.settings.targetScore,
      seed: this.opts.seedFn(),
    });
    if (!created.ok) return created;
    for (let i = 0; i < room.settings.botCount; i++) {
      room.seats.push({ kind: "bot", nickname: `Bot ${i + 1}` });
    }
    const started = startNextRound(created.match);
    if (!started.ok) return started;
    room.match = started.state;
    room.phase = "playing";
    this.touch(room);
    return { ok: true };
  }

  /** Deal the next round (host skip or intermission timer). */
  advanceRound(room: Room): Result {
    if (room.phase !== "playing" || !room.match) return err("NOT_BETWEEN_ROUNDS", "no game in progress");
    if (room.match.phase !== "betweenRounds") {
      return err("NOT_BETWEEN_ROUNDS", "the round is still running");
    }
    const started = startNextRound(room.match);
    if (!started.ok) return started;
    room.match = started.state;
    this.touch(room);
    return { ok: true };
  }

  delete(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const timer of room.timers) clearTimeout(timer);
    room.timers.clear();
    this.rooms.delete(code);
  }

  /** Delete every room and cancel its timers (server shutdown). */
  clear(): void {
    for (const code of [...this.rooms.keys()]) this.delete(code);
  }

  /** Drop rooms with no connected humans that have been idle past the TTL. */
  sweep(now = Date.now()): string[] {
    const dropped: string[] = [];
    for (const [code, room] of this.rooms) {
      if (!this.hasConnectedHuman(room) && now - room.lastActivity > this.opts.roomTtlMs) {
        this.delete(code);
        dropped.push(code);
      }
    }
    return dropped;
  }
}
