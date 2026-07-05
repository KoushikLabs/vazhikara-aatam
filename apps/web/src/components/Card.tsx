import { cardFromId, rankToken, type CardId, type Suit } from "@vazhikara/engine";

const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS = new Set<Suit>(["H", "D"]);

export interface CardProps {
  id: CardId;
  compact?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (() => void) | undefined;
  /**
   * Play a short entrance fade/slide on mount (CSS animation, inert under
   * prefers-reduced-motion). Callers key cards by id, so this only fires the
   * first time a given physical card appears in this list — not on every
   * re-render of an already-present card.
   */
  animate?: boolean;
}

/** Pure-CSS playing card: rank token + suit glyph. */
export function PlayingCard({ id, compact, selected, highlighted, onClick, animate }: CardProps) {
  const card = cardFromId(id);
  const glyph = SUIT_GLYPH[card.suit];
  const red = RED_SUITS.has(card.suit);
  const classes = [
    "card",
    red ? "red" : "",
    compact ? "compact" : "",
    selected ? "selected" : "",
    highlighted ? "highlighted" : "",
    animate ? "card-enter" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <div className={classes} aria-label={`${rankToken(card.rank)} of ${card.suit}`}>
      <span className="rank">{rankToken(card.rank)}</span>
      <span className="suit">{glyph}</span>
      <span className="rank" style={{ alignSelf: "flex-end", transform: "rotate(180deg)" }}>
        {rankToken(card.rank)}
      </span>
    </div>
  );

  if (!onClick) return content;

  return (
    <button type="button" className="card-button" onClick={onClick} aria-pressed={selected}>
      {content}
    </button>
  );
}
