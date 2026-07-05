import type { RoomView } from "@vazhikara/server/protocol";

export interface RoundEndOverlayProps {
  view: RoomView;
  isHost: boolean;
  onNextRound: () => void;
}

/** Shown while game.phase === 'betweenRounds': per-player round breakdown + running totals. */
export function RoundEndOverlay({ view, isHost, onNextRound }: RoundEndOverlayProps) {
  const history = view.game?.history ?? [];
  const last = history[history.length - 1];
  if (!last) return null;
  const totals = view.game?.totals ?? [];

  return (
    <div
      className="overlay-fade"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 600,
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "#fff",
          color: "#1a1a1a",
          borderRadius: 16,
          padding: "1.25rem",
          width: "min(480px, 100%)",
          // Short landscape phones (e.g. 568x320) need a scroll path or the
          // declarer heading / Next-round button clip off both edges.
          maxHeight: "85dvh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>
          {last.declarer === null ? "Dead round" : `${view.seats[last.declarer]?.nickname ?? "?"} declared!`}
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
                <th style={{ padding: "0.3rem" }}>Player</th>
                <th style={{ padding: "0.3rem" }}>Table</th>
                <th style={{ padding: "0.3rem" }}>Hand</th>
                <th style={{ padding: "0.3rem" }}>Round</th>
                <th style={{ padding: "0.3rem" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {view.seats.map((seat, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    fontWeight: last.declarer === i ? 700 : 400,
                    background: last.declarer === i ? "#fff8e1" : undefined,
                  }}
                >
                  <td style={{ padding: "0.3rem" }}>
                    {seat.nickname}
                    {seat.isBot ? " 🤖" : ""}
                  </td>
                  <td style={{ padding: "0.3rem" }}>{last.tablePoints[i] ?? 0}</td>
                  <td style={{ padding: "0.3rem" }}>{last.handPoints[i] ?? 0}</td>
                  <td style={{ padding: "0.3rem" }}>{last.scores[i] ?? 0}</td>
                  <td style={{ padding: "0.3rem" }}>{totals[i] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: "#888", fontSize: "0.85rem", marginTop: "1rem" }}>Next round starts automatically&hellip;</p>
        {isHost && (
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: "0.5rem" }} onClick={onNextRound}>
            Next round
          </button>
        )}
      </div>
    </div>
  );
}
