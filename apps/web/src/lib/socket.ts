import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  ClientAction,
  CreateRoomRequest,
  JoinRoomRequest,
  JoinedRoom,
  ReconnectRequest,
  ReconnectedRoom,
  RoomSettings,
  RoomView,
} from "@vazhikara/server/protocol";

/**
 * Thin typed wrapper around the raw Socket.IO client. Connects same-origin by
 * default (works with the Vite dev proxy and any single-service deploy);
 * override with VITE_SERVER_URL for split hosting.
 */
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

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (socket) return socket;
  const url = import.meta.env.VITE_SERVER_URL ?? "/";
  socket = io(url, {
    path: "/socket.io",
    autoConnect: true,
    reconnection: true,
  }) as unknown as GameSocket;
  // Socket.IO's auto-reconnect deliberately skips server-initiated
  // disconnects ("io server disconnect" — e.g. after a seat takeover kick).
  // Reconnect the transport anyway so the app keeps working for new rooms;
  // useGameClient suppresses seat re-claims for kicked rooms.
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") {
      setTimeout(() => socket?.connect(), 400);
    }
  });
  return socket;
}
