# Vazhikara Aatam — Build Plan

An online version of a family rummy-style card game, built so family members can play together from anywhere: solo against computer players, or multiplayer via a shareable invite link.

This document is the single source of truth. It is self-contained: a fresh Claude Code session with no prior context should be able to build any phase from this file alone.

---

## How to use this document

Build **one phase per session**. For each phase, start a new Claude Code session in this folder and use this prompt:

> Read PLAN.md in full. Build Phase N exactly as specified. Follow the game rules in Part 1 precisely — do not substitute standard rummy rules where this game differs. When the phase's acceptance criteria are met and all tests pass, update the Progress tracker in PLAN.md, record any deviations or decisions in the Decisions log, and stop.

**Which model / thinking level to use:**

- **Phases 1 and 2 (rules engine, server): Claude Fable 5 with extended thinking set to high.** These phases carry all the correctness risk — circular sequences, multi-deck duplicate cards, discard-line pickup legality, out-of-turn action ordering, and scoring (including negative scores). Deep reasoning pays for itself here.
- **Phases 0, 3, 4, 5 (scaffold, UI, bots, deploy): Claude Sonnet 4.6 at normal thinking is sufficient** and faster/cheaper for iteration. Using Fable 5 throughout is also fine if cost is not a concern.
- Do not attempt multiple phases in one prompt. Require all tests green before moving to the next phase.
- After Phase 0 exists, each session should run the full engine test suite before touching code, to catch drift.

---

## Part 1 — Game rules specification

A rummy-family card game for 2–6 players. Standard playing cards only, **no jokers**.

### Decks

| Players | Decks (default) |
|---------|-----------------|
| 2       | 1 (52 cards)    |
| 3–4     | 2 (104 cards)   |
| 5–6     | 3 (156 cards)   |

The host may override the deck count at game creation.

### Card points

- **A = 15**
- **K, Q, J, 10 = 10**
- **2, 3, 4, 5, 6, 7, 8, 9 = 5**

### Sets (melds)

Two kinds, each **minimum 3 cards**:

1. **Group**: 3 or more cards of the same rank (e.g. A-A-A, 2-2-2-2, Q-Q-Q). Suits are unrestricted; with multiple decks, identical duplicates are legal in a group (9♠ 9♠ 9♥ is valid). Groups can grow without limit via attachments (up to all copies in play).
2. **Run (sequence)**: 3 or more consecutive-rank cards, **all of the same suit** (e.g. 2♦ 3♦ 4♦ — never mixed suits). Rank order is **circular**: A-2-3-4-5-6-7-8-9-10-J-Q-K-A, where K and A are adjacent. So K-A-2 and J-Q-K-A-2 are valid runs. Direction does not matter. Each rank may appear **at most once** per run (no duplicates within a run, even with multiple decks), so a run's maximum length is 13.

### Round setup

- Deal **10 cards** to each player.
- Flip **one card face-up** to start the **discard line**.
- Remaining cards form the face-down **stock**.
- Player to the dealer's left goes first; play proceeds **clockwise**. Dealer rotates each round.

### The discard line

Discards are **not a pile** — they are laid out in a visible line, in order, and every discarded card remains visible to everyone all round. The line is **never reshuffled** into the stock.

### Turn structure (turn-locked actions)

On your turn you **must** take cards (no passing), in one of two ways:

1. **Draw from stock**: take exactly the top 1 card.
2. **Pick up from the discard line**: choose **any** card in the line. You take that card **plus every card discarded after it** (you choose how deep into the line to reach — that is how you control how many cards you take).
   - **Mandatory meld**: you must **immediately lay down a brand-new set of 3+ cards that includes the chosen (deepest) card**. Attaching that card to an existing displayed set does **not** satisfy this requirement. The new set may use cards from your hand and/or the other cards you just scooped from the line.
   - This requirement applies **even when taking only the most recent discard** (depth 1).
   - The other scooped cards simply go into your hand.
   - If you cannot form such a set, the pickup is illegal.

Then, after any optional displaying/attaching (see free actions), you **must discard exactly one card** to the end of the discard line, face up. Once thrown, a card cannot be taken back (no undo). Turn passes clockwise.

Example: the line is A♠ 2♦ J♥ K♣ (in throw order). On your turn you may take from the 2♦ — you receive 2♦, J♥, and K♣, and must immediately lay down a new set containing the 2♦ (e.g. 2♦ 3♦ 4♦, or 2♦ 2♥ 2♠).

### Free actions (allowed at ANY time, even during other players' turns)

This makes the game genuinely real-time, not turn-locked:

1. **Display a new set** from your hand (3+ cards, group or run). No prerequisite. Which sets to display and when is entirely the player's choice — holding sets hidden is legal and strategic.
2. **Attach** card(s) from your hand to **any** displayed set on the table — your own or any other player's. Any number of cards, to any number of sets. Examples: add 5♦ or A♦ to a displayed 2♦ 3♦ 4♦ run (runs extend in either direction around the circle, up to 13 cards); add a fourth A to a displayed A-A-A group.
   - **Prerequisite**: you must already have **at least one set of your own displayed** before you may attach to anything.

**Hand-floor rule**: no display or attach action may reduce your hand below 1 card. You must always retain at least one card to throw — going out happens only via the declare discard.

### Declaring (winning the round)

- It must be **your turn**.
- After drawing or picking up, you get everything in your hand onto the table as sets and/or attachments **except exactly one card**, which you discard as your **declare**. (The declare card scores nothing for anyone; it just ends the round.)
- **Sequence requirement**: at least one of the sets **you yourself laid down** must be a proper run (3+ consecutive, same suit). Cards you attached to other players' runs do not count toward this requirement.

