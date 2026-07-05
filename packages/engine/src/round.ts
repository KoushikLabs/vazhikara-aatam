import { applyRoundResult } from "./match.js";
import { attachedSetCards, classifyMeld, runOrder } from "./melds.js";
import { scoreRound } from "./scoring.js";
import type {
  Action,
  ActionResult,
  CardId,
  MatchState,
  MeldKind,
  RoundState,
  Seat,
  TableSet,
} from "./types.js";
import { reject } from "./types.js";

function hasDuplicates(ids: readonly CardId[]): boolean {
  return new Set(ids).size !== ids.length;
}

function hasOwnRun(round: RoundState, seat: Seat): boolean {
  return round.sets.some((set) => set.createdBy === seat && set.kind === "run");
}

function removeAll(hand: readonly CardId[], remove: readonly CardId[]): CardId[] {
  const gone = new Set(remove);
  return hand.filter((id) => !gone.has(id));
}

/**
 * The declare discard is only legal with an own displayed run, so an action
 * that leaves the turn player holding exactly one card in the pre-discard
 * window without one would deadlock the round (their only remaining move —
 * the discard — would be an illegal declare). Such actions are rejected.
 * Out of turn, or before taking cards, dropping to one card is fine: the
 * next take brings the hand back up.
 */
function wouldStrand(
  round: RoundState,
  seat: Seat,
  handSizeAfter: number,
  ownRunAfter: boolean,
): boolean {
  return round.phase === "awaitDiscard" && round.turn === seat && handSizeAfter === 1 && !ownRunAfter;
}

function finishRound(match: MatchState, round: RoundState, declarer: Seat | null): ActionResult {
  round.phase = "ended";
  round.result = scoreRound(round, match.config.playerCount, declarer);
  return { ok: true, state: applyRoundResult(match, round) };
}

/**
 * The single entry point for every game action:
 * (state, action) → new state, or a rejection with a reason.
 *
 * Pure — the input state is never mutated. The server applies incoming
 * actions strictly in arrival order; display/attach are free actions valid
 * on anyone's turn, everything else is turn-locked.
 */
