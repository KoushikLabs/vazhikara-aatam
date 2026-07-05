import { useMemo, useState } from "react";
import type { CardId } from "@vazhikara/engine";
import { PlayingCard } from "./Card.js";
import { suggestPickupMeld, validatePickupMeld, type PickupPreview } from "../lib/hints.js";

export interface PickupSheetProps {
  preview: PickupPreview;
  hand: readonly CardId[];
  ownRunDisplayed: boolean;
  onConfirm: (meldCardIds: CardId[]) => void;
  onCancel: () => void;
}

/**
 * Mandatory-meld bottom sheet for a line pickup: the chosen card is locked
 * in; the player multi-selects the rest from their hand + the other scooped
 * cards. Validates live against everything the engine will check — meld
 * shape plus the post-pickup hand-size guards.
 */
export function PickupSheet({ preview, hand, ownRunDisplayed, onConfirm, onCancel }: PickupSheetProps) {
  const otherScooped = preview.scooped.filter((id) => id !== preview.chosenId);
  const [selected, setSelected] = useState<Set<CardId>>(new Set());

  const ctx = useMemo(
    () => ({ handSize: hand.length, scoopedSize: preview.scooped.length, ownRunDisplayed }),
    [hand.length, preview.scooped.length, ownRunDisplayed],
  );
  const meldCardIds = useMemo(() => [preview.chosenId, ...selected], [preview.chosenId, selected]);
  const verdict = useMemo(
    () => validatePickupMeld(preview.chosenId, meldCardIds, ctx),
    [preview.chosenId, meldCardIds, ctx],
  );

  function toggle(id: CardId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function suggest() {
    const suggestion = suggestPickupMeld(preview.chosenId, hand, otherScooped, ctx);
    if (suggestion) {
      setSelected(new Set(suggestion.filter((id) => id !== preview.chosenId)));
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 500,
      }}
    >
      <div
        style={{
          background: "#fff",
          color: "#1a1a1a",
          width: "100%",
          maxHeight: "80dvh",
          overflowY: "auto",
          borderRadius: "16px 16px 0 0",
          padding: "1rem",
        }}
      >
        <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.1rem" }}>
          Take {preview.scooped.length} card{preview.scooped.length === 1 ? "" : "s"}
        </h2>
        <p style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.9rem" }}>
          You must lay down a brand-new set that includes the chosen card.
        </p>

        <p style={{ fontWeight: 600, margin: "0.5rem 0 0.3rem" }}>Chosen card (locked in)</p>
        <div style={{ display: "flex", gap: "4px", marginBottom: "0.75rem" }}>
          <PlayingCard id={preview.chosenId} selected />
        </div>

        {otherScooped.length > 0 && (
          <>
            <p style={{ fontWeight: 600, margin: "0.5rem 0 0.3rem" }}>Other cards taken from the line</p>
            <div className="scroll-x" style={{ display: "flex", gap: "4px", marginBottom: "0.75rem" }}>
              {otherScooped.map((id) => (
                <PlayingCard key={id} id={id} selected={selected.has(id)} onClick={() => toggle(id)} />
              ))}
            </div>
          </>
        )}

        <p style={{ fontWeight: 600, margin: "0.5rem 0 0.3rem" }}>Your hand</p>
        <div className="scroll-x" style={{ display: "flex", gap: "4px", marginBottom: "0.75rem" }}>
          {hand.map((id) => (
            <PlayingCard key={id} id={id} selected={selected.has(id)} onClick={() => toggle(id)} />
          ))}
        </div>

        <p style={{ minHeight: "1.2rem", fontSize: "0.9rem", color: verdict.ok ? "#1f9d55" : "#d13438", fontWeight: 600 }}>
          {verdict.ok
            ? `Valid ${verdict.kind === "run" ? "run" : "group"} — ${meldCardIds.length} cards`
            : verdict.reason}
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button type="button" className="btn" onClick={suggest}>
            Suggest
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: "auto" }}
            disabled={!verdict.ok}
            onClick={() => onConfirm(meldCardIds)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
