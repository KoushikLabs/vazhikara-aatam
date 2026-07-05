import { Link } from "react-router-dom";
import type { RoomView } from "@vazhikara/server/protocol";

export default function GameOverScreen({ view }: { view: RoomView }) {
  const winner = view.game?.winner ?? null;
  const totals = view.game?.totals ?? [];
  const winnerSeat = winner !== null ? view.seats[winner] : null;

  return (
    <main className="screen" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem", textAlign: "center" }}>
      <div style={{ background: "#fff", color: "#1a1a1a", borderRadius: 16, padding: "1.5rem", width: "min(480px, 100%)" }}>
        <div style={{ fontSize: "3rem" }}>🏆</div>
        <h1 style={{ margin: "0.25rem 0 0" }}>{winnerSeat ? `${winnerSeat.nickname} wins!` : "Game over"}</h1>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.25rem", fontSize: "0.95rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
              <th style={{ padding: "0.35rem" }}>Player</th>
              <th style={{ padding: "0.35rem" }}>Final score</th>
            </tr>
          </thead>
          <tbody>
            {view.seats
              .map((seat, i) => ({ seat, i, total: totals[i] ?? 0 }))
              .sort((a, b) => b.total - a.total)
              .map(({ seat, i, total }) => (
                <tr key={i} style={{ fontWeight: i === winner ? 700 : 400, borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "0.35rem" }}>
                    {seat.nickname}
                    {seat.isBot ? " 🤖" : ""}
                    {i === winner ? " 👑" : ""}
                  </td>
                  <td style={{ padding: "0.35rem" }}>{total}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <Link to="/" className="btn btn-primary" style={{ display: "inline-block", marginTop: "1.5rem", textDecoration: "none" }}>
          Home
        </Link>
      </div>
    </main>
  );
}
