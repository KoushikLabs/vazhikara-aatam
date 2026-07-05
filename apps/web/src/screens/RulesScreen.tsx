import type { ReactNode } from "react";

export interface RulesScreenProps {
  /** Render as a full page (with its own <main class="screen">) or as an overlay's inner content. */
  variant?: "page" | "overlay";
  onClose?: () => void;
  /** Extra element shown at the very top of the page variant (e.g. a "Home" link). */
  headerAction?: ReactNode;
}

/**
 * Static, scrollable rules summary condensing PLAN.md Part 1. Content mirrors
 * the spec of record exactly — no invented rules, defaults, or house rules.
 */
export function RulesContent() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <section>
        <h2 className="rules-h2">Setup</h2>
        <p className="rules-p">
          2–6 players, standard playing cards, no jokers. Decks: 1 for 2 players, 2 for 3–4 players, 3 for
          5–6 players (the host can override this). Each player is dealt 10 cards; one card is flipped
          face-up to start the discard line, and the rest form the face-down stock. The player to the
          dealer&rsquo;s left goes first, play proceeds clockwise, and the dealer rotates each round.
        </p>
      </section>

      <section>
        <h2 className="rules-h2">Card points</h2>
        <ul className="rules-list">
          <li>Ace = 15</li>
          <li>K, Q, J, 10 = 10</li>
          <li>2–9 = 5</li>
        </ul>
      </section>

      <section>
        <h2 className="rules-h2">Sets (groups &amp; runs)</h2>
        <p className="rules-p">Every set needs at least 3 cards. There are two kinds:</p>
        <ul className="rules-list">
          <li>
            <strong>Group</strong> — 3 or more cards of the same rank, suits unrestricted. With multiple
            decks, identical duplicates are fine in a group (e.g. 9♠ 9♠ 9♥). Groups can keep growing via
            attachments.
          </li>
          <li>
            <strong>Run</strong> — 3 or more consecutive cards, all the <em>same suit</em>. Rank order is{" "}
            <strong>circular</strong>: A-2-3-4-5-6-7-8-9-10-J-Q-K-A, so K and A are adjacent — K-A-2♦ and
            J-Q-K-A-2♦ are both valid runs. Direction doesn&rsquo;t matter. Each rank appears at most once
            per run, so the longest possible run is all 13 ranks.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="rules-h2">The discard line</h2>
        <p className="rules-p">
          Discards aren&rsquo;t a pile — they lay out in a visible line, in order, and every card thrown
          stays visible to everyone all round. The line is never reshuffled back into the stock.
        </p>
      </section>

      <section>
        <h2 className="rules-h2">Your turn</h2>
        <p className="rules-p">On your turn you must take cards — no passing — in one of two ways:</p>
        <ul className="rules-list">
          <li>
            <strong>Draw from stock</strong> — take exactly the top card.
          </li>
          <li>
            <strong>Pick up from the discard line</strong> — choose any card in the line; you take that
            card <em>plus every card thrown after it</em>. Reaching deeper into the line means taking more
            cards.
          </li>
        </ul>
        <p className="rules-p">
          <strong>Mandatory meld on pickup:</strong> if you pick up from the line, you must immediately lay
          down a brand-new set of 3+ cards that includes the chosen (deepest) card — attaching it to an
          existing set doesn&rsquo;t count. This applies even if you only take the single most recent
          discard. The new set can mix cards from your hand and the cards you just scooped. If you
          can&rsquo;t form such a set, the pickup isn&rsquo;t legal.
        </p>
        <p className="rules-p">
          <em>Example:</em> the line reads A♠ 2♦ J♥ K♣ (in throw order). Picking up from the 2♦ takes 2♦,
          J♥, and K♣ together, and you must lay down a new set containing the 2♦ (e.g. 2♦-3♦-4♦, or
          2♦-2♥-2♠).
        </p>
        <p className="rules-p">
          After any free actions (below), you must discard exactly one card to the end of the line, face
          up. Once thrown, it can&rsquo;t be taken back. Turn passes clockwise.
        </p>
      </section>

      <section>
        <h2 className="rules-h2">Free actions — any time, even off-turn</h2>
        <p className="rules-p">This is what makes the game real-time rather than strictly turn-by-turn:</p>
        <ul className="rules-list">
          <li>
            <strong>Display a new set</strong> from your hand (3+ cards) — no prerequisite, and entirely
            your choice when. Holding sets hidden is legal and often strategic.
          </li>
          <li>
            <strong>Attach</strong> card(s) from your hand to any displayed set — yours or anyone
            else&rsquo;s. Runs extend in either direction around the circle (up to 13 cards); groups grow
            with more of the same rank. You need at least one set of your own already displayed before you
            can attach to anything.
          </li>
        </ul>
        <p className="rules-p">
          <strong>Hand floor:</strong> no display or attach may drop your hand below 1 card — you always
          keep a card to eventually throw. Going out only happens via the declare discard.
        </p>
      </section>

      <section>
        <h2 className="rules-h2">Declaring (winning the round)</h2>
        <p className="rules-p">
          It must be your turn. After drawing or picking up, you get everything in your hand onto the
          table — as sets and/or attachments — except exactly one card, which you discard as your declare.
          That last card scores nothing for anyone; it just ends the round.
        </p>
        <p className="rules-p">
          <strong>You need your own run:</strong> at least one of the sets <em>you yourself displayed</em>{" "}
          must be a proper run. Cards you attached onto other players&rsquo; runs don&rsquo;t count toward
          this.
        </p>
      </section>

      <section>
        <h2 className="rules-h2">Scoring</h2>
        <p className="rules-p">
          Every card on the table is credited to whoever physically placed it — including attachments to
          someone else&rsquo;s set (the attacher scores those points, not the set&rsquo;s owner).
        </p>
        <ul className="rules-list">
          <li>
            <strong>Declarer:</strong> sum of all card points they placed on the table.
          </li>
          <li>
            <strong>Everyone else:</strong> (points they placed on the table) minus (points still in their
            hand). This can go <strong>negative</strong> — e.g. 20 on the table but 70 left in hand scores
            −50 for the round.
          </li>
          <li>
            <strong>Dead round:</strong> if the stock runs out when a player must draw, and they don&rsquo;t
            (or can&rsquo;t legally) pick up from the line instead, the round ends with no declarer —
            everyone scores table-minus-hand as above.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="rules-h2">Winning the game</h2>
        <p className="rules-p">
          Round scores add up across rounds. The target score (500 / 1000 / custom) is set when the game
          is created. The first player to reach or exceed the target wins. If more than one player crosses
          it in the same round, the higher total wins; if still tied, one more round is played.
        </p>
      </section>
    </div>
  );
}

/** Full standalone page, reachable from Home. */
export default function RulesScreen({ headerAction }: { headerAction?: ReactNode }) {
  return (
    <main className="screen rules-screen">
      <div className="rules-container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h1 style={{ fontSize: "1.6rem", margin: 0 }}>How to play</h1>
          {headerAction}
        </div>
        <RulesContent />
      </div>
    </main>
  );
}

/** Overlay variant for use mid-game (table "?" button) — same content, dismissible. */
export function RulesOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="rules-overlay overlay-fade" role="dialog" aria-label="How to play">
      <div className="rules-overlay-sheet">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h1 style={{ fontSize: "1.3rem", margin: 0 }}>How to play</h1>
          <button type="button" className="btn btn-ghost hit-area-44" onClick={onClose} aria-label="Close rules">
            ✕
          </button>
        </div>
        <RulesContent />
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: "1.25rem" }} onClick={onClose}>
          Back to the table
        </button>
      </div>
    </div>
  );
}
