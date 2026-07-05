import { useEffect, useRef } from "react";
import type { CardId } from "@vazhikara/engine";
import { PlayingCard } from "./Card.js";

export interface DiscardLineProps {
  line: readonly CardId[];
  /** Index of the deepest chosen card during a pickup preview, if any. */
  previewIndex: number | null;
  canPickup: boolean;
  onCardTap: (index: number) => void;
}

/** The discard line as a horizontally scrollable ribbon, auto-scrolling to the newest card. */
export function DiscardLine({ line, previewIndex, canPickup, onCardTap }: DiscardLineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [line.length]);

  return (
    <div>
      <h3 style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#cfe9d8", margin: "0 0 0.3rem 0.75rem" }}>
        Discard line {canPickup && "(tap a card to preview a pickup)"}
      </h3>
      <div ref={scrollRef} className="scroll-x" style={{ display: "flex", gap: "4px", padding: "0.25rem 0.75rem" }}>
        {line.map((id, i) => {
          const inPreview = previewIndex !== null && i >= previewIndex;
          return (
            <PlayingCard
              key={`${id}-${i}`}
              id={id}
              highlighted={inPreview}
              onClick={canPickup ? () => onCardTap(i) : undefined}
              animate
            />
          );
        })}
        {line.length === 0 && <p style={{ color: "#cfe9d8" }}>empty</p>}
      </div>
    </div>
  );
}
