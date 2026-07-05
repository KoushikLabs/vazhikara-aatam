import type { RoomView } from "@vazhikara/server/protocol";
import type { TableSet } from "@vazhikara/engine";
import { PlayingCard } from "./Card.js";

export interface DisplayedSetsProps {
  view: RoomView;
  attachTargetId: string | null;
  onSelectTarget: (set: TableSet) => void;
}

/** Every player's displayed sets as tappable chips of mini-cards, labelled by owner. */
export function DisplayedSets({ view, attachTargetId, onSelectTarget }: DisplayedSetsProps) {
  const sets = view.game?.round?.sets ?? [];
  if (sets.length === 0) {
    return <p style={{ color: "#cfe9d8", padding: "0.5rem 0.75rem", margin: 0 }}>No sets on the table yet.</p>;
  }
  return (
    <div style={{ padding: "0.5rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {sets.map((set) => {
        const owner = view.seats[set.createdBy];
        const isTarget = attachTargetId === set.id;
        return (
          <button
            key={set.id}
            type="button"
            className="set-pop"
            onClick={() => onSelectTarget(set)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              minHeight: "var(--touch)",
              background: isTarget ? "rgba(77,163,255,0.25)" : "rgba(255,255,255,0.08)",
              border: isTarget ? "2px solid #4da3ff" : "2px solid transparent",
              borderRadius: 10,
              padding: "0.4rem 0.5rem",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: "0.7rem", color: "#cfe9d8", minWidth: 64, flexShrink: 0 }}>
              {owner?.nickname ?? `Seat ${set.createdBy}`}
              <br />
              <span style={{ opacity: 0.7 }}>{set.kind === "run" ? "run" : "group"}</span>
            </span>
            <span className="scroll-x" style={{ display: "flex", gap: "2px", flex: 1 }}>
              {set.cards.map((id) => (
                <PlayingCard key={id} id={id} compact animate />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
