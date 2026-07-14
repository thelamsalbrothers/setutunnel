# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use **Bun**, never npm/pnpm (`bun.lock` is the lockfile).

- `bun install` — install dependencies.
- `bun run dev` — Vite dev server with HMR.
- `bun run build` — typechecks (`tsc -b`) **then** builds (`vite build`).
- `bun run typecheck` — `tsc -b --noEmit`, strict.
- `bun run test` — Vitest (watch). `bun run test:run` for a single CI pass.
  - Run one file: `bun run test:run src/crypto/aead.test.ts`. One test: add `-t "<name>"`.
- `bun run test:e2e` — Playwright (real two-context browser transfers through the actual UI). Needs Chromium once: `bunx playwright install chromium`. Auto-starts the Vite + Bun-signaling servers.
- `bun run lint` — Oxlint (`.oxlintrc.json`, plugins `react`/`typescript`/`oxc`). Type-aware rules are **off**; §9 covers enabling `oxlint-tsgolint`.
- `bun run format` — Biome (`biome check --write`: formats **and** sorts imports/exports; its own linter is off, so Oxlint stays the linter). `format:check` verifies without writing.
- `bun run dev:signaling` — the self-host Bun signaling server (needed for a live transfer in `bun run dev`).
- `bun run signaling:cf:dev` — the **Cloudflare Worker** signaling in local `workerd` (same wire protocol; health on `/health`, WS on `:8788`). `bun run signaling:cf:deploy` ships it (`wrangler`). See [DEPLOY.md](DEPLOY.md).
- `bun run pages:deploy` — upload `dist/` to Cloudflare Pages (build first with `VITE_SIGNALING_URL` set). Full recipe in [DEPLOY.md](DEPLOY.md).
- `bun run preview` — serve the production build locally.

## Before you change anything

- **The app is functional end to end.** All layers are built + verified: **`src/crypto/`** (A), **`src/protocol/`** (B), **`src/transport/`** (C/D/E + real `webrtc`), **`src/signaling/`** (+ Bun server, CF Worker, ephemeral-TURN `/turn`), **`src/connection/`** (`connect()` orchestrator), and the **UI** (`src/App.tsx` + `src/components/` + `src/lib/transfer.ts` controller). **12 Playwright E2Es pass** — 10 real two-context transfers through the UI (raw DataChannel, single-file direct download, multi-file → one zip, a folder → structured zip, a **large single file streamed to disk** and **multi-file streamed to disk as one zip** via File System Access, a **short-code (SPAKE2) pairing**, a **tier-2 service-worker streamed download** with FSA forced off, a text snippet, a render check) **plus 2 automated `@axe-core/playwright` accessibility scans** (send home dark+light, receive-by-code — `color-contrast` enforced). Feature-complete: **both pairing modes, multi-file, folder+zip, text sharing, installable PWA, vendor-neutral hosting (Docker + CF), BYO + ephemeral TURN, streaming disk-write on every browser (§6E tiers 1+2), graceful teardown, and a shadcn UI (OS-default theme)** all done and verified. What's genuinely left is v2 polish (resumable transfers, §6E tier 3 OPFS, Web Share Target, i18n) — see §0 "Still to build".
- **Security is not optional.** Read §4 before touching anything crypto / key-schedule / signaling. Per §9: no secret (`S`, a `CryptoKey`, or plaintext) may ever reach the server; **fail closed** on any crypto/verification error; a crypto change needs a PR threat-model note *and* golden vectors.
- **React 19 + Compiler auto-memoizes** — don't hand-write `useMemo`/`useCallback`/`memo` for performance unless profiling proves a need (§0, §9).

The rest of this file is the detailed working spec. Keep it accurate as the code grows — when reality and this doc disagree, fix one of them in the same change.

---

# SetuTunnel — Web App (`setutunnel-web`)

> **Two devices. One private tunnel. Zero trace.**

This is the **PWA client** for **SetuTunnel** (सेतु — "bridge"): an open-source, local-first, serverless-first app for high-speed, **End-to-End Encrypted (E2EE)** file sharing directly between two devices. A tiny stateless signaling service only *introduces* the peers; every real byte flows **directly, peer-to-peer** over an encrypted WebRTC DataChannel and is destroyed the instant the transfer completes. No accounts, no cloud uploads, no files at rest on any server.

> This file is the working spec for the client. Keep it accurate as the code grows — when reality and this doc disagree, fix one of them in the same change.

---

## 0. Current Scaffold — what actually exists today

Scaffolded with `bun create vite` (React + TypeScript template, Oxc-powered). **This is currently a single web app, not yet the full monorepo.**

**Installed & wired up:**
| Concern | Tool | Version | Notes |
|---|---|---|---|
| Package manager + runtime | **Bun** | — | `bun.lock` present. Not npm/pnpm. |
| Build / dev server | **Vite** | ^8.1 | Rolldown-based under the hood. |
| UI framework | **React + React DOM** | ^19.2 | |
| React Compiler | `babel-plugin-react-compiler` | ^1.0 | Enabled via `@rolldown/plugin-babel` + `reactCompilerPreset` in `vite.config.ts`. Auto-memoizes — **don't hand-write `useMemo`/`useCallback` for perf** unless profiling says so. |
| React plugin | `@vitejs/plugin-react` | ^6.0 | Oxc-powered transform. |
| Styling | **Tailwind CSS** | ^4.3 | Via `@tailwindcss/vite` plugin (no PostCSS config; import in CSS). |
| Animation | `motion` | ^12.42 | (Framer Motion successor.) |
| Language | **TypeScript** | ~6.0 | `tsconfig.{json,app,node}.json` split; `strict: true` on. |
| Linter | **Oxlint** | ^1.71 | `.oxlintrc.json`; plugins `react`, `typescript`, `oxc`. |
| Formatter | **Biome** | 2.5.3 | `biome.json`; `biome check` = format + import/export sorting, **linter disabled** (Oxlint stays the linter). Interim until Oxc `oxfmt`. |
| Unit tests | **Vitest** | ^3.2 | `vitest.config.ts` (node env). |
| Crypto | **@noble/curves · @noble/hashes** | ^1.9 · ^1.8 | X25519 + streaming SHA-256 only; Web Crypto does AES-GCM/HKDF/one-shot SHA-256. |

