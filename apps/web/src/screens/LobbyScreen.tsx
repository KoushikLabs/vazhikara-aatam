import { useState } from "react";
import { defaultDecks } from "@vazhikara/engine";
import type { RoomView } from "@vazhikara/server/protocol";
import { ConnectionDot } from "../components/ConnectionDot.js";
import { InviteQr } from "../components/InviteQr.js";

export interface LobbyScreenProps {
  view: RoomView;
  configure: (settings: Partial<RoomView["settings"]>) => void;
  start: () => void;
}

export default function LobbyScreen({ view, configure, start }: LobbyScreenProps) {
  const isHost = view.yourSeat === view.hostSeat;
  const [copyLabel, setCopyLabel] = useState("Copy");
  const link = `${window.location.origin}/g/${view.code}`;
  const humanCount = view.seats.filter((s) => !s.isBot).length;
  const totalPlayers = view.seats.length + view.settings.botCount;
  const canStart = isHost && totalPlayers >= 2 && humanCount >= 1;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyLabel("Copied!");
    } catch {
      // Fallback: select a temp textarea and use the legacy copy command.
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopyLabel("Copied!");
      } catch {
        setCopyLabel("Copy failed");
      }
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopyLabel("Copy"), 2000);
  }

  return (
    <main className="screen" style={{ padding: "1.25rem", gap: "1.25rem", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <div>
        <h1 style={{ fontSize: "1.6rem", marginBottom: "0.25rem" }}>Room {view.code}</h1>
        <p style={{ color: "#cfe9d8", margin: 0 }}>Waiting in the lobby&hellip;</p>
      </div>

      <section style={{ background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1rem" }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 0.6rem" }}>Players</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {view.seats.map((seat, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <ConnectionDot connected={seat.connected} />
              <span>{seat.nickname}</span>
              {seat.isBot && <span title="bot">🤖</span>}
              {i === view.hostSeat && (
                <span style={{ fontSize: "0.75rem", color: "#888", marginLeft: "auto" }}>host</span>
              )}
            </li>
          ))}
          {Array.from({ length: view.settings.botCount }).map((_, i) => (
            <li key={`pending-bot-${i}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#888" }}>
              <ConnectionDot connected={true} />
              <span>Bot {i + 1}</span> <span>🤖</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1rem" }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 0.6rem" }}>Invite link</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="input" readOnly value={link} style={{ flex: 1, fontSize: "0.85rem" }} />
          <button className="btn" onClick={copyLink}>
            {copyLabel}
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "0.85rem" }}>
          <InviteQr value={link} />
        </div>
        {humanCount === 1 && (
          <p style={{ color: "#666", fontSize: "0.85rem", textAlign: "center", margin: "0.85rem 0 0" }}>
            Share the link (or scan the code) to invite family — or add bots below.
          </p>
        )}
      </section>

      <section style={{ background: "#fff", color: "#1a1a1a", borderRadius: 14, padding: "1rem", opacity: isHost ? 1 : 0.6 }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 0.6rem" }}>Settings {!isHost && "(host only)"}</h2>

        <label style={{ display: "block", fontWeight: 600, margin: "0.5rem 0 0.3rem" }}>
          Decks {view.settings.decks === null && `(auto: ${defaultDecks(totalPlayers)})`}
        </label>
        <select
          className="input"
          disabled={!isHost}
          value={view.settings.decks === null ? "auto" : String(view.settings.decks)}
          onChange={(e) => {
            const v = e.target.value;
            configure({ decks: v === "auto" ? null : Number(v) });
          }}
        >
          <option value="auto">Auto ({defaultDecks(totalPlayers)})</option>
          <option value="1">1 deck</option>
          <option value="2">2 decks</option>
          <option value="3">3 decks</option>
        </select>

        <label style={{ display: "block", fontWeight: 600, margin: "0.75rem 0 0.3rem" }}>Target score</label>
        <select
          className="input"
          disabled={!isHost}
          value={
            view.settings.targetScore === 500 || view.settings.targetScore === 1000
              ? String(view.settings.targetScore)
              : "custom"
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") return;
            configure({ targetScore: Number(v) });
          }}
        >
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="custom">Custom&hellip;</option>
        </select>
        {isHost && (
          <input
            className="input"
            type="number"
            min={1}
            style={{ marginTop: "0.5rem" }}
            placeholder="custom target score"
            defaultValue={
              view.settings.targetScore === 500 || view.settings.targetScore === 1000
                ? ""
                : view.settings.targetScore
            }
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n > 0) configure({ targetScore: n });
            }}
          />
        )}

        <label style={{ display: "block", fontWeight: 600, margin: "0.75rem 0 0.3rem" }}>Bot count</label>
        <select
          className="input"
          disabled={!isHost}
          value={view.settings.botCount}
          onChange={(e) => configure({ botCount: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </section>

      {isHost && (
        <button className="btn btn-primary" style={{ padding: "0 1.5rem", minHeight: 52, fontSize: "1.1rem" }} disabled={!canStart} onClick={start}>
          Start game
        </button>
      )}
      {!isHost && <p style={{ textAlign: "center", color: "#cfe9d8" }}>Waiting for the host to start&hellip;</p>}
    </main>
  );
}