export function applyAction(match: MatchState, action: Action): ActionResult {
  if (match.phase !== "roundActive" || !match.round) {
    return reject("MATCH_NOT_ACTIVE", "no round is in progress");
  }
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= match.config.playerCount) {
    return reject("BAD_SEAT", `seat ${seat} does not exist in this game`);
  }

  const next = structuredClone(match) as MatchState;
  const round = next.round as RoundState;

  switch (action.type) {
    case "drawStock": {
      const gate = requireTakePhase(round, seat);
      if (gate) return gate;
      if (round.stock.length === 0) {
        return reject("STOCK_EMPTY", "the stock is empty — pick up from the line or declare the round dead");
      }
      const card = round.stock.pop() as CardId;
      round.hands[seat]!.push(card);
      round.phase = "awaitDiscard";
      return { ok: true, state: next };
    }

    case "pickupLine": {
      const gate = requireTakePhase(round, seat);
      if (gate) return gate;
      const { lineIndex, meldCardIds } = action;
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= round.line.length) {
        return reject("BAD_LINE_INDEX", "that position does not exist in the discard line");
      }
      const chosen = round.line[lineIndex]!;
      const scooped = round.line.slice(lineIndex);
      if (hasDuplicates(meldCardIds)) {
        return reject("DUPLICATE_CARDS", "the same card appears twice in the meld");
      }
      if (meldCardIds.length < 3) {
        return reject("MELD_TOO_SMALL", "the pickup meld needs at least 3 cards");
      }
      if (!meldCardIds.includes(chosen)) {
        return reject(
          "MELD_MISSING_CHOSEN_CARD",
          "the new set must include the chosen (deepest) card from the line",
        );
      }
      const hand = round.hands[seat]!;
      const available = new Set<CardId>([...hand, ...scooped]);
      for (const id of meldCardIds) {
        if (!available.has(id)) {
          return reject(
            "CARD_NOT_AVAILABLE",
            `${id} is not in your hand or the scooped cards — the pickup meld must be a brand-new set, not an attachment`,
          );
        }
      }
      const kind = classifyMeld(meldCardIds);
      if (!kind) {
        return reject("INVALID_MELD", "those cards form neither a group nor a same-suit circular run");
      }
      const handSizeAfter = hand.length + scooped.length - meldCardIds.length;
      if (handSizeAfter === 0) {
        return reject("WOULD_EMPTY_HAND", "you must keep at least one card to discard");
      }
      const ownRunAfter = kind === "run" || hasOwnRun(round, seat);
      if (handSizeAfter === 1 && !ownRunAfter) {
        return reject(
          "WOULD_STRAND",
          "this would leave you one card with no run of your own displayed — you could not legally declare",
        );
      }
      placeNewSet(round, seat, kind, meldCardIds);
      const meldSet = new Set(meldCardIds);
      const leftovers = scooped.filter((id) => !meldSet.has(id));
      round.hands[seat] = [...removeAll(hand, meldCardIds), ...leftovers];
      round.line = round.line.slice(0, lineIndex);
      round.phase = "awaitDiscard";
      return { ok: true, state: next };
    }

    case "display": {
      const { cardIds } = action;
      if (hasDuplicates(cardIds)) {
        return reject("DUPLICATE_CARDS", "the same card appears twice in the set");
      }
      if (cardIds.length < 3) {
        return reject("MELD_TOO_SMALL", "a new set needs at least 3 cards");
      }
      const hand = round.hands[seat]!;
      const handSet = new Set(hand);
      for (const id of cardIds) {
        if (!handSet.has(id)) {
          return reject("CARD_NOT_AVAILABLE", `${id} is not in your hand`);
        }
      }
      const kind = classifyMeld(cardIds);
      if (!kind) {
        return reject("INVALID_MELD", "those cards form neither a group nor a same-suit circular run");
      }
      const handSizeAfter = hand.length - cardIds.length;
      if (handSizeAfter < 1) {
        return reject("HAND_FLOOR", "you must always keep at least one card in hand");
      }
      const ownRunAfter = kind === "run" || hasOwnRun(round, seat);
      if (wouldStrand(round, seat, handSizeAfter, ownRunAfter)) {
        return reject(
          "WOULD_STRAND",
          "this would leave you one card with no run of your own displayed — you could not legally declare",
        );
      }
      placeNewSet(round, seat, kind, cardIds);
      round.hands[seat] = removeAll(hand, cardIds);
      return { ok: true, state: next };
    }

    case "attach": {
      const { setId, cardIds } = action;
      if (cardIds.length === 0) {
        return reject("INVALID_ATTACH", "no cards to attach");
      }
      if (hasDuplicates(cardIds)) {
        return reject("DUPLICATE_CARDS", "the same card appears twice in the attachment");
      }
      if (!round.sets.some((set) => set.createdBy === seat)) {
        return reject("NEED_OWN_SET", "you must display a set of your own before attaching to anything");
      }
      const target = round.sets.find((set) => set.id === setId);
      if (!target) {
        return reject("SET_NOT_FOUND", "that set is not on the table");
      }
      const hand = round.hands[seat]!;
      const handSet = new Set(hand);
      for (const id of cardIds) {
        if (!handSet.has(id)) {
          return reject("CARD_NOT_AVAILABLE", `${id} is not in your hand`);
        }
      }
      const newCards = attachedSetCards(target.kind, target.cards, cardIds);
      if (!newCards) {
        return reject(
          "INVALID_ATTACH",
          target.kind === "group"
            ? "group attachments must match the group's rank"
            : "run attachments must extend the run in circular order, same suit, each rank once",
        );
      }
      const handSizeAfter = hand.length - cardIds.length;
      if (handSizeAfter < 1) {
        return reject("HAND_FLOOR", "you must always keep at least one card in hand");
      }
      if (wouldStrand(round, seat, handSizeAfter, hasOwnRun(round, seat))) {
        return reject(
          "WOULD_STRAND",
          "this would leave you one card with no run of your own displayed — you could not legally declare",
        );
      }
      target.cards = newCards;
      for (const id of cardIds) {
        round.placedBy[id] = seat;
      }
      round.hands[seat] = removeAll(hand, cardIds);
      return { ok: true, state: next };
    }

    case "discard": {
      if (round.phase !== "awaitDiscard") {
        return reject("WRONG_PHASE", "you must take cards before discarding");
      }
      if (round.turn !== seat) {
        return reject("NOT_YOUR_TURN", "it is not your turn");
      }
      const hand = round.hands[seat]!;
      if (!hand.includes(action.cardId)) {
        return reject("CARD_NOT_AVAILABLE", `${action.cardId} is not in your hand`);
      }
      const handAfter = removeAll(hand, [action.cardId]);
      if (handAfter.length === 0) {
        // Going out: the declare discard. Requires a run the player laid down
        // themselves — attachments to other players' runs do not count.
        if (!hasOwnRun(round, seat)) {
          return reject(
            "DECLARE_NEEDS_OWN_RUN",
            "to declare, at least one set you laid down yourself must be a run",
          );
        }
        round.line.push(action.cardId); // the declare card scores for nobody
        round.hands[seat] = handAfter;
        return finishRound(next, round, seat);
      }
      round.line.push(action.cardId);
      round.hands[seat] = handAfter;
      round.turn = (seat + 1) % match.config.playerCount;
      round.phase = "awaitTake";
      return { ok: true, state: next };
    }

    case "declareDead": {
      const gate = requireTakePhase(round, seat);
      if (gate) return gate;
      if (round.stock.length > 0) {
        return reject("STOCK_NOT_EMPTY", "the stock still has cards — you must draw or pick up");
      }
      return finishRound(next, round, null);
    }
  }
}

function requireTakePhase(round: RoundState, seat: Seat) {
  if (round.phase !== "awaitTake") {
    return reject("WRONG_PHASE", "you have already taken cards this turn");
  }
  if (round.turn !== seat) {
    return reject("NOT_YOUR_TURN", "it is not your turn");
  }
  return null;
}

function placeNewSet(round: RoundState, seat: Seat, kind: MeldKind, cardIds: readonly CardId[]): void {
  const cards = kind === "run" ? (runOrder(cardIds) as CardId[]) : [...cardIds];
  const set: TableSet = { id: `set-${round.nextSetId}`, kind, createdBy: seat, cards };
  round.nextSetId += 1;
  round.sets.push(set);
  for (const id of cardIds) {
    round.placedBy[id] = seat;
  }
}