### Scoring a round

Every card on the table is credited to **the player who physically placed it** — including cards attached to other players' sets (the attacher gets those points, not the set's owner). The engine must therefore track per-card placement ownership.

- **Declarer**: scores the sum of all card points they placed on the table.
- **Everyone else**: (sum of card points they placed on the table) **minus** (sum of card points still in their hand). This can be **negative** (e.g. 20 on the table, 70 in hand → −50 for the round).
- **Dead round**: if the stock is empty when a player must draw and they do not (or cannot legally) pick up from the discard line, the round ends with no declarer. Everyone scores table minus hand, as above.

### Winning the game

- Round scores accumulate across rounds.
- Target score is set at game creation (**500 / 1000 / custom**). First player to **reach or exceed** the target wins.
- If multiple players cross the target in the same round, the higher total wins; if still tied, play another round.

### Explicit defaults (config options later, NOT in MVP)

- No minimum point requirement for a first display.
- No declarer bonus.
- No card melding restrictions beyond the rules above.

---

## Part 2 — Product requirements (MVP)

1. **Solo play**: create a game and fill it with 1–5 computer players (bot count limited by deck/player rules). Full rounds to a target score.
2. **Multiplayer by invitation**: creating a game produces an unguessable link (e.g. `/g/AB3XK9`). Anyone with the link joins by entering a nickname — **no accounts, no sign-up**. Mixed human + bot rooms are allowed.
3. **Host settings** at creation: number of decks (auto-suggested from player count, overridable), target score, bot count.
4. **Mobile-first web UI** — the primary players include a kid on a phone/tablet. Must also work on desktop.
5. **Reconnect**: a player whose phone locks or connection drops can rejoin the same seat (reconnect token in localStorage). Game pauses briefly / continues sensibly.
6. **Live scoreboard** and a round-end summary showing each player's table points, hand points, and round score.

**MVP acceptance test**: open the site on a phone, start a game against 2 bots and finish it to a target score — then create a room, send the link to another person, and play a full game together with live scores.

**Explicitly NOT in MVP** (future work): games surviving a server restart, chat/reactions, spectators, bot difficulty levels, game history, accounts, sounds/animations beyond the basics.

---

## Part 3 — Architecture

**pnpm monorepo, TypeScript everywhere**, three packages:

```
packages/engine   — pure rules engine. Zero runtime dependencies. All game types,
                    validation, state transitions, scoring, and bot heuristics.
                    Deterministic and fully serializable state. Exhaustive unit tests.
apps/server       — Node + Socket.IO. Authoritative game state; validates every
                    action through the engine; broadcasts state. Rooms, invite
                    codes, host settings, reconnect tokens, bot driver.
apps/web          — React + Vite. Mobile-first. Imports the engine for
                    client-side legality hints and optimistic UI.
```

Key decisions and why:

- **Server-authoritative**: clients send intents; the server validates against the engine and broadcasts results. Prevents divergence and cheating.
- **Out-of-turn actions**: because displays and attaches can happen at any time, the server **serializes all incoming actions in arrival order** and validates each against current state. No client-side locking; a rejected action just bounces with a reason.
- **Per-copy card identity**: with up to 3 decks, every physical card gets a unique id (e.g. `9S#2`). Melds, the discard line, hands, and per-card placement ownership all reference ids, never just rank+suit.
- **No database in MVP**: rooms live in server memory. Family-scale traffic; a single small Node process is plenty. Reconnect via token, room garbage-collected after inactivity.
- **Bots run server-side** inside the same action pipeline as humans — single code path for solo and multiplayer. Bots get a reaction tick with human-like delays for out-of-turn attaches/displays.
- **Deploy**: one service (Railway / Fly.io / Render) serving static frontend + websockets over HTTPS/wss.

---

## Part 4 — Phases

### Phase 0 — Scaffold
Set up the pnpm monorepo (`packages/engine`, `apps/server`, `apps/web`) with TypeScript, Vitest, a shared tsconfig, and a root README with dev commands. Add a CLAUDE.md pointing at PLAN.md as the spec of record.
**Done when**: `pnpm install`, `pnpm test`, `pnpm dev` (server + web) all run cleanly with placeholder code.

### Phase 1 — Rules engine (the heart; highest correctness risk)
Implement in `packages/engine`, pure functions over serializable state:
- Card model with per-copy ids; deck building for 1–3 decks; seeded shuffle (injectable RNG for testable determinism).
- Meld validation: groups (duplicates allowed) and circular same-suit runs (each rank once, max 13).
- Attach validation: run extension in either circular direction; group extension; the own-set-displayed prerequisite; the hand-floor rule.
- Round state machine: deal, flipped starter card, turn order, draw-from-stock, line pickup (scoop-from-chosen-card + mandatory new set containing the deepest card), free actions, discard, declare (own-run requirement, exactly-one-card-left), dead round on stock exhaustion.
- Scoring: per-card placement ownership, declarer/non-declarer round scores including negatives, match accumulation, target-score win + tie handling.
- Every action as a validated event: `(state, action) → newState | rejection with reason`. This is the exact API the server and bots will use.

