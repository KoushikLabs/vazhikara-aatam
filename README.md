# Vazhikara Aatam

An online multiplayer version of a family rummy-style card game. Players can play solo against computer opponents or invite family members to play together from anywhere via a shareable link — no accounts required. The game features circular runs, real-time out-of-turn displays and attachments, and a mobile-first UI designed for phone play.

## Dev commands

```bash
# Install all dependencies
pnpm install

# Run all tests (across all packages)
pnpm test

# Start dev servers (engine-backed server on :3001, web on :5173)
pnpm dev

# Type-check all packages
pnpm typecheck
```

## Monorepo structure

```
packages/engine   — pure rules engine, zero runtime deps
apps/server       — Node HTTP/Socket.IO server (port 3001)
apps/web          — React + Vite frontend (port 5173)
```

See [PLAN.md](./PLAN.md) for the full game rules, architecture decisions, and build phases.