**Scripts (`package.json`):** `dev` · `build` (`tsc -b && vite build`) · `typecheck` (app + `signaling/tsconfig.json` + `e2e/tsconfig.json`) · `test` / `test:run` (Vitest) · `test:e2e` (Playwright) · `lint` (oxlint) · `format` / `format:check` (biome, over `src` + `signaling` + `scripts` + `e2e` + `playwright.config.ts`) · `dev:signaling` (bun signaling server) · `signaling:smoke` / `signaling:client-smoke` (headless server + client tests) · `signaling:cf:dev` / `signaling:cf:deploy` (Cloudflare Worker signaling — local `workerd` / deploy) · `pages:deploy` (Cloudflare Pages upload) · `preview`.

**Source layout:** `index.html` (theme-init script) → `src/main.tsx` → `src/App.tsx` (the real UI) + `src/index.css` (Tailwind). Pure, framework-agnostic engine modules (colocated `*.test.ts`) sit under `src/`:
- **`src/crypto/`** (Module A, §6): `bytes`, `keypair` (X25519), `hkdf`, `session`, `aead`, `sas`, `hash`, `envelope` (signaling-envelope AES-GCM keyed from S, §4.3), barrel `index.ts`. `scripts/gen-crypto-vectors.ts` regenerates the locked known-answer vectors.
- **`src/protocol/`** (Module B, §6): `constants`, `messages` (wire types), `manifest` (validation + §4.7 content-safety), `machine` (transfer state machine), `pairing` (Link/QR secret), barrel `index.ts`.
- **`src/transport/`** (Modules C/D/E data-plane, §6): `frame` (encrypted-frame header + AAD context), `channel` (`DataChannelLike`), `backpressure` (bufferedAmount gating), `sender` (streaming read → encrypt → send), `receiver` (decrypt → validate → reassemble → streaming hash), `link` (`TransportLink` — full-duplex), `memory` (in-RAM source/sink), `webrtc` (`createWebRtcConnector` — the real `RTCPeerConnection`/`RTCDataChannel` binding to `PeerConnector`/`DuplexChannel`; browser-only, verified by the E2E), barrel `index.ts`. The pure parts depend only on `DataChannelLike`, so `loopback.test.ts` (Sender→Receiver) and `link.test.ts` (both-peers-at-once) run without real WebRTC.
- **`src/signaling/`** (§3, §5): `protocol` (wire messages + `parseClientMessage` validator), `rooms` (`RoomManager` — pure 1-to-1 matching/relay/TTL, server sees no plaintext), `client` (browser `SignalingClient` — DOM `WebSocket` wrapper), barrel `index.ts`. protocol/rooms are IO-free and shared with the server; `client` is browser-only.

- **`src/connection/`** (§3 — the handshake orchestrator): `types` (`PeerConnector`, `DuplexChannel`, `SignalingChannel`, `SessionDescription`), `handshake` (SDP+X25519-pubkey codec), `orchestrator` (`connect()` — drives envelope exchange → `deriveSession` → open channel → `TransportLink`), barrel `index.ts`. Depends only on the abstractions, so the whole handshake is tested headlessly with fakes + real crypto (`orchestrator.test.ts`: two peers → matching SAS + bidirectional transfer).
- **UI (Module F):** `src/App.tsx` (routes sender vs receiver by URL — a pairing link in the path/hash ⇒ receiver), `src/components/` (aurora bg, glass card, DropZone, PairingPanel = QR+link, SasBadge, ConsentCard = §4.7 gate + risky-file second-confirm, TransferProgress, theme toggle, icons), `src/hooks/` (theme, `useSyncExternalStore` binding), `src/lib/` (`transfer.ts` = the `TransferController` wrapping `connect()` for both roles; `file-source.ts` streams a `File` via `slice()`; qr/format/download/config helpers). Tailwind v4 (class-based dark mode via `@custom-variant` in `index.css`), `motion` for transitions, `qrcode` for QR. Light/dark + responsive.

