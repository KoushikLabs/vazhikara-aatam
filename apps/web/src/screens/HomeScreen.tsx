import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSocket } from "../lib/socket.js";
import { loadNickname, saveNickname, saveRoomAuth } from "../lib/storage.js";
import type { Ack, JoinedRoom } from "@vazhikara/server/protocol";

export default function HomeScreen() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(loadNickname());
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validName(): string | null {
    const trimmed = nickname.trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      setError("Enter a nickname (1-20 characters).");
      return null;
    }
    return trimmed;
  }

  function createGame() {
    const name = validName();
    if (!name) return;
    setBusy(true);
    setError(null);
    saveNickname(name);
    getSocket().emit("room:create", { nickname: name }, (ack: Ack<JoinedRoom>) => {
      setBusy(false);
      if (!ack.ok) {
        setError(ack.message);
        return;
      }
      saveRoomAuth(ack.code, { token: ack.token, nickname: name });
      navigate(`/g/${ack.code}`);
    });
  }

  function joinGame() {
    const name = validName();
    if (!name) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Room codes are 6 characters.");
      return;
    }
    saveNickname(name);
    // The room itself is joined on the room screen (it needs the code in the
    // URL either way); just navigate there and let it prompt/join.
    navigate(`/g/${code}`, { state: { nickname: name, autoJoin: true } });
  }

  return (
    <main className="screen" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <div style={{ width: "min(420px, 100%)", textAlign: "center" }}>
        <h1 style={{ fontSize: "2.2rem", marginBottom: "0.25rem" }}>Vazhikara Aatam</h1>
        <p style={{ color: "#cfe9d8", marginBottom: "2rem" }}>A family rummy card game — play from anywhere.</p>

        <div style={{ background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1.25rem", textAlign: "left" }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: "0.35rem" }}>Your nickname</label>
          <input
            className="input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Appa"
            maxLength={20}
            style={{ marginBottom: "1rem" }}
          />

          <button className="btn btn-primary" style={{ width: "100%", marginBottom: "1.25rem" }} disabled={busy} onClick={createGame}>
            Create game
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.75rem 0", color: "#999" }}>
            <hr style={{ flex: 1 }} />
            <span>or join</span>
            <hr style={{ flex: 1 }} />
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: "0.35rem" }}>Room code</label>
          <input
            className="input"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="AB3XK9"
            maxLength={6}
            style={{ marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.1em" }}
          />
          <button className="btn" style={{ width: "100%" }} onClick={joinGame}>
            Join game
          </button>

          {error && <p style={{ color: "#d13438", marginTop: "1rem", marginBottom: 0 }}>{error}</p>}
        </div>

        <Link
          to="/rules"
          className="hit-area-44"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            marginTop: "0.75rem",
            padding: "0 0.75rem",
            color: "#fff",
            textDecoration: "underline",
            position: "relative",
          }}
        >
          How to play
        </Link>
      </div>
    </main>
  );
}
