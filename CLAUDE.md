# CLAUDE.md — Session instructions for Vazhikara Aatam

## Spec of record

**Always read [PLAN.md](./PLAN.md) in full before making any changes.** PLAN.md is the single source of truth for game rules, architecture, and build phases. It is self-contained — a fresh session with no prior context can build any phase from it alone.

## Key commands

```bash
# Install dependencies
pnpm install

# Run the full test suite (run this FIRST every session before touching code)
pnpm test

# Start all dev servers concurrently
pnpm dev

# Type-check all packages
pnpm typecheck
```

## Session protocol

1. **Run `pnpm test` before touching any code** — catch any drift from prior sessions.
2. Read PLAN.md Part 1 (game rules) carefully; this game differs from standard rummy in important ways (circular runs, mandatory meld on pickup, out-of-turn displays, per-card scoring ownership).
3. Build only the phase you were asked to build. Do not start the next phase.
4. When the phase's acceptance criteria are met and all tests pass, update the Progress tracker in PLAN.md and append to the Decisions log.

## Architecture reminders

- `packages/engine` — pure rules, zero runtime deps, all logic tested here
- `apps/server` — Node + Socket.IO, authoritative state, imports engine
- `apps/web` — React + Vite, mobile-first, imports engine for client-side hints
- Per-copy card ids (e.g. `9S#2`) — with up to 3 decks, cards need unique identity
- Out-of-turn actions are real-time — server serializes all incoming actions in arrival order
