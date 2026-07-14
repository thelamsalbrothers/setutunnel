# SetuTunnel

> **Two devices. One private tunnel. Zero trace.**

**SetuTunnel** (सेतु — "bridge") is an open-source, local-first Progressive Web App
for high-speed, **end-to-end encrypted** file transfer directly between two
devices — phone ↔ phone, phone ↔ PC, PC ↔ PC. A tiny, stateless signaling service
only *introduces* the two peers; every real byte then flows **directly
peer-to-peer** over an encrypted WebRTC DataChannel and is gone the moment the
transfer ends. No accounts, no cloud uploads, no files at rest on any server.

## Why it's different

- 🔒 **Zero-knowledge by construction.** The server *cannot* read file contents,
  names, or the key — not "trusted not to," but mathematically unable. The pairing
  secret lives only in the URL hash fragment and never reaches the server.
- ⚡ **Direct P2P.** Files stream device-to-device over WebRTC; the server relays
  only a few KB of *encrypted* introductions, then the socket is dropped.
- 🧬 **Real E2EE.** X25519 key agreement → HKDF → AES-256-GCM per chunk, with a
  **SAS** (a short emoji/number string) so humans can detect a man-in-the-middle.
- 🤝 **Two ways to pair.** Scan a QR / open a link (a 256-bit key rides in the URL
  hash), or read a **short 3-part code** aloud (e.g. `742-otter-anvil`) — a SPAKE2
  PAKE turns it into a strong key, so even a short code is safe on the wire.
- 🗂️ **Files, folders, or text.** Multi-file and whole-folder sends arrive as one
  zip (structure preserved); paste a snippet and it shows inline with a copy button.
- 📥 **Streams to disk.** Large receives write straight to disk with flat memory
  (multi-GB safe) on every browser — File System Access where available, a
  service-worker stream everywhere else.
- 📲 **Installable PWA.** Offline app shell, light/dark, responsive, accessible.
- 💸 **~$0 to run.** Static frontend + a scales-to-zero signaling Worker + free
  public STUN. See **[DEPLOY.md](DEPLOY.md)**.

## How it works

1. The sender picks files and gets a QR/link with a 256-bit secret in the URL
   **hash** (browsers never send the fragment to a server).
2. The receiver opens it; the two peers exchange **encrypted** signaling envelopes
   (SDP / ICE / X25519 public keys) through the relay.
3. Both derive the same session keys and display a matching **SAS**; the signaling
   socket is dropped the instant the P2P link is up.
4. Files stream as AES-256-GCM chunks directly between the devices,
   integrity-checked — and the receiver consents before anything touches disk.

> Prefer reading a code aloud to scanning? Switch to **short-code** mode — a SPAKE2
> PAKE turns a 3-part code into the same strong session key, and you compare the SAS
> out-of-band to rule out a man-in-the-middle.

Deep dive — the key schedule, threat model, and content-safety rules — is in
[CLAUDE.md](CLAUDE.md) §4.

## Security at a glance

- **Defended:** a malicious or compromised signaling server or TURN relay, passive
  eavesdroppers, and chunk replay / reorder / truncation.
- **Out of scope:** a compromised endpoint device (malware on a peer — E2EE can't
  save an owned device), and network-level metadata (that a transfer happened, its
  rough size, IPs). We minimize metadata; we do **not** claim anonymity.
- **Fail closed.** Any crypto or verification error aborts the transfer — never a
  silent downgrade to unencrypted or unverified data.
- **The peer is untrusted.** Incoming manifests are validated, filenames sanitized
  (no path traversal / zip-slip), risky types flagged with a second confirmation,
  and received files are never auto-opened.

> ⚠️ **Not an antivirus.** Encryption guarantees a file arrives un-tampered *from
> the peer you paired with* — not that it is *benign*. Only accept files you're
> actually expecting; your OS scans them on save.

## Quickstart (development)

Requires [Bun](https://bun.sh). (Uses Bun, not npm/pnpm — `bun.lock` is the lockfile.)

```bash
bun install

# Terminal 1 — the local signaling server
bun run dev:signaling

# Terminal 2 — the app
bun run dev
```

Open the printed URL, pick a file, then open the generated pairing link in a
second tab (or another device on your LAN) to watch a real encrypted transfer.

## Testing

```bash
bun run test:run     # Vitest units — crypto golden vectors, protocol, transport
bun run test:e2e     # Playwright — real two-browser encrypted transfers via the UI
bun run typecheck    # strict TypeScript
bun run lint         # Oxlint
bun run format       # Biome (format + import sorting)
```

## Deploy (host it anywhere)

SetuTunnel is **vendor-neutral**: a static frontend for any host + a tiny
WebSocket signaling relay you can run anywhere. Two reference recipes in
**[DEPLOY.md](DEPLOY.md)**:

- **Self-host** — `docker compose up -d` runs the relay on any box (VPS, Fly,
  Railway, a home server, a Pi); serve `dist/` on any static host. No account
  needed.
- **Cloudflare (~$0)** — the app on Pages + a scales-to-zero Worker + Durable
  Object for signaling.

The client points at any signaling URL (`VITE_SIGNALING_URL`) and any STUN/TURN
(`VITE_ICE_SERVERS`), so nothing locks you to a provider. **TURN** (NAT relay for
symmetric-NAT peers) is bring-your-own — self-host coturn or use any provider; see
[DEPLOY.md → TURN](DEPLOY.md#turn--nat-relay-bring-your-own).

## Tech stack

Bun · Vite · React 19 (+ React Compiler) · TypeScript (strict) · Tailwind v4 ·
WebRTC · Web Crypto + [`@noble`](https://github.com/paulmillr/noble-curves)
curves/hashes · Vitest · Playwright · Oxlint · Biome · Cloudflare Workers & Pages.

## Scope & non-goals

- **Strictly 1-to-1.** One sender ↔ one receiver per tunnel. Sharing with several
  people means a fresh tunnel each (fresh keys + SAS). No group/broadcast, no
  shared group key.
- **No cloud storage / "send later."** Both peers must be online — it's a tunnel,
  not a mailbox.
- **No server-side files, accounts, or content logs.**

Roadmap and the full working spec live in [CLAUDE.md](CLAUDE.md).

## Contributing

Issues and pull requests are welcome. Before opening a PR:

- `bun run typecheck && bun run lint && bun run test:run` should pass, and behavior
  changes should come with tests.
- **Anything touching crypto or the key schedule** needs a short threat-model note
  in the PR (what changed, why it's still safe) *and* updated golden vectors — see
  [CLAUDE.md](CLAUDE.md) §4 and §9. No secret (the pairing key `S`, a `CryptoKey`,
  or plaintext) may ever reach the server, and errors must **fail closed**.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `sec:`, `docs:` …).

## Acknowledgements

SetuTunnel was designed and built with **[Claude Code](https://claude.com/claude-code)**,
Anthropic's agentic coding assistant — which helped shape the architecture, implement
the crypto/transport/signaling layers, write the test suite, and craft the UI. Credit
where it's due. 🙏

## License

[MIT](LICENSE) © Sangam Lamsal.
