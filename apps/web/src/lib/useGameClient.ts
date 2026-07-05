import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Ack,
  ClientAction,
  JoinedRoom,
  ReconnectedRoom,
  RoomSettings,
  RoomView,
} from "@vazhikara/server/protocol";
import { getSocket } from "./socket.js";
import { clearRoomAuth, loadRoomAuth, saveRoomAuth } from "./storage.js";

export interface Toast {
  id: number;
  message: string;
}

let toastCounter = 0;

/**
 * Single source of truth for the socket connection and current room view.
 * Every rejected ack surfaces as a brief auto-dismissing toast. Reconnect is
 * automatic: whenever the socket (re)connects and a stored token exists for
 * the room code we're currently pointed at, we replay room:reconnect.
 */
export function useGameClient(code: string | undefined) {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  const [kicked, setKicked] = useState<string | null>(null);
  /** Set when a stored reconnect token was rejected (room GC'd, server restarted…). */
  const [authFailed, setAuthFailed] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const codeRef = useRef(code);
  codeRef.current = code;
  const kickedRef = useRef<string | null>(null);
  kickedRef.current = kicked;

  const pushToast = useCallback((message: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    // Fresh room context whenever the code changes.
    setView(null);
    setKicked(null);
    setAuthFailed(null);

    const onConnect = () => {
      setConnected(true);
      const currentCode = codeRef.current;
      // Never auto-reclaim a seat we were kicked from — two windows would
      // otherwise fight over it in a kick loop.
      if (currentCode && !kickedRef.current) {
        const auth = loadRoomAuth(currentCode);
        if (auth) {
          socket.emit("room:reconnect", { code: currentCode, token: auth.token }, (ack: Ack<ReconnectedRoom>) => {
            if (ack.ok) {
              setView(ack.view);
              setKicked(null);
            } else if (ack.code === "ROOM_NOT_FOUND" || ack.code === "BAD_TOKEN") {
              // The token is dead (room GC'd / server restarted / wrong room).
              // Clear it so the screen falls back to a fresh nickname-and-join
              // prompt instead of spinning forever.
              clearRoomAuth(currentCode);
              setAuthFailed(ack.message);
            }
          });
        }
      }
    };
    const onDisconnect = () => setConnected(false);
    // Broadcasts are per-seat, but a socket that visited another room first
    // may still receive that room's pushes — only accept the room we're on.
    const onState = (next: RoomView) => {
      if (codeRef.current && next.code === codeRef.current) setView(next);
    };
    const onKicked = (reason: string) => setKicked(reason);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("room:kicked", onKicked);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("room:kicked", onKicked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const createRoom = useCallback(
    (nickname: string, settings?: Partial<RoomSettings>): Promise<Ack<JoinedRoom>> => {
      return new Promise((resolve) => {
        getSocket().emit("room:create", { nickname, ...(settings ? { settings } : {}) }, (ack: Ack<JoinedRoom>) => {
          if (ack.ok) {
            saveRoomAuth(ack.code, { token: ack.token, nickname });
            setView(ack.view);
          } else {
            pushToast(ack.message);
          }
          resolve(ack);
        });
      });
    },
    [pushToast],
  );

  const join = useCallback(
    (roomCode: string, nickname: string): Promise<Ack<JoinedRoom>> => {
      return new Promise((resolve) => {
        getSocket().emit("room:join", { code: roomCode, nickname }, (ack: Ack<JoinedRoom>) => {
          if (ack.ok) {
            saveRoomAuth(ack.code, { token: ack.token, nickname });
            setView(ack.view);
          } else {
            pushToast(ack.message);
          }
          resolve(ack);
        });
      });
    },
    [pushToast],
  );

  const reconnect = useCallback(
    (roomCode: string, token: string): Promise<Ack<ReconnectedRoom>> => {
      return new Promise((resolve) => {
        getSocket().emit("room:reconnect", { code: roomCode, token }, (ack: Ack<ReconnectedRoom>) => {
          if (ack.ok) {
            setView(ack.view);
            setKicked(null);
          } else {
            pushToast(ack.message);
            clearRoomAuth(roomCode);
          }
          resolve(ack);
        });
      });
    },
    [pushToast],
  );

  const configure = useCallback(
    (settings: Partial<RoomSettings>): Promise<Ack> => {
      return new Promise((resolve) => {
        getSocket().emit("room:configure", settings, (ack: Ack) => {
          if (!ack.ok) pushToast(ack.message);
          resolve(ack);
        });
      });
    },
    [pushToast],
  );

  const start = useCallback((): Promise<Ack> => {
    return new Promise((resolve) => {
      getSocket().emit("room:start", (ack: Ack) => {
        if (!ack.ok) pushToast(ack.message);
        resolve(ack);
      });
    });
  }, [pushToast]);

  const nextRound = useCallback((): Promise<Ack> => {
    return new Promise((resolve) => {
      getSocket().emit("round:next", (ack: Ack) => {
        if (!ack.ok) pushToast(ack.message);
        resolve(ack);
      });
    });
  }, [pushToast]);

  const act = useCallback(
    (action: ClientAction): Promise<Ack> => {
      return new Promise((resolve) => {
        getSocket().emit("game:action", action, (ack: Ack) => {
          if (!ack.ok) pushToast(ack.message);
          resolve(ack);
        });
      });
    },
    [pushToast],
  );

  return { connected, view, kicked, authFailed, toasts, createRoom, join, reconnect, configure, start, nextRound, act };
}
