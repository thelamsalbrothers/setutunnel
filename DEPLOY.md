# Deploying SetuTunnel

SetuTunnel is **peer-to-peer + zero-knowledge**: the file bytes flow *directly
between the two devices* and never touch your infrastructure. So hosting is
deliberately **light and vendor-neutral** — you stand up two independent pieces,
and each runs on whatever you like:

| Piece | What it is | Host it on… |
|---|---|---|
| **The app (PWA)** | Static files (HTML/JS/CSS + service worker) | **Any static host** — Netlify, Vercel, GitHub Pages, S3/CloudFront, nginx/Caddy, Cloudflare Pages… |
| **Signaling** | A featherweight WebSocket relay that only *introduces* peers (a few KB per pairing, then the socket drops — §3) | **Any WebSocket host** — the Bun server (Docker) on any box, or the Cloudflare Worker, or any Node/Deno host |
| **STUN** (NAT discovery) | Helps peers find each other | Public STUN (the default), or your own |
| **TURN** (NAT relay fallback) | Relays *ciphertext* for symmetric-NAT peers | **Bring-your-own** — self-hosted coturn, or any provider (metered.ca, Twilio, Cloudflare Calls…). Off by default. |

Nothing in the app is tied to a vendor: the client talks to **any** signaling URL
(`VITE_SIGNALING_URL`) and **any** STUN/TURN (`VITE_ICE_SERVERS`, see
[TURN](#turn--nat-relay-bring-your-own)). Two reference recipes follow —
**self-host (Docker, runs anywhere)** and **Cloudflare (managed, ~$0)** — plus how
to wire STUN/TURN. Pick either, and mix freely (e.g. Netlify for the app + your
own Bun relay).

---

## The one rule that ties it together

The app reads its signaling URL from the **build-time** env var
`VITE_SIGNALING_URL` (see [src/lib/config.ts](src/lib/config.ts)); Vite inlines it
at build. So whichever hosts you choose: **stand up signaling first, grab its
`wss://…` URL, then build the frontend with `VITE_SIGNALING_URL` set to it.** A
build without it falls back to the local-dev URL and won't connect in production.

TLS matters: an `https://` app can only reach a `wss://` (TLS) signaling URL — a
plain `ws://` is blocked as mixed content. Managed hosts give you TLS for free;
self-hosters put a reverse proxy (Caddy/nginx) or platform TLS in front.

---

## Recipe A — Self-host, runs anywhere (Docker)

No vendor account needed. The signaling server is one lean process with **zero
runtime dependencies** — it runs the pure `RoomManager` directly on Bun.

```bash
docker compose up -d               # starts the relay on :8787 (see docker-compose.yml)
# …or without Docker:
PORT=8787 bun signaling/server.ts
```

Put TLS in front so browsers reach it at `wss://your-domain` (Caddy makes this a
one-liner: `your-domain { reverse_proxy localhost:8787 }` gets automatic HTTPS).
Health check: `GET /health` → `ok`. This runs on any VPS, Fly.io, Railway, Render,
a home server, or a Raspberry Pi.

Then build and host the static app anywhere:

```bash
# bash:        VITE_SIGNALING_URL="wss://your-signaling-domain" bun run build
# PowerShell:  $env:VITE_SIGNALING_URL="wss://your-signaling-domain"; bun run build
# → serve dist/ on any static host (see "Static hosting notes" below)
```

---

## Recipe B — Cloudflare (managed, scales to zero, ~$0)

A zero-cost managed option: the app on **Pages**, signaling on a **Worker +
Durable Object**. The Worker uses a **SQLite-backed DO** (`new_sqlite_classes`),
the flavor on the Workers **free plan** — it scales to zero and costs nothing idle.

### B1 — the signaling Worker

```bash
bunx wrangler login
bun run signaling:cf:deploy        # wrangler deploy --config signaling/cloudflare/wrangler.toml
curl https://setutunnel-signaling.<your-subdomain>.workers.dev/health   # -> ok
```

Your signaling URL is `wss://setutunnel-signaling.<your-subdomain>.workers.dev`.
Local dev without deploying: `bun run signaling:cf:dev` (workerd on :8788).

### B2 — the app on Pages

**Direct upload** (no Git):

```bash
# PowerShell:
$env:VITE_SIGNALING_URL="wss://setutunnel-signaling.<your-subdomain>.workers.dev"; bun run build
bun run pages:deploy               # creates the "setutunnel" project → https://setutunnel.pages.dev
```

**Git-connected** (auto-build on push): dashboard → *Workers & Pages → Create →
Pages → Connect to Git*, then Framework **Vite**, build **`bun run build`**, output
**`dist`**, env **`VITE_SIGNALING_URL`** = your `wss://…` URL (add `BUN_VERSION` if
Bun isn't auto-detected from `bun.lock`).

> **Pages ≠ Worker.** Connecting the repo to Pages builds only the *frontend*. The
> signaling Worker is a **separate** deploy (`bun run signaling:cf:deploy`, once —
> it rarely changes). To also deploy it from Git, connect the repo a second time
> as a **Worker** (Workers Builds, root `signaling/cloudflare`) or add a GitHub
> Action with [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action).

Optional: lock the Worker to your origin(s) with `ALLOWED_ORIGINS` (uncomment
`[vars]` in `wrangler.toml`) so third parties can't use your relay.

---

## TURN — NAT relay (bring-your-own)

Most connections succeed with STUN (direct P2P). Peers behind **symmetric NATs**
(some corporate/mobile networks) can't, and need a **TURN** relay. TURN forwards
only **ciphertext** — it cannot read the transfer (§4.1/§5) — but it uses
bandwidth, so it's **off by default** and always **bring-your-own**: you never pay
for anyone else's relay, and there's no vendor lock-in.

There are two ways to give the app TURN credentials. **For a public deployment,
use the ephemeral endpoint** (recommended) — static credentials baked into a
static build are world-readable, which lets strangers use your relay.

### Recommended — ephemeral credentials (§5)

The signaling server mints a **short-lived** credential per session; the relay
secret never leaves the server. It's the coturn "TURN REST API" scheme
([src/signaling/turn.ts](src/signaling/turn.ts)) and works with self-hosted coturn
and any provider that supports it.

1. **On the signaling server**, set (these stay server-side, never shipped):
   - `TURN_URLS` = `turn:turn.your-domain:3478,turns:turn.your-domain:5349`
   - `TURN_SECRET` = the same string as coturn's `static-auth-secret`
   - `TURN_TTL` (optional) = credential lifetime in seconds (default 24h)

   Self-host (Bun/Docker): set them in the `signaling` service env (see
   `docker-compose.yml`). Cloudflare Worker: `TURN_URLS`/`TURN_TTL` as `[vars]`,
   and the secret via `bunx wrangler secret put TURN_SECRET`.
   Verify: `curl https://your-signaling-host/turn` → JSON with `username`/`credential`.

2. **On the app** (build-time), point it at that endpoint:
   - `VITE_TURN_ENDPOINT` = `https://your-signaling-host/turn`

   The client fetches a fresh credential before each connection and **fails soft**
   to STUN-only if the endpoint is down — a TURN outage never blocks pairing.

### Simple — static credentials (private instances)

Fine for a private/self-hosted instance. Set at build time (in your host's
build-env, or a gitignored `.env.production.local` — Vite loads `VITE_*`):

```bash
# A STUN list + one TURN server
VITE_STUN_URLS="stun:stun.l.google.com:19302"
VITE_TURN_URLS="turn:turn.your-domain:3478,turns:turn.your-domain:5349"
VITE_TURN_USERNAME="…"
VITE_TURN_CREDENTIAL="…"

# …or full control (multiple servers, any provider shape):
VITE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.your-domain:3478"],"username":"…","credential":"…"}]'
```

### Where to get a TURN server (all vendor-neutral)

- **Self-host coturn** — your own, independent of any provider:
  `docker compose --profile turn up -d` (edit
  [infra/coturn/turnserver.conf](infra/coturn/turnserver.conf) first — realm,
  `external-ip`, and a strong `static-auth-secret` that matches `TURN_SECRET`
  above — and open UDP 3478 + the relay port range on your firewall).
- **A managed provider** — metered.ca, Twilio, Cloudflare Calls, etc. Use their
  credentials via the static env, or their REST endpoint via `VITE_TURN_ENDPOINT`.

---

## Static hosting notes (any host)

The app is a single-page PWA and its pairing links are **path routes**
(`/r/<roomId>#<secret>`), so every deep link must fall back to `index.html`:

- **Cloudflare Pages / Netlify:** [`public/_redirects`](public/_redirects) →
  `/* /index.html 200` (already included; both read this file).
- **Vercel:** a `vercel.json` with a catch-all rewrite to `/index.html`.
- **nginx:** `try_files $uri /index.html;`
- **Caddy:** `try_files {path} /index.html`
- **GitHub Pages:** copy `dist/index.html` to `dist/404.html` after building.

Serve over **HTTPS** — required for the service worker, camera/QR, and `wss://`.

---

## Why this stays cheap and portable

- **No file ever touches a server** — the transfer is direct P2P, E2E-encrypted.
- **Signaling carries only tiny introductions**, and the socket drops the moment
  the P2P link is up (§3) — minimal CPU/bandwidth wherever it runs.
- **The app is static** — free/cheap on any host, cache-friendly, offline-capable.
- **No vendor lock-in** — signaling and STUN/TURN are all URLs/config; swap them
  without touching code.
