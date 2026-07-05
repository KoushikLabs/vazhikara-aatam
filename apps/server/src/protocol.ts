/**
 * Wire protocol between server and clients.
 *
 * Clients send intents; the server validates every one through the engine and
 * answers via the Socket.IO ack callback. After every state change the server
 * pushes a per-viewer `room:state` — hands of other players and the stock are
 * redacted to counts.
 */

import type {
  Action,
  CardId,
  MatchConfig,
  MatchPhase,
  RejectCode,
  RoundPhase,
  RoundResult,
  TableSet,
} from "@vazhikara/engine";

export interface RoomSettings {
  /** null = auto (engine default for the player count). */
  decks: number | null;
  targetScore: number;
  botCount: number;
}

export interface SeatView {
  nickname: string;
  isBot: boolean;
  connected: boolean;
}

export interface RedactedRound {
  phase: RoundPhase;
  turn: number;
  dealer: number;
  line: CardId[];
  sets: TableSet[];
  placedBy: Record<CardId, number>;
  stockCount: number;
  handCounts: number[];
  /** Your own seat gets its cards; every other seat is null. */
  hands: (CardId[] | null)[];
  result: RoundResult | null;
}

/**
 * The client-facing config NEVER includes the match seed: the deal is a pure
 * function of (seed, roundsPlayed, decks, dealer), so shipping the seed would
 * let any client reconstruct every hidden hand and the stock order.
 */
export type RedactedConfig = Omit<MatchConfig, "seed">;

export interface RedactedMatch {
  config: RedactedConfig;
  phase: MatchPhase;
  totals: number[];
  dealer: number;
  roundsPlayed: number;
  winner: number | null;
  history: RoundResult[];
  round: RedactedRound | null;
}

export type RoomPhase = "lobby" | "playing" | "over";

export interface RoomView {
  code: string;
  phase: RoomPhase;
  hostSeat: number;
  yourSeat: number;
  seats: SeatView[];
  settings: RoomSettings;
  game: RedactedMatch | null;
}

/** Client → server action intents: the seat is assigned server-side from the socket binding. */
export type ClientAction =
  | Omit<Extract<Action, { type: "drawStock" }>, "seat">
  | Omit<Extract<Action, { type: "pickupLine" }>, "seat">
  | Omit<Extract<Action, { type: "display" }>, "seat">
  | Omit<Extract<Action, { type: "attach" }>, "seat">
  | Omit<Extract<Action, { type: "discard" }>, "seat">
  | Omit<Extract<Action, { type: "declareDead" }>, "seat">;

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_STARTED"
  | "ROOM_FULL"
  | "ROOM_OVER"
  | "BAD_NICKNAME"
  | "NICKNAME_TAKEN"
  | "BAD_TOKEN"
  | "NOT_HOST"
  | "NOT_IN_ROOM"
  | "BAD_SETTINGS"
  | "NOT_LOBBY"
  | "NOT_BETWEEN_ROUNDS"
  | "BAD_ACTION";

export type AckError = { ok: false; code: RoomErrorCode | RejectCode; message: string };
export type Ack<T = unknown> = ({ ok: true } & T) | AckError;

export interface CreateRoomRequest {
  nickname: string;
  settings?: Partial<RoomSettings>;
}
export interface JoinRoomRequest {
  code: string;
  nickname: string;
}
export interface ReconnectRequest {
  code: string;
  token: string;
}
export interface JoinedRoom {
  code: string;
  seat: number;
  token: string;
  view: RoomView;
}
export interface ReconnectedRoom {
  seat: number;
  view: RoomView;
}
