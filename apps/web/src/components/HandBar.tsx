import type { CardId } from "@vazhikara/engine";
import { PlayingCard } from "./Card.js";
import type { SortMode } from "../lib/hints.js";

export interface HandBarProps {
  hand: readonly CardId[];
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  selected: Set<CardId>;
  onToggle: (id: CardId) => void;
}

export function HandBar({ hand, sortMode, onSortModeChange, selected, onToggle }: HandBarProps) {
  return (
    <div className="hand-bar" style={{ background: "#0b3d26", borderTop: "1px solid rgba(255,255,255,0.15)", padding: "0.5rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 0.75rem 0.4rem" }}>
        <span style={{ fontSize: "0.75rem", color: "#cfe9d8" }}>Your hand ({hand.length})</span>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button
            type="button"
            className="btn btn-ghost hit-area-44"
            style={{ minHeight: 32, padding: "0 0.6rem", fontSize: "0.75rem", fontWeight: sortMode === "suit" ? 800 : 400 }}
            onClick={() => onSortModeChange("suit")}
          >
            Sort: suit
          </button>
          <button
            type="button"
            className="btn btn-ghost hit-area-44"
            style={{ minHeight: 32, padding: "0 0.6rem", fontSize: "0.75rem", fontWeight: sortMode === "rank" ? 800 : 400 }}
            onClick={() => onSortModeChange("rank")}
          >
            Sort: rank
          </button>
        </div>
      </div>
      <div className="scroll-x" style={{ display: "flex", gap: "4px", padding: "0.25rem 0.75rem" }}>
        {hand.map((id) => (
          <PlayingCard key={id} id={id} selected={selected.has(id)} onClick={() => onToggle(id)} animate />
        ))}
        {hand.length === 0 && <p style={{ color: "#cfe9d8" }}>empty</p>}
      </div>
    </div>
  );
}
