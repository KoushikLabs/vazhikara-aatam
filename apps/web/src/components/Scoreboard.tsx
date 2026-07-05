import type { RoomView } from "@vazhikara/server/protocol";
import { ConnectionDot } from "./ConnectionDot.js";

export interface ScoreboardProps {
  view: RoomView;
}

/** Compact live scoreboard: nickname, total score, hand count, connection, unmissable turn indicator. */
export function Scoreboard({ view }: ScoreboardProps) {
  const round = view.game?.round;
  const totals = view.game?.totals ?? [];
  const turnSeat = round?.turn;

  return (
    <header
      className="scoreboard"
      style={{
        background: "#0b3d26",
        borderBottom: "1px solid rgba(255,255,255,0.15)",
        padding: "0.5rem 3.25rem 0.5rem 0.75rem", // right padding clears the fixed "?" rules button
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
      }}
    >
      {/* paddingTop gives the floating TURN badge (top: -10) headroom inside
          the overflow-hidden scroller — without it the badge is clipped. */}
      <div className="scroll-x" style={{ display: "flex", gap: "0.5rem", paddingTop: 12 }}>
        {view.seats.map((seat, i) => {
          const isTurn = turnSeat === i;
          const isMe = i === view.yourSeat;
          return (
            <div
              key={i}
              className="scoreboard-seat"
              style={{
                flexShrink: 0,
                minWidth: 100,
                borderRadius: 10,
                padding: "0.35rem 0.55rem",
                background: isTurn ? "var(--accent)" : "rgba(255,255,255,0.08)",
                color: isTurn ? "#1a1a1a" : "#fff",
                border: isMe ? "2px solid #4da3ff" : "2px solid transparent",
                position: "relative",
              }}
            >
              {isTurn && (
                <div
                  className="turn-badge"
                  style={{
                    position: "absolute",
                    top: -10,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: "0.65rem",
                    fontWeight: 800,
                    background: "#d13438",
                    color: "#fff",
                    padding: "1px 6px",
                    borderRadius: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  TURN
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontWeight: 700, fontSize: "0.85rem" }}>
                <ConnectionDot connected={seat.connected} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {seat.nickname}
                  {seat.isBot ? " 🤖" : ""}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                {totals[i] ?? 0} pts &middot; {round?.handCounts[i] ?? 0} cards
              </div>
            </div>
          );
        })}
      </div>
      <div className="scoreboard-stock" style={{ fontSize: "0.8rem", color: "#cfe9d8" }}>
        Stock: {round?.stockCount ?? 0} cards left
      </div>
    </header>
  );
}