Outside `src/` (Bun runtime, **not** in the Vite build; typechecked via `signaling/tsconfig.json` with `@types/bun`): **`signaling/server.ts`** (self-host WebSocket server via `Bun.serve`, wraps `RoomManager`), verified headlessly by **`signaling/smoke.ts`** (`bun run signaling:smoke`) and **`signaling/client-smoke.ts`** (`bun run signaling:client-smoke` — exercises the real `SignalingClient` against the server). **`signaling/cloudflare/`** holds the Cloudflare primary — `worker.ts` (Worker + `SignalingRoom` DO over the shared `RoomManager`), `wrangler.toml`, and its own `tsconfig.json` with `@cloudflare/workers-types` (excluded from `signaling/tsconfig.json` so Bun and Worker types don't collide; typechecked as its own project in `bun run typecheck`). `public/` has `favicon.svg`, `icons.svg`, and **`_redirects`** (Pages SPA fallback for pairing deep links).

**Not here yet — the real work (see Roadmap §10):**
- **Module A (crypto) — DONE (v0 core):** X25519 key agreement, HKDF-SHA256 schedule, direction-separated AES-256-GCM chunks (nonce+AAD discipline), SAS, streaming hash, and the **signaling-envelope** cipher (`deriveEnvelopeKey`/`encryptEnvelope`/`decryptEnvelope` — keyed from S, anti-reflection AAD, §4.3) — all with golden/behavioral vectors (RFC 7748 + independent HKDF cross-check + AEAD/SAS known-answer + A/B session agreement + envelope tamper/reflection). Public API: `deriveSession`, `encryptChunk`, `decryptChunk`, `computeSAS`, `generateKeyPair`, `computeSharedSecret`, `createFileHasher`, `deriveEnvelopeKey`, `encrypt/decryptEnvelope`.
- **Module B (protocol) — DONE (v0 core):** typed wire messages, manifest validation + §4.7 content-safety (`sanitizePath` for traversal/zip-slip, `assessFile` risky-type detection, `validateManifest` caps — all fail-closed), the transfer state machine (`reduce`, pure typed reducer), and Link/QR `pairing` (secret `S` in the hash fragment only, never the server). Tested incl. traversal/zip-slip, disguised double-extensions, and the "S never leaves the fragment" invariant.
- **Modules C/D/E data-plane — DONE (v0 core):** every DataChannel message (control + data) is app-layer AES-GCM framed with a monotonic per-direction `seq` = nonce counter; `sendWithBackpressure` gates on `bufferedAmount`; the `Receiver` enforces monotonic seq (gap ⇒ fail closed), reassembles, and streams SHA-256 for the whole-file check. All composes over Module A **without changing its golden-vector'd AAD** (transport passes `transferId ‖ version ‖ frameType` as the primitive's `transferId`). The `loopback.test.ts` transfers a 200 KiB / 4-chunk file with real keys and asserts byte-exact reassembly + hash, plus tamper/reorder/zero-length rejection. **`TransportLink` makes it full-duplex** — a DataChannel is bidirectional and the session's send/recv directions are cryptographically independent (separate key + direction id + nonce space), so both peers can transfer at once; `link.test.ts` proves a simultaneous both-ways transfer and direction isolation. **Nonce-safety invariant:** each direction has a *single* nonce authority — the one `Sender` allocates its `seq` **atomically before any await** — so overlapping sends can never reuse a `(key, nonce)` pair; never construct a second `Sender` on the same direction.
- **Signaling plane — DONE (v0 self-host):** shared wire protocol + fail-closed `parseClientMessage`, the pure `RoomManager` (1-to-1 create/join/relay/leave + TTL GC, zero-knowledge — routes opaque blobs only), a `Bun.serve` WebSocket server, and the browser `SignalingClient`. Unit-tested (Vitest) *and* verified end-to-end headlessly: `signaling/smoke.ts` (raw WS peers) and `signaling/client-smoke.ts` (the real `SignalingClient` against the server).
- **Cloudflare Worker + Durable Object signaling — DONE (primary, §5):** `signaling/cloudflare/worker.ts` — the serverless primary. **Design decision:** because the wire protocol carries the `roomId` inside the `create`/`join` message (not the URL), a **single coordinator DO** runs the *exact same shared `RoomManager`* — a true drop-in that reuses the tested pure core and needs **zero** client/protocol change (sharding to one-DO-per-room, the §5 mega-scale ideal, would need roomId-in-URL routing and is a future step; a single DO's throughput is ample for a 1-to-1 tool). Zero-knowledge preserved: the DO only relays opaque envelopes; storage holds nothing but a GC alarm. **Free-tier:** `wrangler.toml` uses `new_sqlite_classes` (SQLite-backed DO — the flavor on the Workers **free plan**), scales to zero. **Verified in real `workerd`** (`bun run signaling:cf:dev`): full create → join → peer-joined → bidirectional relay → fail-closed `bad-message` → `peer-left` on disconnect. Deploy via `bun run signaling:cf:deploy`; the whole free-hosting recipe (Worker + Pages + `public/_redirects` SPA fallback + `VITE_SIGNALING_URL` wiring) is in **[DEPLOY.md](DEPLOY.md)**.
- **Connection orchestrator — DONE (v0 core):** `connect()` runs the whole handshake — envelope exchange (SDP + X25519 pubkey, encrypted with the key from S) → `deriveSession` → ready `TransportLink` — over the `PeerConnector`/`SignalingChannel` abstractions. Verified headlessly (`orchestrator.test.ts`): two peers derive the **same SAS** and transfer files both ways with real crypto; a mismatched S fails closed. Also hardened `TransportLink` to **serialize incoming frames** (`whenIdle()`), since a live DataChannel can fire `message` mid-decrypt and the `Receiver` requires strict order.
- **WebRTC binding + end-to-end browser transfer — DONE (v0 core):** `createWebRtcConnector` implements `PeerConnector` over a real `RTCPeerConnection`/`RTCDataChannel` (non-trickle ICE; buffered `onMessage`). **Playwright** (`e2e/`, `bun run test:e2e`) starts the Vite + Bun-signaling servers and drives **two Chromium contexts through a real encrypted DataChannel transfer** — pair → WebRTC → session/SAS → stream → the receiver's decrypted bytes **hash-match** the sender's, with **matching SAS**. This is the whole §3/§4 pipeline proven in a real browser.
- **UI (Module F) + full app — DONE (v0):** the whole flow works and is Playwright-verified through the real interface (`e2e/ui.spec.ts`): sender drops a file → shares a QR/link → receiver opens it → sees the SAS + consents (risky-type second-confirm) → the file streams over the encrypted DataChannel and downloads, byte-identical, with matching SAS on both ends. `TransferController` (`src/lib/transfer.ts`) is the single wiring point. **Gotcha baked into the code:** the sender must NOT close its `RTCPeerConnection` when `sendFile` resolves — that only means frames are *buffered*, not delivered; closing early drops the in-flight tail. It closes on navigation instead.
- **Multi-file — DONE:** the sender announces all files in one manifest, then streams them back-to-back over the one link; the receiver **delimits files by counting `isFinal` frames** (no wire-format change) and downloads each. UI: multi-select DropZone, `FileList` in consent, "file X of Y" progress. `e2e/ui.spec.ts` sends 3 files and asserts each downloads byte-identical. **Gotcha fixed here:** the transport `Receiver` now **resets its per-file hasher after each `isFinal`** — otherwise `@noble/hashes` throws "digest() already called" on the 2nd file (and `sha256Hex` becomes per-file, which is what you want).
- **Hardening pass (done):** an adversarial review + fixes. **Receiver now validates the incoming manifest** (`validateManifest` — caps + `sanitizePath`, fail-closed) and checks each file's byte count against the manifest — the sender is untrusted (§4.7), so this can't be sender-only. **Disconnect detection:** the WebRTC binding watches `connectionstatechange` and a `failed` connection surfaces as a clean error instead of a frozen progress bar. **Double-accept guard** (idempotent `accept()` + sender `sending` flag + disabled consent buttons) so a duplicate accept can't spawn interleaved send loops. Signaling uses **`wss://` on https** pages.
- **PWA — DONE:** `vite-plugin-pwa` (Workbox `generateSW`, `registerType: autoUpdate`, `devOptions.enabled: false` so the SW never interferes with dev/E2E). `vite.config.ts` holds the web-app manifest (name, `standalone`, theme/bg color, maskable icons); `scripts/gen-pwa-icons.ts` rasterizes `public/pwa-icon.svg` → `pwa-{192,512}.png` + `apple-touch-icon.png` via `sharp`. `useInstallPrompt` + an "Install" button surface the Chromium install flow. `bun run build` emits `sw.js` + `manifest.webmanifest` (build-verified). Also: `MotionConfig reducedMotion="user"` + `motion-reduce:animate-none` for accessibility, and a Cancel action on the long-running states.
- **Text/clipboard sharing — DONE:** a Files/Text toggle on the home screen; a pasted snippet is sent as a `text/plain` file with the manifest flagged `kind: 'text'` (optional field on `ManifestMessage`), and the receiver **decodes it and shows it inline with a Copy button** instead of downloading. `e2e/ui.spec.ts` round-trips a multi-line snippet with emoji. (No wire-protocol churn beyond the one optional `kind` field.)
- **Folder transfer + receive-as-zip — DONE:** the receiver accumulates all files, then **1 file → direct download, 2+ files → one `.zip`** (`fflate`) — this both preserves folder structure and fixes the browser blocking N separate downloads. Sender uses `file.webkitRelativePath` so paths survive; DropZone has a `webkitdirectory` "send a whole folder" affordance (the attribute is set via ref since it's not in the React types). `e2e/ui.spec.ts` covers single-file (direct), multi-file (unzip + byte-verify each), and a folder (asserts `sub/inner.txt` structure survives).
- **Vendor-neutral hosting + BYO TURN — DONE:** the client speaks to *any* signaling host (`VITE_SIGNALING_URL`) and *any* STUN/TURN — `src/lib/ice.ts` (`resolveIceServers`, unit-tested) resolves `VITE_ICE_SERVERS` (JSON) or `VITE_STUN_URLS`/`VITE_TURN_URLS`+creds, default public-STUN-only. Self-host is first-class: `signaling/Dockerfile` + root `docker-compose.yml` run the Bun relay anywhere, and `infra/coturn/turnserver.conf` + the compose `turn` profile give a self-hosted TURN template. So symmetric-NAT peers *can* connect once a TURN is configured.
- **Ephemeral TURN credentials — DONE (§5):** the coturn "TURN REST API" scheme — `src/signaling/turn.ts` (`mintTurnCredential` = base64(HMAC-SHA1(secret, `<expiry>`)) via `crypto.subtle`; `buildTurnPayload`) mints a **short-lived** credential per request from a server-side secret matching coturn's `static-auth-secret`. Exposed as `GET /turn` on **both** signaling servers (`signaling/server.ts` + `signaling/cloudflare/worker.ts`, with CORS; 404 when unconfigured), enabled by `TURN_URLS`+`TURN_SECRET`(+`TURN_TTL`). The client fetches a fresh cred (`loadIceServers`, opt-in via `VITE_TURN_ENDPOINT`) before each connection and **fails soft to STUN-only**. So a public build ships **no** long-lived relay secret. Golden-vector unit-tested (independent Node-HMAC cross-check) **and** verified live on both runtimes (Bun + real `workerd`): `/turn` returns a real minted credential, `/turn` 404s unconfigured.
- **Streaming disk-write — DONE (§6E tier 1, single-file AND multi-file):** a large receive on a File-System-Access-capable browser (Chromium desktop) streams decrypted chunks **straight to disk**, so receiver memory stays flat regardless of size (no more RAM-bound multi-GB receive). `src/lib/file-sink.ts`: `FsaFileSink` (over `FileSystemWritableFileStream`) for a single file; **`ZipStreamWriter`** streams a **multi-file/folder** archive to disk as files arrive (fflate store-mode `Zip` → sink, backpressured, per-file `startFile`/`endFile`) — folders are flat-memory too. Capability + size-threshold gated (`resolveStreamThreshold`, default 256 MiB, overridable via `VITE_STREAM_THRESHOLD_BYTES` or `localStorage['setu:streamThreshold']`). The receiver (`transfer.ts`) picks the sink inside the Accept **user gesture** (`beginAccept` → 'file' or 'zip' `streamMode`), routes chunks via `consumeChunk`, validates each file's byte count (`streamedCountOk`), advances zip entries on each `isFinal` (`advanceStreamedZip` — its sync prefix `endFile`→`startFile` runs before the next file's first chunk because the receiver serializes frames), and closes/finishes at the end; any failure `abort()`s so no partial output is left (fail-closed). Small transfers and text keep the in-RAM Blob path; non-FSA browsers fall back — **never a dead end**. Unit-tested (`file-sink.test.ts`, incl. streaming-zip round-trip) **and** Playwright-verified: single file **and** multi-file both stream to a stubbed disk **byte-identical**.
- **Graceful teardown — DONE (§6B):** `useTeardownOnUnload` (SendFlow + ReceiveFlow) fires `controller.dispose()` on `pagehide`/`beforeunload`, which closes the peer connection, `abort()`s any in-flight streamed file, and **zeroizes the pairing secret S** + drops plaintext buffers (§4.6). Idempotent; deliberately does **not** dispose on React unmount so a dev StrictMode remount can't tear down a live transfer. (`connectionstatechange`→`failed` was already handled.)
- **PAKE short-code mode — DONE (§4.3):** the full "read a code aloud" pairing. Crypto: `src/crypto/spake2.ts` (SPAKE2 over ristretto255, golden-vector + behavioral tested). Orchestrator: `connect({ pakeCode })` runs one relayed SPAKE2 round → S (two headless two-peer tests incl. wrong-code-fails-closed), threat-model note in §4.3. Code format: `src/protocol/shortcode.ts` — `<nameplate>-<word>-<word>` (e.g. `742-otter-anvil`) where the **nameplate → opaque roomId** and the **words → SPAKE2 password**; the password never feeds the roomId (or it'd be offline-guessable — unit-tested invariant). Controller: `startSend(files, 'code')` / `startReceiveWithCode(code)`; snapshot carries `pairingMode` + `code`. UI: a **Link/QR ↔ Short code** toggle on the sender (`CodePanel` shows the code), a **"Have a code? Receive"** entry → `CodeEntry` on the receiver, and an **out-of-band SAS-compare hint** in code mode (no link to auto-trust). **Playwright-verified** (`ui.spec.ts`): sender shows a code → receiver types it → SPAKE2 → **matching SAS** → byte-identical transfer.
- **UI — shadcn design system:** the interface uses shadcn-style **semantic tokens** (`background`/`foreground`/`card`/`muted`/`muted-foreground`/`primary`/`secondary`/`border`/`input`/`ring` + `--radius`, CSS vars that flip on `.dark`) in `src/index.css` — neutral zinc base, flat bordered cards, a single **violet primary** accent used only on primary actions/rings/logo/progress. Theme **follows the OS by default** (`index.html` pre-paint + `useTheme` live-syncs until an explicit toggle is saved). The logo is a glyph-only **tunnel mark** (mouth + inner arch), consistent across header, favicon (transparent violet), and the PWA/app icons (solid-violet tile).
- **Accessibility + polish — DONE:** an automated **axe-core** scan (`e2e/a11y.spec.ts`, `@axe-core/playwright`) asserts **zero serious/critical WCAG 2.x A/AA violations** on the send home (dark **and** light) and the receive-by-code screen — **including `color-contrast`, now fully enforced** (the redesign dropped `backdrop-filter`, so axe can resolve the opaque panels; the light `muted-foreground` token was nudged slightly darker to clear AA on tinted surfaces). Also: scheme-aware `theme-color` + Open Graph/Twitter social meta in `index.html`, a **live document title** per phase (`useDocumentTitle`), and reduced-motion respected (CSS `prefers-reduced-motion` + `MotionConfig`).
- **Hardening (adversarial-review follow-up):** a background bug-hunt cleared the crypto/transport (SPAKE2 math, nonce discipline, envelope anti-reflection, relay ordering, zip-boundary sequencing all verified). Fixes landed: the receiver **rejects a duplicate/late `manifest`** (only valid while `connecting`, §4.7); `connect()` gets its **own copy of S** so teardown's zeroize can't corrupt an in-flight handshake (§4.6); **`connect()` now zeroizes the short-code (SPAKE2-derived) S** after `deriveSession` (it never surfaces to the controller), closing the last zeroize gap; and **`sendWithBackpressure` rejects a parked drain-wait if the channel closes/errors** (widened `DataChannelLike` with `close`/`error`, new test) so a stuck send unwinds instead of hanging.
- **§6E tier 2 — DONE (service-worker streamed download):** browsers without File System Access (Firefox/Safari) now get **flat-memory** large receives too. `public/dl/sw.js` (its own `/dl/` scope — never touches the Workbox SW) + `src/lib/sw-download.ts`: the receiver transfers a `ReadableStream` to the worker and kicks a hidden-iframe navigation the worker answers with a streaming attachment, so the browser's native downloader writes to disk incrementally; backpressure flows through the transferred stream (`writer.ready`). Capability ladder in `file-sink.ts` (`streamToDiskAvailable`, `openStreamSink`): **FSA (tier 1) → SW stream (tier 2) → in-RAM Blob (tier 4)**; works for single files *and* the multi-file `ZipStreamWriter` (which is sink-agnostic). Warmed up at startup on non-FSA browsers (`main.tsx`). **Playwright-verified** in Chromium by removing `showSaveFilePicker` to force the path: the SW-produced download is **byte-identical**.
- **Still to build (not core):** resumable transfers, §6E tier 3 (OPFS staging — a niche fallback; tiers 1/2 + Blob already cover every browser), whole-file SHA/`EofMessage` verification (per-chunk GCM + monotonic seq + the byte-count check already cover integrity), Web Share Target, full i18n.
- **PWA** (`vite-plugin-pwa` / Workbox), QR (`qr-scanner` + generator), state (`Zustand`), accessible components (`shadcn/ui` + Radix).
- **Testing:** Vitest units (89 tests) + a Playwright browser E2E (`e2e/`, `bun run test:e2e`) are running. Two headless Bun smoke tests cover the signaling server/client.
- **Config gaps remaining:** Oxlint type-aware rules still off (`oxlint-tsgolint`, `"typeAware": true`). (`strict: true`, and the `typecheck`/`test`/`format` scripts, are now in place.)

---

## 1. Product Principles

Tie-breakers, top-down, when a decision is ambiguous:

1. **Zero-knowledge by construction.** The server must be *mathematically unable* to read file contents, filenames, or the key — not merely "trusted not to."
2. **Local-first & ephemeral.** Nothing persisted server-side. Data lives only in the two peers' RAM/disk during transfer.
3. **Serverless-first.** Signaling scales to zero and costs ~nothing idle.
4. **It must actually connect.** NAT traversal, TURN relay fallback, and reconnection are first-class, not afterthoughts.
5. **Effortless UX.** Sharing = show a QR or read a 3-word code. Security is the default and mostly invisible.
6. **Cross-platform honesty.** Detect capabilities; degrade gracefully. Never dead-end Safari/Firefox because an API is Chromium-only.
7. **Auditable & open.** Small, readable crypto surface; documented threat model; no hand-rolled primitives.

---

## 2. Feature Set

**Core (MVP):** direct P2P transfer with AES-256-GCM E2EE · two pairing modes (**Link/QR** with the key in the URL hash; **short-code** via PAKE) · streaming multi-GB files with flat memory · backpressure-aware transport · live progress/speed/ETA · graceful + ungraceful teardown.

**Robustness:** STUN + **TURN fallback** (relay stays E2EE) · resumable transfers (chunk-level ACK) · multi-file/folder · per-chunk GCM tags + whole-file hash.

**UX / PWA:** installable + offline shell · QR generate/scan · Web Share Target · drag-drop/picker/paste · text/clipboard sharing · **incoming-transfer consent** (manifest + SAS before any disk write) · **risky-file warning + second confirm** (§4.7) · **optional malware-hash check** (opt-in, off by default) · **SAS verification UI** · Screen Wake Lock during transfers · dark mode · full i18n · WCAG 2.1 AA · optional local-only history (IndexedDB).

> **Scope note — strictly 1-to-1.** A single sender ↔ single receiver tunnel. **No** group/broadcast/fan-out. Sharing with several people = **a new tunnel per person**, each with fresh ephemeral keys and its own SAS. Deliberate simplicity *and* security choice: no shared group key, no relay topology, no cross-recipient metadata.

---

## 3. Architecture & Lifecycle

```
[Device A · Sender]        [Signaling · stateless edge]        [Device B · Receiver]
       |  1. Create room ------------>|  (server: hashed roomId,         |
       |                              |   opaque relay of blobs only)    |
       |                              |<----------- 2. Join room --------|
       |  3. Exchange ENCRYPTED signaling envelopes (SDP, ICE, ECDH pubkeys)
       |<============================ via server relay ==================>|
       |     server sees only ciphertext + roomId; cannot MITM undetected |
       |  4. Derive session keys (ECDH → HKDF); compute + show SAS        |
       |  5. WebRTC "connected" ⇒ DROP SIGNALING SOCKET immediately      |
       |X====== signaling disconnected; room GC'd server-side ==========X|
       |  6. Encrypted manifest (names/sizes) ─→  receiver consents ⇐──── |
       |  7. Stream AES-256-GCM chunks (backpressure-gated) ===========> |
       |     ACK / resume window <====================================== |
       |  8. "EOF" + whole-file hash ─→  receiver validates count+hash ─→ |
       |X- 9. close() channels + peer conns; null all buffers/keys ----X |
```

- **Signaling teardown:** the moment `connectionState === "connected"` **and** the DataChannel is open, close the signaling socket. Rooms are transient in-memory objects, GC'd on disconnect or TTL (default 10 min unclaimed).
- **Reconnection:** on a mid-transfer drop, briefly re-open signaling for an **ICE restart** and resume from the last acknowledged chunk. Re-signaling reuses the already-derived session keys — no re-verification.

---

## 4. Security Model & Cryptography

> The most important section. Do not weaken it for convenience. Any change here needs a threat-model note (§9).

### 4.1 Threat model
**Defended:** malicious/compromised **signaling server** (read data, steal keys, MITM the handshake); malicious **TURN relay**; passive eavesdroppers; **replay / reorder / truncation** of chunks.
**Out of scope (explicit):** a **compromised endpoint** (malware/keylogger on a peer — E2EE can't save an owned device); **traffic-analysis metadata** (that a transfer happened, rough size, IPs). We minimize metadata; we don't claim anonymity.

### 4.2 Why app-layer E2EE on top of WebRTC DTLS?
DataChannels are DTLS-encrypted hop-to-hop, but **DTLS fingerprints are exchanged via the signaling server**, so a hostile server could swap them and MITM. Our key agreement is **authenticated by a secret the server never sees**, and the **SAS** lets humans detect any MITM. Security holds even if signaling **and** TURN are fully hostile.

### 4.3 Key agreement
Let `S` be the pairing secret:
- **Link/QR mode:** `S` = 256 bits CSPRNG, in the URL **hash fragment** (`…/r/<roomId>#<S>`). Parsed via `location.hash`; **never** sent to the server.
- **Short-code mode:** a short code drives a **SPAKE2** exchange → strong shared `S`, no guessable secret on the wire. **Implemented** in `src/crypto/spake2.ts` over **ristretto255** (a prime-order group, no cofactor pitfalls) from the audited `@noble/curves`; `M`/`N` are our own **nothing-up-my-sleeve** points (hash-to-group of fixed labels — SetuTunnel is a closed system, so they needn't match any RFC, only be dlog-unknown). `startSpake2(role, code)` → public message; `finishSpake2(state, peerMsg)` → 32-byte `S = SHA-256(transcript(M,N,pA,pB,K,w))`. `S` then feeds the *same* schedule below. The orchestrator (`connect({ pakeCode })`) runs one relayed SPAKE2 round (messages are public) before the envelope exchange.

> **Threat-model note (§9) — SPAKE2 change.** *What it changes:* adds a PAKE so a low-entropy code yields a strong `S` without a guessable value on the wire. *Why it's still safe:* (1) SPAKE2 gives an active attacker **at most one online password guess per run** — a wrong guess yields a different `S`, which fails to decrypt the HMAC-authenticated envelope (fail closed), and the **out-of-band SAS** catches a MITM (§4.2). No offline dictionary attack: the rendezvous room id is derived from a *separate non-secret* nameplate, **not** from the code's password words, so the visible room id leaks nothing about the password. (2) No hand-rolled primitives — only `@noble` curve/hash ops composed per SPAKE2; `M`/`N` are dlog-unknown by construction; the peer point is validated and the identity/degenerate cases are rejected (fail closed, §4.7). (3) Golden known-answer vector + agreement/divergence/malformed-input tests (`spake2.test.ts`) and a headless two-peer handshake test (`orchestrator.test.ts`). *Downstream unchanged:* `S` drives the exact same envelope + `deriveSession` + SAS as Link/QR mode.

Both peers also generate **ephemeral X25519** keypairs, exchanged inside the encrypted envelope:
```
K_dh   = X25519(myPriv, theirPub)                 # ephemeral ⇒ forward secrecy
master = HKDF-Extract(salt = roomId, IKM = S ‖ K_dh)
K_AtoB = HKDF-Expand(master, "setu/a→b", 32)      # direction-separated keys
K_BtoA = HKDF-Expand(master, "setu/b→a", 32)
SAS    = HKDF-Expand(master, "setu/sas", 4) → emoji/number string
```
Signaling envelopes (SDP/ICE/pubkeys) are **encrypted + HMAC-authenticated** with a sub-key of `S` — the server can't tamper undetected. **SAS** shows on both devices; short-code users compare it out-of-band, QR/link users can auto-trust it (S never left the owner).

### 4.4 Bulk encryption
- **AES-256-GCM** per chunk. Default chunk **64 KiB** (tunable 16–256 KiB by measured throughput).
- **Nonce discipline:** 96-bit nonce = `direction_id (4B) ‖ chunk_counter (8B, monotonic)`. Never reuse a `(key, nonce)` pair. New session ⇒ new keys ⇒ fresh nonce space.
- **AAD** binds position: `transferId ‖ chunkIndex ‖ isFinalFlag` — reorder/replay/truncation fail the auth check.
- **Metadata encrypted too:** filenames/sizes/MIME in an encrypted **manifest** message, never cleartext.
- **Whole-file integrity:** receiver streams SHA-256 (or BLAKE3) over decrypted plaintext, compares to the hash in the authenticated `EOF`.

### 4.5 What the server can / cannot see
| Data | Server visibility |
|---|---|
| File contents, names, sizes, types | ❌ Never |
| Encryption key / pairing secret `S` | ❌ Never (hash fragment / PAKE) |
| Room ID | ⚠️ Hashed/opaque, to route peers |
| SDP / ICE / peer public keys | ⚠️ Relayed, but encrypted + HMAC-authenticated |
| Peer IP addresses | ⚠️ Unavoidable at the network layer; minimized, never stored |

### 4.6 Crypto rules of engagement
- **Web Crypto (`crypto.subtle`) only** for AES-GCM, HKDF, ECDH, SHA-256. No hand-rolled primitives.
- For X25519/SPAKE2 gaps, use a **single audited library** (`@noble/curves`, `@noble/hashes`). Pin versions; document every crypto dep.
- Keys are **non-extractable** `CryptoKey`s wherever the API allows.
- **Zeroize** key material and plaintext buffers on teardown; drop references for GC.
- **Fail closed.** Any crypto/verification error aborts the transfer and surfaces it — never fall back to unencrypted/unverified data.

### 4.7 Content safety & trust boundary

> **Channel-safe ≠ content-safe.** Crypto guarantees the file arrives *un-tampered from the peer you paired with* — not that it's *benign*. A virus can be perfectly encrypted and perfectly delivered. And because we're zero-knowledge, **the server can never scan content** — server-side AV is off the table *by design*. Safety lives at the endpoints, layered:

1. **Consent gate (mandatory).** Nothing hits disk until the receiver accepts, after seeing the **manifest** (name/size/type) and **SAS** (who's on the other end).
2. **Dangerous-type detection + double confirm.** Executables/scripts and disguised/double extensions (`.exe .scr .bat .cmd .js .vbs`, `invoice.pdf.exe`) and MIME-vs-extension mismatches → prominent **red warning** + a **second, deliberate confirmation**. Ordinary docs/images accept in one action.
3. **Never auto-open / auto-execute.** The app only *saves*; it never runs or renders received files.
4. **Delegate scanning to the OS.** Files land in Downloads where Windows Defender / Gatekeeper / mobile AV scan on write/open. Our job is to *not bypass it*.
5. **Optional hash reputation — opt-in, OFF by default.** SHA-256 lookup against a known-malware list; discloses that a *hash* (never the file) leaves the device. Off unless enabled.
6. **Social trust is the outer layer.** SAS confirms *who*, not their *intent*. UI copy: "only accept files you're actually expecting."

**Protect the app from a malicious peer too** — treat every incoming byte as hostile:
- **Sanitize filenames**; block path traversal (`../`) and, in folder mode, **zip-slip**.
- **Sandbox all previews** — never render incoming SVG/HTML inline (XSS); preview images/text in a CSP-locked isolated context only.
- **Validate the manifest**, enforce **size/count caps**, **fail closed** on malformed chunks.

---

## 5. Technical Stack

**Toolchain — Bun for package/runtime, the Vite (VoidZero) family for dev tooling.** Bun installs/runs (`bun install`, `bun run <script>`) and is the runtime for the self-host signaling server (`Bun.serve`). **Prefer the Vite/VoidZero-family tool whenever a choice exists:** Vite (build, Rolldown-based), **Vitest** (test), **Oxlint** (lint), **Oxc `oxfmt`** (format, as it stabilizes; **Biome** as the interim formatter + import sorter, its linter disabled so Oxlint stays the linter). Cloudflare signaling deploys via **Wrangler** (Workers run on V8 isolates, not Bun).

**Frontend (installed):** Vite 8 · React 19 (+ React Compiler) · Tailwind v4 · `motion` · TypeScript 6 · Oxlint.
**Frontend (to add):** `vite-plugin-pwa` (Workbox) · `Zustand` · `shadcn/ui` + Radix (a11y) · `qr-scanner` + a QR generator · `@noble/curves` + `@noble/hashes`.

**Signaling — vendor-neutral, two equal options** (the client talks to *any* WS host via `VITE_SIGNALING_URL`, so this is never locked to a provider): **self-host `Bun.serve`** (native WebSocket, no `ws` dep — one lean process; `signaling/Dockerfile` + root `docker-compose.yml` run it anywhere), or **Cloudflare Workers + Durable Objects** (serverless, scales to zero, ~$0). Both run the *same shared `RoomManager`* and the *same wire protocol*. Deploy recipes for both in [DEPLOY.md](DEPLOY.md).

**TURN / NAT — bring-your-own, vendor-neutral:** STUN for discovery; **TURN** relay fallback that stays E2EE (relay sees only ciphertext). ICE servers are **fully configurable** (`VITE_ICE_SERVERS` / `VITE_STUN_URLS` / `VITE_TURN_URLS`+creds → `src/lib/ice.ts`, `resolveIceServers`), so a hoster points at self-hosted **coturn** (`infra/coturn/`, `docker compose --profile turn`) or any provider (metered.ca / Twilio / Cloudflare Calls). Off by default (STUN-only). Credentials are **short-lived tokens** — the `GET /turn` endpoint on both signaling servers mints them per-request (coturn `use-auth-secret` / TURN REST API, `src/signaling/turn.ts`); the client opts in via `VITE_TURN_ENDPOINT` and no long-lived secret is ever shipped to the browser (§5).

**Browser APIs:** WebRTC (`RTCPeerConnection`, `RTCDataChannel`) · Web Crypto (`crypto.subtle`) · File System Access (`showSaveFilePicker` → `FileSystemWritableFileStream`) with **capability-detected fallbacks** (§6, Module E) · Web Share Target · Screen Wake Lock · OPFS.

---

## 6. Core Modules

- **A — Cryptography.** §4 in code: pairing-secret parsing, PAKE, ECDH, HKDF schedule, SAS, per-chunk AES-GCM with nonce+AAD discipline, manifest encryption, streaming hash. Small testable API (`deriveSession`, `encryptChunk`, `decryptChunk`, `computeSAS`) with **golden test vectors**. Pure, framework-agnostic.
- **B — Connection & protocol lifecycle.** Open signaling → relay encrypted envelopes → tear down signaling on connect → stream → graceful `EOF`+hash validate/ACK → ungraceful teardown on `beforeunload`/`pagehide`/`connectionstatechange`. Model transitions with a **typed state machine** (XState or a typed reducer).
- **C — Sender (streaming read).** `File.slice(offset, offset+chunkSize)` → encrypt → transport with backpressure. Sliding **unacked window** for resume. Never load the whole file.
- **D — Transport & reliability.** Honor `bufferedAmount` / `bufferedAmountLowThreshold` (this is what saves multi-GB transfers). Ordered/reliable channel; optional **parallel channels** for throughput; **ACK/resume window** + **ICE restart**.
- **E — Receiver (streaming write, cross-browser).** Capability-detected, never dead-end: (1) **File System Access API** (Chromium desktop) → stream to disk; (2) **service-worker streamed download** (Firefox/Safari, StreamSaver-style); (3) **OPFS staging** then export; (4) **in-memory Blob** (small files, capped, warned).
- **F — UX / PWA shell.** Pairing (QR + short code) · transfer dashboard (progress/speed/ETA) · consent + SAS with **risky-type warning + second-confirm** · history · settings (theme, language, chunk size, TURN, **malware-hash opt-in — off by default**) · install prompt · Web Share Target handler.

Heavy crypto/IO runs **off the main thread** in **Web Workers** so the UI stays at 60fps.

---

## 7. Non-Functional Requirements

- **Performance:** saturate bandwidth; sender memory flat regardless of file size; 60fps during transfer.
- **Browser matrix** (document per feature + fallback): WebRTC DataChannel ✅ all · Web Crypto ✅ all · File System Access ✅ Chromium desktop / ❌ FF+Safari→SW fallback · Web Share Target ✅ Chromium (installed)/⚠️ others · Wake Lock ✅ Chromium, Safari 16.4+.
- **Accessibility:** WCAG 2.1 AA — keyboard, screen-reader labels, contrast, reduced-motion (respect `prefers-reduced-motion` in `motion`).
- **i18n:** all copy externalized; RTL-ready.
- **Privacy:** no analytics by default; if ever added — self-hosted, anonymous, opt-in.
- **Security posture:** strict CSP, Trusted Types, SRI, no inline secrets; `bun audit` gate in CI.

---

## 8. Structure

**Now:** `setutunnel-web/` is a standalone Vite app.
**Target:** grow into a **Bun-workspace monorepo** — promote this app to `apps/web`, add `apps/signaling` (Worker+DO) and pure packages `packages/{crypto,protocol,transport}` (dependency-free where possible, portable, heavily tested), plus `infra/` (TURN) and `e2e/` (Playwright). Keep `crypto`/`protocol`/`transport` free of React/DOM so they unit-test in isolation.

Within the app, suggested layout as it grows: `src/crypto/`, `src/transport/`, `src/protocol/`, `src/components/` (UI), `src/state/` (Zustand), `src/workers/` (crypto/IO), `src/lib/`.

---

## 9. Engineering Conventions

- **Language:** TypeScript everywhere. **Enable `strict: true`** in `tsconfig.app.json` (currently missing — add it). No `any` in crypto/protocol code.
- **Toolchain preference:** when several tools do the same job, pick the **Vite/VoidZero-family** one (Vite, Vitest, Oxlint/Oxc, Rolldown). **Bun** stays the package manager + runtime.
- **React 19 + Compiler:** the compiler auto-memoizes — **don't** litter `useMemo`/`useCallback`/`memo` for performance; add them only when profiling proves a need. Keep components pure; follow rules of hooks (Oxlint enforces).
- **Styling:** Tailwind v4 utilities; mobile-first; dark mode; honor reduced-motion.
- **Testing:** **Vitest** for units — crypto **golden vectors are mandatory** and must pass in CI; **Playwright** for real cross-browser P2P E2E. A crypto change without added/updated vectors is incomplete.
- **Lint/format:** **Oxlint** is primary (`bun run lint`); enable **type-aware rules** (`oxlint-tsgolint`, `"typeAware": true`) for production. Format with **`oxfmt`** as it stabilizes; **Biome** is the interim formatter (`bun run format` = `biome check --write` → format + import/export sorting) with **its linter disabled** so it never competes with Oxlint. Fall back to ESLint only for type-aware rules Oxlint lacks.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `sec:`, `docs:`…).
- **Security review:** any change to crypto or the key schedule needs a PR note: what changed and why it's still safe.
- **No secret reaches the server.** Reject any change that could send `S`, a `CryptoKey`, or plaintext to signaling.
- **Fail closed.** On any crypto/verification error, abort and surface — never downgrade to unencrypted/unverified.
- **Scripts:** present — `dev`, `build`, `typecheck` (`tsc -b --noEmit`), `test` / `test:run` (Vitest), `lint` (Oxlint), `format` / `format:check` (Biome), `preview`. **Still to add** — `test:e2e` (Playwright).

---

## 10. Roadmap

- **v0 (MVP):** Link/QR pairing · single-file streaming · AES-256-GCM + ECDH/HKDF · backpressure · STUN · graceful teardown · installable PWA.
- **v1:** Short-code + PAKE + SAS · TURN fallback · resumable transfers · multi-file/folder · cross-browser receiver fallbacks · Web Share Target · i18n + a11y pass.
- **v2:** parallel channels for throughput · text/clipboard sharing · local history · self-host bundle (signaling + TURN) · third-party security audit.

**Immediate next steps:** ~~strict~~ · ~~Vitest + crypto vectors~~ · ~~Module A (crypto)~~ · ~~Module B (protocol/pairing)~~ · ~~Modules C/D/E data-plane~~ · ~~signaling plane (protocol + RoomManager + Bun.serve server + browser `SignalingClient`, smoke-verified)~~ · ~~signaling-envelope crypto (§4.3)~~ · ~~connect() handshake orchestrator~~ · ~~WebRTC binding + a **real browser-to-browser transfer E2E** (Playwright, passing)~~ · ~~UI (Module F) + UI-driven transfer E2E~~ · ~~multi-file transfer~~ · ~~hardening pass (untrusted-manifest validation, disconnect detection, double-accept guard, wss)~~ · ~~installable PWA + a11y/cancel polish~~ · ~~text/clipboard sharing~~ · ~~folder transfer + receive-as-zip (single→direct, multi/folder→one zip)~~ · ~~CF Worker+DO primary signaling (single coordinator DO, SQLite-backed/free-tier, workerd-verified) + [DEPLOY.md](DEPLOY.md)~~ · ~~vendor-neutral hosting (Docker self-host + host-anywhere docs) + configurable ICE / BYO TURN + ephemeral TURN-credential endpoint (`/turn`, coturn REST, both servers, live-verified)~~ · ~~streaming disk-write (§6E tier 1: FSA, single-file + multi-file zip → flat memory)~~ · ~~graceful teardown (§6B)~~ · ~~PAKE short-code mode (SPAKE2/ristretto255 + code UI, Playwright-verified)~~ **← done: v1 feature-complete incl. both pairing modes, deployable for ~$0 on any host** → **next (v2/infra):** resumable transfers · §6E tiers 2–3 (SW-stream / OPFS fallbacks for Firefox/Safari) · Web Share Target · i18n/a11y.

---

## 11. Non-Goals

- **No group / broadcast / multi-recipient sharing.** Strictly 1-to-1 per tunnel; several people = a fresh tunnel each. No shared group keys, no relay swarm, no fan-out.
- **No cloud storage / "send later."** Both peers online simultaneously — a tunnel, not a mailbox.
- **No server-side files, accounts, or logs of content.**
- **No anonymity claims.** Metadata minimized, but a network sees IPs; use Tor/VPN if that's your threat model.
- **No DRM / "delete after read"** on the recipient's own copy — once decrypted, the file is theirs.
- **Not an antivirus.** We gate consent, warn on risky types, and never auto-execute (§4.7), but we can't server-scan encrypted content by design.
