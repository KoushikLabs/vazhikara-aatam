# Deploying Vazhikara Aatam

One Node process serves everything: the built React frontend (static files)
and the Socket.IO game server, on a single port. There is no database and no
second service to stand up.

**Runtime shape**: `pnpm build` builds `apps/web` to `apps/web/dist`. `pnpm start`
runs `apps/server` with [tsx](https://github.com/privatenumber/tsx), which
executes the server's TypeScript source directly (the engine package ships TS
source with no compile step — see the Decisions log in PLAN.md for why this is
the pragmatic family-scale choice). The server looks for `apps/web/dist` next
to itself at boot; if it's there, it's served at `/` with SPA fallback
(`/g/ABC123` on a hard refresh still returns `index.html`), Socket.IO shares
the same port at `/socket.io`, and `/healthz` always responds `OK`.

Every platform below runs the same three commands:

```
install → pnpm build → pnpm start
```

---

## Fly.io

1. Create a free Fly.io account at https://fly.io, then install the CLI:
   ```
   curl -L https://fly.io/install.sh | sh
   flyctl auth login
   ```
2. From the repo root, adopt the checked-in `fly.toml` (rename the app if the
   placeholder name is taken) and deploy:
   ```
   flyctl launch --no-deploy   # detects fly.toml, offers to create the app + volume-less Postgres (decline)
   flyctl deploy
   ```
3. Fly builds the checked-in `Dockerfile`, which runs `pnpm install --frozen-lockfile && pnpm build`
   then starts the server. `fly.toml` sets `internal_port = 3001`, `force_https = true`,
   and a `/healthz` HTTP check.
4. `flyctl open` once it's green.

> **Note on idle auto-stop:** `fly.toml` uses `auto_stop_machines = "stop"` with
> `min_machines_running = 0` (free-tier friendly). Active websocket connections
> keep the machine alive, so games in progress are safe — but once everyone
> disconnects, the machine stops and **all in-memory rooms vanish immediately**
> (sooner than the 30-minute room TTL). A returning player's link falls back to
> the join screen gracefully. If you want rooms to survive short idle gaps, set
> `min_machines_running = 1`.

## Render

1. Create a free Render account at https://render.com and connect the GitHub repo.
2. Render auto-detects `render.yaml` (Blueprint) at the repo root — click
   "New +" → "Blueprint" and point it at the repo, or `New +` → `Web Service`
   and Render will still pick up the file's `buildCommand`/`startCommand`.
3. `render.yaml` already sets: `buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build`,
   `startCommand: pnpm start`, `healthCheckPath: /healthz`, `NODE_ENV=production`.
   Render provides `PORT` automatically; the server already reads it from env.
4. First deploy takes a few minutes (full monorepo install + web build). Free-tier
   services sleep after inactivity — the first request after a nap is slow.

## Railway

1. Create a free Railway account at https://railway.app and install the CLI:
   ```
   npm install -g @railway/cli
   railway login
   ```
2. From the repo root:
   ```
   railway init          # create/link a project
   railway up             # builds via the checked-in Dockerfile (railway.json points at it)
   ```
3. `railway.json` sets the Dockerfile build path and a `/healthz` healthcheck.
   Railway assigns `PORT` automatically. Add a public domain from the Railway
   dashboard (Settings → Networking → Generate Domain) once it's deployed.

---

## LAN playtest (no hosting account needed)

To play with people on the same wifi network before deploying anywhere:

```bash
# Terminal 1 — server (binds all interfaces by default)
PATH="$HOME/Library/pnpm:$PATH" pnpm --dir apps/server dev

# Terminal 2 — web, exposed to the LAN
PATH="$HOME/Library/pnpm:$PATH" pnpm --dir apps/web exec vite --host
```

Vite prints a `Network:` URL (e.g. `http://192.168.1.23:5173/`) — open that on
any phone/laptop connected to the same wifi. The dev-mode web client proxies
`/socket.io` to `localhost:3001` for the machine you're on, but a phone needs
the server reachable too: either also visit the printed network URL (which
still proxies through that same machine's Vite dev server, so this just
works), or set `VITE_SERVER_URL` if you split the two apps across hosts.

Find your machine's LAN IP directly with `ipconfig getifaddr en0` (macOS
wifi) if Vite doesn't print one.

## Local production smoke test

Before deploying, verify the exact production flow locally:

```bash
PATH="$HOME/Library/pnpm:$PATH" pnpm build
PORT=3010 PATH="$HOME/Library/pnpm:$PATH" pnpm start
# in another terminal:
curl http://localhost:3010/healthz          # -> OK
curl http://localhost:3010/                 # -> built index.html
curl http://localhost:3010/g/SOMECODE       # -> index.html (SPA fallback)
curl "http://localhost:3010/socket.io/?EIO=4&transport=polling"  # -> engine.io handshake JSON
```
