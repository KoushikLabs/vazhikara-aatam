import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useGameClient } from "../lib/useGameClient.js";
import { loadNickname, loadRoomAuth, saveNickname } from "../lib/storage.js";
import { ToastStack } from "../components/Toasts.js";
import LobbyScreen from "./LobbyScreen.js";
import TableScreen from "./TableScreen.js";
import GameOverScreen from "./GameOverScreen.js";

interface LocationState {
  nickname?: string;
  autoJoin?: boolean;
}

/** A friendly full-screen dead end for a room that no longer exists (bad code, GC'd, server restarted). */
function RoomNotFoundScreen({ code }: { code: string }) {
  return (
    <main className="screen" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem", textAlign: "center" }}>
      <div style={{ width: "min(420px, 100%)", background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1.5rem" }}>
        <div style={{ fontSize: "2.5rem" }}>🔍</div>
        <h1 style={{ fontSize: "1.4rem", margin: "0.5rem 0 0.25rem" }}>Room {code} isn&rsquo;t there</h1>
        <p style={{ color: "#666", margin: "0 0 1.25rem" }}>
          The link may be mistyped, or the room may have closed after a while with nobody in it.
        </p>
        <Link to="/" className="btn btn-primary" style={{ display: "block", textDecoration: "none" }}>
          Back to home
        </Link>
      </div>
    </main>
  );
}

export default function RoomScreen() {
  const { code = "" } = useParams();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) ?? null;
  const { connected, view, kicked, authFailed, toasts, join, configure, start, nextRound, act } =
    useGameClient(code);

  const [nickname, setNickname] = useState(locationState?.nickname ?? loadNickname());
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const [joining, setJoining] = useState(false);
  const attemptedAutoJoin = useRef(false);

  // A rejected stored token clears itself in the hook; surface why.
  useEffect(() => {
    if (authFailed) setJoinError(authFailed);
  }, [authFailed]);

  const storedAuth = loadRoomAuth(code);
  const haveToken = !!storedAuth && !authFailed;

  // Auto-join once if we arrived from Home's "Join game" flow with no stored token yet.
  useEffect(() => {
    if (attemptedAutoJoin.current) return;
    if (!locationState?.autoJoin || haveToken || !locationState.nickname) return;
    attemptedAutoJoin.current = true;
    setJoining(true);
    join(code, locationState.nickname).then((ack) => {
      setJoining(false);
      if (!ack.ok) {
        setJoinError(ack.message);
        if (ack.code === "ROOM_NOT_FOUND") setRoomMissing(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, haveToken]);

  if (kicked) {
    return (
      <main className="screen" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem", textAlign: "center" }}>
        <div>
          <h1>Disconnected</h1>
          <p>{kicked}</p>
        </div>
      </main>
    );
  }

  if (roomMissing) {
    return <RoomNotFoundScreen code={code} />;
  }

  // No view yet: either we're waiting on a reconnect (token present) or need
  // to prompt for a nickname to join fresh.
  if (!view) {
    if (haveToken || joining) {
      return (
        <main className="screen" style={{ alignItems: "center", justifyContent: "center" }}>
          <p>{connected ? <>Joining room {code}&hellip;</> : <>Connecting to server&hellip;</>}</p>
        </main>
      );
    }
    return (
      <main className="screen" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
        <div style={{ width: "min(420px, 100%)", background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1.25rem" }}>
          <h1 style={{ fontSize: "1.4rem", marginTop: 0 }}>Join room {code}</h1>
          <label style={{ display: "block", fontWeight: 600, marginBottom: "0.35rem" }}>Your nickname</label>
          <input
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Amma"
            maxLength={20}
            style={{ marginBottom: "1rem" }}
          />
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={async () => {
              const trimmed = nickname.trim();
              if (trimmed.length < 1) {
                setJoinError("Enter a nickname.");
                return;
              }
              saveNickname(trimmed);
              setJoining(true);
              const ack = await join(code, trimmed);
              setJoining(false);
              if (!ack.ok) {
                setJoinError(ack.message);
                if (ack.code === "ROOM_NOT_FOUND") setRoomMissing(true);
              }
            }}
          >
            Join
          </button>
          {joinError && <p style={{ color: "#d13438" }}>{joinError}</p>}
        </div>
      </main>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} />
      {!connected && <div className="reconnect-banner">Reconnecting&hellip;</div>}
      {view.phase === "lobby" && <LobbyScreen view={view} configure={configure} start={start} />}
      {view.phase === "playing" && <TableScreen view={view} act={act} nextRound={nextRound} />}
      {view.phase === "over" && <GameOverScreen view={view} />}
    </>
  );
}