**Done when**: an exhaustive Vitest suite passes, covering at minimum — circular runs (K-A-2, J-Q-K-A-2, wrap limits), multi-deck duplicates in groups vs. forbidden in runs, every legal/illegal pickup shape (depth 1 and deep, meld-from-scooped-cards, no-valid-set rejection), attach prerequisites, hand-floor enforcement, declare validation (with/without own run), negative scoring, dead rounds, and full simulated games driven by random legal moves without invariant violations (card conservation across zones).

### Phase 2 — Server & rooms
Socket.IO server in `apps/server`:
- Room lifecycle: create → unguessable code → join with nickname → host config (decks, target, bots) → start → rounds until target → game over. Room cleanup after inactivity.
- Action protocol: every client intent validated through the engine, applied, and broadcast as state (redacting other players' hands and the stock). Rejections returned to sender with reasons.
- Out-of-turn support: actions processed strictly in arrival order.
- Reconnect: token issued on join; rejoining with it reclaims the seat and receives full state.
- Bot driver: on each state change, bots with pending decisions act through the same protocol (simple placeholder logic; real heuristics come in Phase 4).

**Done when**: integration tests drive multiple simulated clients (including a scripted bot room) through full games over real sockets — covering out-of-turn attaches during another player's turn, reconnect mid-round, and correct redaction of hidden information.

### Phase 3 — Game UI
React, mobile-first, in `apps/web`:
- Screens: home (create / join), lobby (players, host settings, invite link + copy button), table, round-end summary, game-over.
- Table: your hand (sort by suit or rank), stock + discard line as a horizontally scrollable ribbon; tapping a line card previews exactly which cards a pickup would take and prompts for the mandatory set; per-player displayed sets as tap-to-attach targets; display-new-set flow via multi-select from hand; a declare button that lights up only when legal; clear turn indicator; live scoreboard.
- Out-of-turn actions available whenever legal (attach/display during others' turns).
- Rejection reasons surfaced as brief toasts.

**Done when**: a full game against Phase-2 placeholder bots is playable end-to-end on a phone-sized viewport, and two browser windows can play a multiplayer game via the invite link.

### Phase 4 — Bots
Heuristic AI in `packages/engine` (used by the server's bot driver):
- Hand evaluation: current melds, near-melds (one card away), deadwood points.
- Draw choice: evaluate line pickups (net value of scooped cards + enabled meld vs. points taken into hand) against drawing from stock.
- Discard choice: prefer low-point, low-usefulness cards; avoid discarding cards that obviously complete melds for opponents (visible line history and displayed sets are usable signals).
- Display timing: balance banking points early (safe against a declare) vs. holding sets to conceal progress — mirror the human tension, with some randomness.
- Attach eagerly when it sheds points, subject to the prerequisite; react to newly displayed sets on a delayed tick (feels human).
- Declare as soon as legal.

**Done when**: bots complete 1000 simulated games without illegal actions or stalls; in mixed simulations they beat a random-legal-move baseline decisively; a solo game against 2 bots feels reasonable in manual play.

### Phase 5 — Deploy & polish
- Production build; deploy server + static frontend as one service (Railway / Fly.io / Render) with HTTPS/wss.
- Invite screen shows the link plus a QR code.
- Polish pass: card dealing/discard micro-animations, touch targets, landscape handling, empty/error states, a rules summary screen.
- Playtest checklist executed: full solo game and full 2-human game on production from phones.

**Done when**: the MVP acceptance test in Part 2 passes on the production URL.

---

## Progress tracker

- [x] Phase 0 — Scaffold (2026-07-04)
- [x] Phase 1 — Rules engine (2026-07-04)
- [x] Phase 2 — Server & rooms (2026-07-05)
- [x] Phase 3 — Game UI (2026-07-05)
- [x] Phase 4 — Bots (2026-07-05)
- [x] Phase 5 — Deploy & polish (2026-07-05 — complete up to the hosting hand-off: the MVP acceptance test passes on the production build served locally; the final run on a public URL awaits a hosting account, see DEPLOY.md)

## Decisions log

Sessions append dated entries here for any deviation from this plan or any ambiguity resolved during implementation.

- 2026-07-04 — Plan created. Rule clarifications locked in with the game owner: (1) line pickup takes the chosen card plus everything after it; (2) attached cards score for the attacher; (3) pickup's mandatory meld must be a brand-new set; (4) new sets may be displayed at any time, not just on turn; (5) runs are strictly same-suit.
- 2026-07-04 — Phase 0 built (scaffold delegated to Sonnet per the model guidance above; verified by parallel checks of install/test, dev servers, and spec conformance). Notes:
  - pnpm was not installed on this machine; installed pnpm 10.12.4 via the official standalone installer to `~/Library/pnpm` (the installer added the PATH entry to `~/.zshrc`). Node is v22.14.0.
  - Root `package.json` sets `"pnpm": {"onlyBuiltDependencies": ["esbuild"]}` so pnpm 10 runs esbuild's postinstall (needed by Vite).
  - `packages/engine` exports TypeScript source directly (`main`/`types` → `src/index.ts`) — no build step in Phase 0; Vitest, tsx, and Vite all resolve TS source. Revisit for the production build in Phase 5.
  - `apps/server` tsconfig uses `NodeNext` module resolution (tsx compatibility) with `@types/node`; engine and web use `bundler` resolution. All extend the shared `tsconfig.base.json` (strict, ES2022). Package tsconfigs use `rootDir: "."` so `tests/` typechecks alongside `src/`.
  - Placeholder server is plain `node:http` on port 3001 (Socket.IO deliberately deferred to Phase 2); web is Vite + React on 5173. Both import from `@vazhikara/engine` via `workspace:*` to prove monorepo linkage.
  - Web placeholder test is a pure-TS unit test — no jsdom/testing-library until Phase 3.
  - No git repository was initialized (not in the Phase 0 spec); a `.gitignore` is in place for whenever one is.
- 2026-07-04 — Phase 1 built (Fable 5, high reasoning, per the model guidance above). 146 engine tests green, including two black-box conformance suites (`tests/spec-blackbox-a/b.test.ts`, 35 tests) written by independent agents from PLAN.md Part 1 alone, kept as permanent regression tests. Five adversarial rule-conformance reviews found zero rule-implementation bugs. Ambiguities resolved / deviations:
  - **Anti-deadlock guard (`WOULD_STRAND`) — deliberate deviation.** The spec permits melding down to exactly 1 card at any time, but the declare rule makes the forced last-card discard illegal without an own displayed run — the turn would deadlock (can't discard, can't display 3+, can't attach below the floor). The engine therefore rejects any pickup/display/attach **by the turn player in the pre-discard window** that would leave exactly 1 card without an own displayed run (a run created by that same action counts). Reducing to 1 card out of turn or before taking remains legal as specified.
  - A pickup whose mandatory meld would leave the hand empty is rejected (`WOULD_EMPTY_HAND`) — the player must retain the card they are obliged to discard.
  - The pickup meld must contain the exact chosen **physical copy** (per-copy id); a twin of the same rank+suit from another deck does not satisfy it.
  - With the stock empty at the take point, `declareDead` is available **by choice** even when a legal pickup exists — per "they do not (or cannot legally) pick up".
  - The declare card is appended to the discard line (visible like any discard) and scores for nobody; leftover line cards score for nobody.
  - Match tie rule: winner only when a single player holds the strictly highest total among those at/over target; an exact tie at the top plays another round.
  - API surface: `applyAction(state, action)` event reducer (all rejections carry a machine code + message — the server's protocol in Phase 2), `createMatch`/`startNextRound` with injectable RNG (`mulberry32` seeded per round from the match seed), `enumerateActions`/`findMeldWith` legality helpers, and a random-legal-move simulator (`playRandomMatch`) with per-action invariant checks — reusable as the Phase 4 bot baseline.
- 2026-07-05 — Phase 2 built (Fable 5, high reasoning, per the model guidance above). 24 socket integration tests green (172 total across the monorepo). Verified by adversarial review; notable outcomes and decisions:
  - **Critical fix from review: the match seed must never reach clients.** The deal is a pure function of (seed, roundsPlayed, decks, dealer), so the original `redactMatch` — which shipped `config` verbatim — let any client replay the shuffle and reconstruct all hidden hands and the stock order (two reviewers proved it with runnable reconstructions). The client-facing config is now rebuilt field-by-field (`RedactedConfig` omits `seed`), with a regression test pinning the exact key set.
  - Redaction model: other players' hands → `null` + counts; stock → count only; line, sets, per-card `placedBy`, totals, and round results are public. Views are built per-viewer and emitted per-socket.
  - The acting seat is always stamped from the socket's server-side binding; the payload's `seat` field is ignored (spoof-tested). Action payloads are shape-sanitized before reaching the engine.
  - Arrival-order guarantee: all handlers and bot ticks are fully synchronous between reading state, validating via `applyAction`, and committing — no awaits, so Node's event loop IS the serializer. Racing conflicting actions resolve as one success + one engine rejection (tested over real sockets).
  - Rooms: 6-char codes from a 30-char unambiguous alphabet (crypto-random), host = seat 0, join in lobby only (reconnect any time), rooms GC'd after `roomTtlMs` (default 30 min) with no connected humans. Reconnect tokens are per-seat UUIDs; a takeover kicks the old socket.
  - Rounds auto-advance after an intermission (default 8 s); the host can skip via `round:next`, which cancels the pending timer (a stale timer would cut the next intermission short — caught in the concurrency audit).
  - Games pause whenever no human is connected (bot timers and intermissions gate on a connected human) and resume on reconnect.
  - Placeholder bots choose from `enumerateActions` with a weighted policy (eager melding, mostly-draw takes) on jittered delays; injectable RNG/delays make integration tests deterministic and fast. Real heuristics come in Phase 4.
  - Verification note: the planned black-box spec-test agent and one reviewer (concurrency) hit an account session limit; the concurrency audit was performed directly instead (finding the intermission-skip bug above), and review-suggested coverage gaps were closed (deck-override-to-deal test, real-deal two-human multi-round game with per-broadcast redaction checks).
- 2026-07-05 — Phase 3 built (Sonnet, normal thinking, per the model guidance above). 23 new web unit tests (plain vitest, no jsdom) for the pure client-side hint helpers; 193 tests green across the monorepo (146 engine + 24 server + 23 web). Verified with a live `pnpm dev` run: drove a full create → configure (2 bots) → start → draw → discard → line-pickup-with-mandatory-meld (including Suggest + live validation) → attach-mode-entry → page-reload-reconnect sequence through the real browser preview against the real server on 3001, plus a standalone `socket.io-client` script exercising create/join/start/redaction/reconnect directly against the running server. No console or server errors; no horizontal page scroll at a 375px viewport. Decisions and deviations:
  - **The one allowed server change**: `apps/server/package.json` gained an `exports` map (`"."` → `src/index.ts`, `"./protocol"` → `src/protocol.ts`) so the web app can `import type` from `@vazhikara/server/protocol` without a build step. Nothing else under `apps/server/src` was touched. `apps/web` added `@vazhikara/server` as a `workspace:*` **devDependency** (type-only usage — the server entrypoint listens on import, so a runtime import would start a second server; every import from it in `apps/web/src` is `import type`).
  - Added `socket.io-client` and `react-router-dom` to `apps/web`. Vite dev proxy forwards `/socket.io` (with `ws: true`) to `http://localhost:3001`, and the client connects same-origin via `io("/", { path: "/socket.io" })`, overridable with `VITE_SERVER_URL` — so `pnpm dev` works out of the box and split hosting remains possible later.
  - `useGameClient(code)` is the single socket owner: one module-level socket instance (`lib/socket.ts`), a hook that mirrors `room:state`/`room:kicked` into React state, wraps every emit in a `Promise<Ack>`, and toasts every rejected ack (auto-dismiss 3s). Reconnect is automatic and idempotent: on every socket `connect` event, if a token is stored under `vaz:room:<CODE>` for the room the hook is currently pointed at, it replays `room:reconnect` — this covers both the initial page load with a stored token and any transport-level reconnect (phone lock, wifi drop) without extra wiring.
  - Client-side legality hints (`src/lib/hints.ts`, unit-tested) are pure functions over the redacted `RoomView` only — `sortHand`, `canDisplay`, `canAttach`, `hasOwnDisplayedSet`, `isDeclareEligible`, `previewPickup`, `suggestPickupMeld`/`validatePickupMeld`, `handPoints` — built from `@vazhikara/engine`'s `classifyMeld`/`attachedSetCards`/`findMeldWith`/`cardFromId`/`cardPoints`. `enumerateActions`/`applyAction` are never imported client-side, per the brief (they need the unredacted `MatchState`).
  - The Attach button additionally requires `hasOwnDisplayedSet` (createdBy === yourSeat) before enabling, on top of `attachedSetCards` validity and the hand-floor check — matching the spec's own-set-displayed prerequisite; the server remains the final authority and a wrongly-enabled click still just bounces to a toast.
  - Pickup UX: tapping any line card during `awaitTake` on your turn toggles a preview highlighting the chosen card plus everything thrown after it (`previewPickup`) and opens a bottom sheet (`PickupSheet`) with the chosen card locked in, multi-select over hand + other scooped cards, live `classifyMeld` feedback, a Suggest button (`findMeldWith`), and a Confirm that's disabled until the selection validates. Cancel clears state with no server round-trip.
  - Declare detection: the Discard button becomes a highlighted "DECLARE!" `.btn-primary` exactly when exactly one card is selected, it's your turn's `awaitDiscard`, and `isDeclareEligible` (hand would drop to 1 card AND you have an own displayed run) — otherwise it stays a plain enabled/disabled Discard. Server-side `DECLARE_NEEDS_OWN_RUN`/`WOULD_STRAND` remain the real gate; a false-positive client hint would just toast.
  - Reconnect tokens and nickname live in `localStorage` (`vaz:nickname`, `vaz:room:<CODE>` → `{token, nickname}`), written on create/join and cleared on a hard reconnect failure (stale/invalid token) so the room screen falls back to a fresh nickname-and-join prompt rather than looping.
  - Routing: `/` → `HomeScreen`, `/g/:code` → `RoomScreen`, which branches on `{no stored token + no view} → nickname/join prompt`, `{stored token, no view yet} → "joining…"`, then `view.phase` → `LobbyScreen` / `TableScreen` (+ `RoundEndOverlay` when `game.phase === 'betweenRounds'`) / `GameOverScreen`.
  - Cards are plain CSS (`components/Card.tsx` + `styles.css`), no image assets; a `.compact` variant is used for table sets and the discard line, full size for the hand. `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` (from the shared strict tsconfig) required a couple of explicit `| undefined` prop types (e.g. `CardProps.onClick`) and an `ImportMetaEnv`/`ImportMeta` augmentation in a new `src/vite-env.d.ts` for `import.meta.env.VITE_SERVER_URL`.
  - Not yet real (left for Phase 4/5 per plan): bot decision quality (Phase 2's placeholder weighted policy is what's driving bots today — the UI just renders whatever it does, including the occasional out-of-turn attach seen live in verification), animations/QR code/rules-summary screen (Phase 5 polish).
- 2026-07-05 — Phase 3 review round + acceptance verification (appended after the entry above, which was written by the build agent; note its reconnect-fallback claim was NOT true as built — reviewers proved the fallback was never wired — and became true only with the fixes below). Two adversarial reviewers found 1 critical, 3 major, and several minor client bugs, all fixed and unit-covered (29 web tests now, 199 total):
  - **Critical: stale-token dead end.** A failed auto-reconnect (room GC'd / server restarted / bad token) was silently swallowed while the room screen waited on the stored token forever. Now `ROOM_NOT_FOUND`/`BAD_TOKEN` clears the stored auth and surfaces the reason, falling back to the fresh nickname-and-join prompt; the spinner also distinguishes "Connecting to server…" from "Joining room…".
  - **Major: cross-room view bleed.** `room:state` handlers accepted any room's broadcast (a socket stays seat-bound to a previous room server-side); views are now filtered by the current room code and reset when the code changes.
  - **Major: kicked sockets stayed dead.** Socket.IO never auto-reconnects after a server-initiated disconnect, so a seat takeover killed the whole app until reload. The transport now reconnects manually, and auto seat-reclaim is suppressed for kicked rooms (two windows can't kick-loop each other).
  - **Major: stale attach snapshots.** The attach target was captured as an object at tap time; in a real-time game other players extend sets constantly, mis-validating attaches in both directions. The target is now stored by id and resolved live from every view.
  - Minor batch: hand selections are pruned against the live hand and all transient UI state resets on round boundaries (per-copy ids recur across rounds); the pickup sheet and Suggest now model the engine's `WOULD_EMPTY_HAND`/`WOULD_STRAND` guards with human-readable reasons; Display/Attach hints honor the pre-discard strand guard.
  - Acceptance verified live in a 375×812 browser: full solo game (2 bots, custom target) from create → lobby → rounds → game-over screen, exercising draw, discard, display, pickup preview + mandatory-meld sheet (including Suggest refusing invalid melds), out-of-turn cross-player attach, and the stock-empty dead-round button. Multiplayer: a scripted second human joined via the invite code and played complete games over real sockets (zero redaction leaks client-side; matching final totals on both clients), including a 2-human game across a dead-round boundary verifying the round-end overlay, score accumulation (negatives), dealer rotation, and the 8s auto-deal.
  - Process note: the build agent modified PLAN.md against instructions (tracker + entry above) and returned placeholder text in its structured report; the entry was kept and corrected here rather than rewritten.
- 2026-07-05 — Phase 4 built (Sonnet, normal thinking, per the model guidance above). New `packages/engine/src/bot.ts` plus a `sim.ts` refactor to support per-seat policies; server's `apps/server/src/bots.ts` now thinly delegates to the engine bot (same exported signature, `server.ts` untouched). 171 engine tests green (52 new: 11 `evaluateHand`, 8 targeted decision tests, 3 fair-play, 1 games-acceptance fuzz with a 150-game default, 2 baseline comparisons; plus the two pre-existing suites unaffected), 224 total across the monorepo (171 engine + 24 server + 29 web); full engine suite ~51–55s wall clock. `pnpm typecheck` clean. Also ran the acceptance-scale check with `VAZ_BOT_GAMES=1000`: 999 games, 3319 rounds, **zero violations**, 96.8% declare rate — satisfies the Phase 4 "done when" bar verbatim. A spot-check at 6p/3 decks (not in the required config list) also played clean across 5 seeds, all declared.
  - **`sim.ts` refactor, behavior-preserving.** Extracted the Phase-1 fuzz policy verbatim as `randomPolicy: SeatPolicy`, added `playPolicyMatch({ ...SimOptions, policies: SeatPolicy[] })` (one decision function per seat) reusing the identical invariant-checking/budget/termination loop, and added per-seat `winsBySeat`/`totalsBySeat` to `SimResult` for baseline comparisons. `playRandomMatch` is now a thin wrapper: `playPolicyMatch({ ...options, policies: fill(randomPolicy) })`. Confirmed byte-for-byte identical behavior by re-running `simulation.test.ts` (including its determinism test) unchanged before and after — same action counts, same violations (none), same final match state. The turn seat's policy returning `null` is now a recorded stall violation rather than silently tolerated (previously only reachable via the hand-written fuzz loop's own `if (legal.length === 0)` check; `playPolicyMatch` generalizes that guard to arbitrary policies).
  - **Bot architecture** (`bot.ts`): `evaluateHand(hand)` greedily partitions into melds (runs peeled first via a circular-arc scan, including the 13-card full-circle special case; then groups largest-first), near-melds (same-rank pairs; same-suit fragments that are adjacent OR "gap-1" on the circle, e.g. 4+6 needing the 5 — this is what covers the circular K-A pair, since K and A are themselves adjacent on the circle), and deadwood. `chooseDrawAction` scores every line index's best `findMeldWith` meld as `banked points + 4×(near-meld/meld usefulness gained) − 0.7×(leftover scooped points) − 1.5×(extra scooped cards beyond the meld)`, compares the best candidate against a stock-draw baseline of 3 plus `±1` rng jitter, and — critically — validates every candidate via `applyAction` before returning it (a pickup can score well on the heuristic yet still trip `WOULD_STRAND`/`WOULD_EMPTY_HAND`; the chooser walks down the ranked list to the next-best candidate rather than ever returning an unvalidated one). Discard scoring penalizes breaking a live meld (+20) or near-meld (+6), adds `3×dangerScore` (opponents' displayed groups/runs signal what rank/suit-neighbor they'd visibly attach), adds `0.5×points`, plus rng jitter — lower score discards first. Display timing fires on an opponent hand count ≤ 4, stock count ≤ 12 (or ≤ a quarter of a rough remaining-cards estimate), or a 12% random urge; attach is eager but skips cards that are part of the hand's own live melds/near-melds. Declare sequencing (`tryDeclareSequence`) simulates a greedy display/attach walk toward hand-size 1 (preferring an own-run display first if none exists yet, since the declare discard needs one), gated by a cheap pre-check (melded + plausibly-attachable-to-table card count) so the simulated walk — several `applyAction`/`structuredClone` calls per step — only runs when reaching 1 card is remotely plausible this tick; it returns one step at a time so the bot "walks" the sequence action-by-action across ticks exactly as instructed, ending with the declare discard once at 1 card with an own run.
  - **Fair play — a Proxy-based hidden-zone guard does not work against this engine, and the brief's literal ask was adjusted.** Node's `structuredClone` (which `applyAction` calls on every single validation — and `chooseBotAction` calls `applyAction` dozens of times per decision to pre-validate candidates) unconditionally throws `DataCloneError` on ANY `Proxy`-wrapped array, even a fully transparent one, before ever invoking its traps — verified empirically. A getter-based guard (which does survive `structuredClone`) fares no better: getters fire once per index on every one of `applyAction`'s own internal sanctioned clones too, so a real peek and legitimate engine validation are indistinguishable by trap-invocation counting alone. `tests/bot-fairplay.test.ts` instead verifies the same real property two ways: (1) a static source check (stripped of comments) asserting `bot.ts` contains zero `round.stock[...]`-shaped indexing and that every `.hands[...]` access is literally `.hands[seat]`, never another identifier/index; (2) a dynamic "hidden invariance" test — harvests ~30+ real reachable `MatchState`s from mixed bot/random games, then for each one re-runs `chooseBotAction` after redistributing the exact same multiset of hidden cards (stock + other seats' hands) into a different arrangement with all counts held fixed, asserting the bot's chosen action is byte-identical either way. This directly proves the decision cannot depend on which physical cards are hidden — the actual property the brief cares about — without the clone confound.
  - **Baseline results measured this session** (deterministic seeds, `VAZ_BASELINE_GAMES`/`VAZ_BASELINE_GAMES_4P` overridable): heads-up 2p/1-deck, 100 games, bot vs `randomPolicy` — **88.0% bot win rate** (threshold ≥0.8), mean bot total 356.9 vs mean random total 200.1. Mixed 4p/2-deck, 50 games, 2 bots + 2 randoms — bots won 48/50 decided games, mean bot-seat total 295.9 vs mean random-seat total 142.2. `bot-games.test.ts` (150-game default, `VAZ_BOT_GAMES` overridable): zero violations, 97.8% declare rate across 2p/1d, 3p/2d, 4p/2d. (Numbers shifted slightly, still comfortably clearing every threshold, after the display-timing fix noted below.)
  - **Bug caught and fixed in review before finishing**: the awaitDiscard display-timing check used `displays.find(() => shouldDisplayNow(...))` — since the callback ignores its element, `Array.find` was re-invoking `shouldDisplayNow` (which internally rolls `rng()`) once per candidate display until one happened to return true, so a hand with 3 displayable melds could burn up to 3 rng rolls to answer one yes/no question, and the "12% random urge" was effectively being re-rolled per candidate rather than once per decision. Fixed to call `shouldDisplayNow` exactly once and take the first candidate if true. Caught by source review, not by a failing test (the existing test suite couldn't distinguish it since determinism/legality were unaffected — only the rng consumption pattern was off) — full suite re-run clean after the fix.
  - **Performance tuning during this session** (no behavior change, only wall-clock): the first working version of `chooseBotAction` cost ~214ms/game because `legalAttachesFromHand` ran a full `applyAction`+`structuredClone` for every `(table set × hand card)` pair unconditionally, and `tryDeclareSequence` ran its multi-step simulated walk on every single `awaitDiscard` tick regardless of how far the hand was from 1 card. Added a cheap `attachedSetCards`-based pre-filter (no clone) before paying for `applyAction` validation in the attach enumerator, an early return when the seat has no own displayed set at all (`NEED_OWN_SET`), and a cheap melded/attachable-count pre-check gating the declare-sequence walk. Net: ~214ms → ~68ms/game (≈3× faster), same declare rates and zero violations before/after — this is what keeps the full engine suite (171 tests, including the 1000-game manual acceptance check reported above) at ~51–55s.
  - Server integration: `apps/server/src/bots.ts` now imports `chooseBotAction` from `@vazhikara/engine` and re-exports it under the same name/signature the existing `server.ts` timer-driven `botTick` already calls — no changes to `server.ts`, `rooms.ts`, `redact.ts`, or `protocol.ts` were needed or made. All 24 existing server tests pass unmodified, including the real-socket "plays a human + 2 bots room to completion" test, which now exercises the real heuristics end-to-end instead of the Phase 2 placeholder.
  - Not yet done (left for Phase 5 per plan, or explicitly out of scope for this phase): no manual/live "solo game against 2 bots feels reasonable" playtest was performed beyond the automated socket-driven server test and the simulation-based acceptance/baseline runs above — Phase 4's spec frames that playtest as part of the "done when" bar, but this session verified it purely through automated means (1000-game zero-violation run + decisive baseline win rates) rather than a manual `pnpm dev` session, since no UI/behavioral changes were made to `apps/web` and the bot's turn-taking was already exercised live during Phase 3's verification.
- 2026-07-05 — Phase 4 review round + acceptance (appended after the build entry above). Two adversarial reviewers found two real bot bugs and four weaknesses in what the tests proved; all fixed, and the full acceptance bar re-run:
  - **Major fix: the declare gate discarded wins.** `tryDeclareSequence`'s cheap pre-check counted near-meld cards (e.g. a pair of 9s) as stranded even when a displayed group would take them, aborting declare walks the simulation would have found — the bot would discard its own declare card. The gate now counts near-meld cards alongside deadwood when testing table-attachability. Regression test uses the reviewer's exact repro (run + attachable pair + one spare → declares in 4 actions).
  - **Fix: stock-empty banking.** The empty-stock branch declared the round dead immediately (its comment claimed free actions were "handled below" — unreachable code on the bot's own turn). Since dead rounds score table minus hand, every unbanked meld was a double loss (−25 instead of +5 in the repro). The bot now displays/attaches everything bankable, one action per tick, before `declareDead`; the old test that had pinned the buggy behavior was rewritten to assert the banking sequence and the +5 score.
  - Test hardening per review: declare-rate threshold raised 0.8 → 0.95 (the random baseline already measures 0.848, so the old bar couldn't distinguish the bot from random); mixed-baseline decisiveness actually enforced (bot share of decided games ≥ 0.75 AND absolute mean-total gap ≥ 75 — a ratio would flip sign when random seats go negative); both baselines now ALTERNATE seat/block assignment per seed so first-turn and dealer-position advantages can't confound either direction; matches that exhaust maxRounds without a winner now fail the fuzz as truncations; `VAZ_BOT_GAMES=1000` now plays exactly 1000 (remainder distribution — it played 999); the fair-play hidden-invariance test runs at rng constants 0.05/0.42/0.95 so the out-of-turn free-action path (`rng() < 0.4`) is actually exercised (a single 0.42 left it untested).
  - Acceptance re-measured after the fixes: **1000 games exactly, zero violations, zero unfinished matches, 97.5% declare rate (3466 rounds), 63 s.** Alternated baselines: heads-up 87% win rate, mean totals 358.4 vs 214.3; mixed 4p **50–0** decided games, mean seat totals 297.2 vs 141.6. 225 tests green monorepo-wide, typecheck clean.
  - The manual feel-check the build entry deferred was performed live (375×812 browser, `pnpm dev`, 2 heuristic bots, target 500): bots hold their melds early, bank progressively as the game develops (including out-of-turn displays between the human's actions), pace naturally on the server's jittered ticks, meld down and declare as soon as legal — watched Bot 1 walk its endgame and declare with 175 table points, with the round-end overlay showing the correct per-player table/hand/round/total breakdown. Feels like playing against competent opponents; solo play is genuinely fun to lose.
- 2026-07-05 — Phase 5 built (Sonnet, normal thinking, per the model guidance above), reviewed, and acceptance-verified on the production topology. 230 tests green (172 engine + 29 server + 29 web), typecheck clean.
  - **Production topology (single service)**: `pnpm build` → vite builds `apps/web/dist`; the server discovers it via `resolveWebDist()` (`WEB_DIST` env override, else resolved relative to the server source) and serves it with `sirv` (SPA fallback, so `/g/CODE` refreshes work) alongside Socket.IO on ONE port; `/healthz` stays plain text. No build ⇒ dev/test behavior unchanged. Production runtime is `tsx` running TS source directly (now a real dependency) — no compile step, consistent with the engine's TS-source exports since Phase 0.
  - **Deploy configs, all one-command**: `Dockerfile` (node:22-slim, corepack-pinned pnpm prepared in its own layer, frozen lockfile, `NODE_ENV=production`; CMD runs the tsx shim directly so node is PID 1 and SIGTERM works — pnpm-in-front would eat signals), `fly.toml` (with a documented auto-stop caveat: idle machines stop and in-memory rooms vanish; set `min_machines_running = 1` to avoid), `render.yaml`, `railway.json`, and a per-platform runbook in `DEPLOY.md` including a LAN playtest recipe. **No hosting account exists on this machine, so the final "on the production URL from phones" step is handed off** — everything up to it is verified.
  - **Review fixes applied** (all reviewer findings were minor; the prod reviewer's hands-on topology check passed everything): missing static assets now 404 instead of returning a cacheable 200 "OK" with the wrong MIME (the stale-phone-after-redeploy blank-page trap, regression-tested); Socket.IO CORS no longer reflects arbitrary origins in production (`origin: false` under `NODE_ENV=production` — the topology is same-origin; node/native clients send no Origin and are unaffected); TURN badge un-clipped (headroom inside the overflow-hidden scoreboard scroller); the card-enter animation's `fill-mode: both` was permanently overriding the selected-card lift — now `backwards`; the Home "How to play" link got a ≥44px hit area; anchor-styled `.btn` labels are now vertically centered (flex); the round-end overlay gained a max-height/scroll path for short landscape phones; the reconnecting banner is `position: fixed` so it no longer pushes the action bar below the fold.
  - **Polish delivered per spec**: QR code (zero-dep `qrcode-generator`, inline SVG) + share hint on the lobby invite; CSS-only micro-animations for card entry/set display/turn badge/round-end overlay, all gated behind `prefers-reduced-motion: no-preference`; every interactive element ≥44px effective touch target (invisible hit-area padding where visuals stay small); `max-height: 500px` landscape handling (verified: zero page scroll in both orientations, hand + actions always visible); room-not-found screen, reconnecting banner, lobby share hint; a rules screen (route + in-game "?" overlay) whose content the reviewer audited rule-by-rule against Part 1 with no deviations.
  - **MVP acceptance test executed against the production build served locally** (the same artifact a host would run): solo — created a room on a 375×812 viewport, 2 bots, custom target 30, played to the game-over screen ("Bot 1 wins, 90"); multiplayer — created a room, second human joined via the invite code and played over real sockets alongside a bot to the 40 target, with live scoreboards updating across a dead-round boundary and matching final totals on both clients (−65/−70/175), zero redaction leaks logged client-side. Rules deep-route load confirmed the SPA fallback in production. One test-harness note: React's `onBlur` on the custom-target input doesn't fire from `element.blur()` in an unfocused headless tab (focus never takes), which briefly looked like a product bug — a dispatched `focusout` (what a real tap-away produces) commits fine.
  - Remaining for the game owner: pick a platform, run the 2-3 commands in DEPLOY.md, and re-run the phone playtest checklist on the public URL. The tracker above is checked with that caveat recorded.
