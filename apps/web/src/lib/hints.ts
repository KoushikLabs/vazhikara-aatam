/**
 * Client-side legality hints computed from the redacted RoomView. These never
 * use engine.enumerateActions/applyAction (they require the unredacted
 * MatchState) — they work only off what a viewer can already see: their own
 * hand, the public line, and the public sets.
 */
import {
  attachedSetCards,
  cardFromId,
  cardPoints,
  classifyMeld,
  findMeldWith,
  type CardId,
  type MeldKind,
  type TableSet,
} from "@vazhikara/engine";

export type SortMode = "suit" | "rank";

const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };

/** Sort a hand of card ids either by suit-then-rank or by rank-then-suit. Pure, client-side only. */
export function sortHand(hand: readonly CardId[], mode: SortMode): CardId[] {
  const withCards = hand.map((id) => ({ id, card: cardFromId(id) }));
  withCards.sort((a, b) => {
    if (mode === "suit") {
      const suitDiff = (SUIT_ORDER[a.card.suit] ?? 9) - (SUIT_ORDER[b.card.suit] ?? 9);
      if (suitDiff !== 0) return suitDiff;
      return a.card.rank - b.card.rank;
    }
    const rankDiff = a.card.rank - b.card.rank;
    if (rankDiff !== 0) return rankDiff;
    return (SUIT_ORDER[a.card.suit] ?? 9) - (SUIT_ORDER[b.card.suit] ?? 9);
  });
  return withCards.map((w) => w.id);
}

/**
 * Engine anti-deadlock context: in the turn player's pre-discard window, an
 * action leaving exactly 1 card without an own displayed run is rejected
 * (WOULD_STRAND) — the forced last-card discard would be an illegal declare.
 */
export interface StrandContext {
  /** It is my turn AND the round phase is awaitDiscard. */
  preDiscardTurn: boolean;
  /** I already have a run of my own displayed (createdBy === my seat). */
  ownRunDisplayed: boolean;
}

/** A free-standing "display" is legal when the selection is itself a valid meld and leaves >=1 card in hand. */
export function canDisplay(
  hand: readonly CardId[],
  selected: readonly CardId[],
  ctx: StrandContext,
): boolean {
  if (selected.length < 3) return false;
  if (selected.length >= hand.length) return false; // hand-floor: must keep >=1 card
  if (!selected.every((id) => hand.includes(id))) return false;
  const kind = classifyMeld(selected);
  if (kind === null) return false;
  const handAfter = hand.length - selected.length;
  // Displaying a run satisfies the own-run requirement itself.
  if (ctx.preDiscardTurn && handAfter === 1 && kind !== "run" && !ctx.ownRunDisplayed) return false;
  return true;
}

/** Attach is legal when the union of the target set + selection is still a valid meld of the same kind, and leaves >=1 card. */
export function canAttach(
  hand: readonly CardId[],
  selected: readonly CardId[],
  target: Pick<TableSet, "kind" | "cards">,
  ctx: StrandContext,
): boolean {
  if (selected.length === 0) return false;
  if (selected.length >= hand.length) return false;
  if (!selected.every((id) => hand.includes(id))) return false;
  const handAfter = hand.length - selected.length;
  if (ctx.preDiscardTurn && handAfter === 1 && !ctx.ownRunDisplayed) return false;
  return attachedSetCards(target.kind, target.cards, selected) !== null;
}

/** You may attach to anything only once you have at least one displayed set of your own. */
export function hasOwnDisplayedSet(sets: readonly TableSet[], seat: number): boolean {
  return sets.some((s) => s.createdBy === seat);
}

/**
 * Whether discarding this single card would be a legal DECLARE: hand is
 * exactly this one card, and at least one of the player's own displayed sets
 * is a run (attachments to others' sets never count).
 */
export function isDeclareEligible(hand: readonly CardId[], sets: readonly TableSet[], seat: number): boolean {
  if (hand.length !== 1) return false;
  return sets.some((s) => s.createdBy === seat && s.kind === "run");
}

export interface PickupPreview {
  chosenId: CardId;
  scooped: CardId[];
}

/** Everything a pickup at `lineIndex` would take: the chosen card plus everything thrown after it. */
export function previewPickup(line: readonly CardId[], lineIndex: number): PickupPreview | null {
  if (lineIndex < 0 || lineIndex >= line.length) return null;
  return { chosenId: line[lineIndex]!, scooped: line.slice(lineIndex) };
}

export interface PickupContext {
  handSize: number;
  /** Total cards the pickup takes from the line (chosen card included). */
  scoopedSize: number;
  ownRunDisplayed: boolean;
}

export type PickupMeldVerdict = { ok: true; kind: MeldKind } | { ok: false; reason: string };

/**
 * Validate a candidate pickup meld against everything the engine will check:
 * valid meld of 3+ including the chosen card, and the post-pickup hand-size
 * guards (hand + scooped − meld must stay ≥ 1, and reaching exactly 1 card
 * needs an own run — the meld itself being a run counts).
 */
export function validatePickupMeld(
  chosenId: CardId,
  meldCardIds: readonly CardId[],
  ctx: PickupContext,
): PickupMeldVerdict {
  if (meldCardIds.length < 3) return { ok: false, reason: "Pick at least 3 cards" };
  if (!meldCardIds.includes(chosenId)) return { ok: false, reason: "Must include the chosen card" };
  const kind = classifyMeld(meldCardIds);
  if (kind === null) return { ok: false, reason: "Not a valid set yet" };
  const handAfter = ctx.handSize + ctx.scoopedSize - meldCardIds.length;
  if (handAfter === 0) return { ok: false, reason: "You must keep a card to discard" };
  if (handAfter === 1 && kind !== "run" && !ctx.ownRunDisplayed) {
    return { ok: false, reason: "This would leave you one card with no run of your own" };
  }
  return { ok: true, kind };
}

/** Suggest a valid mandatory meld for a pickup: chosen card + rest of hand + other scooped cards. */
export function suggestPickupMeld(
  chosenId: CardId,
  hand: readonly CardId[],
  otherScooped: readonly CardId[],
  ctx: PickupContext,
): CardId[] | null {
  const meld = findMeldWith(chosenId, [...hand, ...otherScooped]);
  if (!meld) return null;
  // Only suggest what the engine would actually accept.
  return validatePickupMeld(chosenId, meld, ctx).ok ? meld : null;
}

export function handPoints(hand: readonly CardId[]): number {
  return hand.reduce((sum, id) => sum + cardPoints(id), 0);
}
