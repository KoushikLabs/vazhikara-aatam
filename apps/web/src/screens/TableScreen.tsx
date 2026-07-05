import { useEffect, useMemo, useState } from "react";
import type { Ack, ClientAction, RoomView } from "@vazhikara/server/protocol";
import type { CardId, TableSet } from "@vazhikara/engine";
import { Scoreboard } from "../components/Scoreboard.js";
import { DisplayedSets } from "../components/DisplayedSets.js";
import { DiscardLine } from "../components/DiscardLine.js";
import { HandBar } from "../components/HandBar.js";
import { ActionBar } from "../components/ActionBar.js";
import { PickupSheet } from "../components/PickupSheet.js";
import { RoundEndOverlay } from "../components/RoundEndOverlay.js";
import { RulesOverlay } from "./RulesScreen.js";
import {
  canAttach as computeCanAttach,
  canDisplay as computeCanDisplay,
  hasOwnDisplayedSet,
  isDeclareEligible,
  previewPickup,
  sortHand,
  type SortMode,
} from "../lib/hints.js";

export interface TableScreenProps {
  view: RoomView;
  act: (action: ClientAction) => Promise<Ack>;
  nextRound: () => void;
}

export default function TableScreen({ view, act, nextRound }: TableScreenProps) {
  const round = view.game?.round;
  const mySeat = view.yourSeat;
  const isHost = view.yourSeat === view.hostSeat;

  const [sortMode, setSortMode] = useState<SortMode>("suit");
  const [selected, setSelected] = useState<Set<CardId>>(new Set());
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null);
  const [pickupIndex, setPickupIndex] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);

  const myHandRaw = (round && mySeat < round.hands.length ? round.hands[mySeat] : null) ?? [];
  const myHand = useMemo(() => sortHand(myHandRaw, sortMode), [myHandRaw, sortMode]);
  const sets = round?.sets ?? [];
  const line = round?.line ?? [];

  // A new round replaces every zone; per-copy ids recur across rounds, so all
  // transient selections must reset or they'd ghost into the new deal.
  const roundKey = view.game?.roundsPlayed ?? 0;
  useEffect(() => {
    setSelected(new Set());
    setAttachTargetId(null);
    setPickupIndex(null);
  }, [roundKey]);

  // Prune selections to cards actually in hand right now (a pickup's meld or
  // an opponent-triggered change can consume selected ids server-side).
  const handKey = myHandRaw.join(",");
  useEffect(() => {
    setSelected((prev) => {
      const inHand = new Set(myHandRaw);
      const next = new Set([...prev].filter((id) => inHand.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey]);

  const isMyTurn = round?.turn === mySeat;
  const awaitTake = isMyTurn && round?.phase === "awaitTake";
  const awaitDiscard = isMyTurn && round?.phase === "awaitDiscard";
  const selectedIds = useMemo(() => [...selected], [selected]);

  // Always resolve the attach target LIVE from the current view — other
  // players extend sets in real time, and a stale snapshot would mis-validate.
  const attachTarget = attachTargetId !== null ? (sets.find((s) => s.id === attachTargetId) ?? null) : null;

  const ownRunDisplayed = sets.some((s) => s.createdBy === mySeat && s.kind === "run");
  const strandCtx = { preDiscardTurn: !!awaitDiscard, ownRunDisplayed };
  const canDisplaySel = round ? computeCanDisplay(myHandRaw, selectedIds, strandCtx) : false;
  const haveOwnSet = round ? hasOwnDisplayedSet(sets, mySeat) : false;
  const canAttachSel =
    round && attachTarget && haveOwnSet
      ? computeCanAttach(myHandRaw, selectedIds, attachTarget, strandCtx)
      : false;

  const isDeclare =
    round && selectedIds.length === 1 ? isDeclareEligible(myHandRaw, sets, mySeat) : false;
  const discardEnabled = awaitDiscard && selectedIds.length === 1;

  function clearSelection() {
    setSelected(new Set());
  }

  function toggleCard(id: CardId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doDisplay() {
    if (!canDisplaySel) return;
    const res = await act({ type: "display", cardIds: selectedIds });
    if (res.ok) clearSelection();
  }

  function enterAttachMode(set: TableSet) {
    setAttachTargetId((prev) => (prev === set.id ? null : set.id));
    clearSelection();
  }

  async function doAttach() {
    if (!attachTarget || !canAttachSel) return;
    const res = await act({ type: "attach", setId: attachTarget.id, cardIds: selectedIds });
    if (res.ok) {
      clearSelection();
      setAttachTargetId(null);
    }
  }

  async function doDrawStock() {
    await act({ type: "drawStock" });
  }

  async function doDeclareDead() {
    await act({ type: "declareDead" });
  }

  async function doDiscard() {
    if (!discardEnabled) return;
    const res = await act({ type: "discard", cardId: selectedIds[0]! });
    if (res.ok) clearSelection();
  }

  function tapLineCard(index: number) {
    if (!awaitTake) return;
    setPickupIndex((prev) => (prev === index ? null : index));
  }

  async function confirmPickup(meldCardIds: CardId[]) {
    if (pickupIndex === null) return;
    const res = await act({ type: "pickupLine", lineIndex: pickupIndex, meldCardIds });
    if (res.ok) setPickupIndex(null);
  }

  const preview = pickupIndex !== null ? previewPickup(line, pickupIndex) : null;
  const betweenRounds = view.game?.phase === "betweenRounds";

  return (
    <div className="screen table-screen">
      <button
        type="button"
        className="rules-fab hit-area-44"
        onClick={() => setShowRules(true)}
        aria-label="How to play"
        title="How to play"
      >
        ?
      </button>

      <Scoreboard view={view} />

      <div
        className="table-middle"
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", paddingBottom: "0.5rem" }}
      >
        <DisplayedSets view={view} attachTargetId={attachTargetId} onSelectTarget={enterAttachMode} />
        <DiscardLine line={line} previewIndex={pickupIndex} canPickup={!!awaitTake} onCardTap={tapLineCard} />
      </div>

      <HandBar hand={myHand} sortMode={sortMode} onSortModeChange={setSortMode} selected={selected} onToggle={toggleCard} />

      <ActionBar
        canDisplay={canDisplaySel}
        onDisplay={doDisplay}
        attachMode={!!attachTarget}
        canAttach={canAttachSel}
        onAttach={doAttach}
        onCancelAttach={() => {
          setAttachTargetId(null);
          clearSelection();
        }}
        isMyTurn={!!isMyTurn}
        awaitTake={!!awaitTake}
        onDrawStock={doDrawStock}
        stockEmpty={(round?.stockCount ?? 0) === 0}
        onDeclareDead={doDeclareDead}
        awaitDiscard={!!awaitDiscard}
        discardEnabled={discardEnabled}
        isDeclare={isDeclare}
        onDiscard={doDiscard}
      />

      {!haveOwnSet && attachTarget && (
        <p style={{ textAlign: "center", color: "#f2b705", fontSize: "0.8rem", margin: "-0.25rem 0 0.25rem" }}>
          You need at least one displayed set of your own before you can attach.
        </p>
      )}

      {preview && (
        <PickupSheet
          preview={preview}
          hand={myHandRaw}
          ownRunDisplayed={ownRunDisplayed}
          onConfirm={confirmPickup}
          onCancel={() => setPickupIndex(null)}
        />
      )}

      {betweenRounds && <RoundEndOverlay view={view} isHost={isHost} onNextRound={nextRound} />}

      {showRules && <RulesOverlay onClose={() => setShowRules(false)} />}
    </div>
  );
}
