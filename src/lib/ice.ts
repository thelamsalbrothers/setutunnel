import { DEFAULT_ICE_SERVERS } from '../transport/webrtc'

/**
 * ICE server (STUN/TURN) configuration — deliberately **vendor-neutral** and
 * fully overridable at build time, so a self-hoster can point at *any* STUN/TURN
 * (self-hosted coturn, metered.ca, Twilio, Cloudflare Calls, …) without touching
 * code. Nothing here is tied to a specific provider; the only default is public
 * STUN, which every hoster can replace.
 *
 * Three ways to configure, most-specific first:
 *   1. `VITE_ICE_SERVERS` — a JSON array of `RTCIceServer` objects. Most
 *      flexible; use for multiple TURN URLs, `turns:` (TLS), etc.
 *   2. Granular env: `VITE_STUN_URLS` (comma-separated) plus optional
 *      `VITE_TURN_URLS` + `VITE_TURN_USERNAME` + `VITE_TURN_CREDENTIAL`.
 *   3. Neither set ⇒ public STUN only (see `DEFAULT_ICE_SERVERS`).
 *
 * SECURITY (§4.1, §5): TURN only relays *ciphertext* — the relay never sees
 * plaintext or keys, so a hostile TURN can't read the transfer. Static TURN
 * credentials baked into a build are world-readable; prefer short-lived creds
 * fetched at runtime (see the roadmap's TURN credential endpoint) for a public
 * deployment. `credential` is never sent to the signaling server.
 */

export interface IceEnv {
  VITE_ICE_SERVERS?: string
  VITE_STUN_URLS?: string
  VITE_TURN_URLS?: string
  VITE_TURN_USERNAME?: string
  VITE_TURN_CREDENTIAL?: string
}

function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Pure resolver (testable): env → the RTCPeerConnection `iceServers` list. */
export function resolveIceServers(env: IceEnv): RTCIceServer[] {
  // 1. Full JSON override — the escape hatch for any provider/shape.
  const raw = env.VITE_ICE_SERVERS?.trim()
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as RTCIceServer[]
      }
    } catch {
      // Malformed JSON: fall through to the granular knobs / default rather
      // than crash the app. A bad env var must not brick pairing.
    }
  }

  // 2. Granular knobs: a STUN list and/or a TURN entry with credentials.
  const servers: RTCIceServer[] = []
  const stun = splitList(env.VITE_STUN_URLS)
  if (stun.length > 0) servers.push({ urls: stun })

  const turn = splitList(env.VITE_TURN_URLS)
  if (turn.length > 0) {
    servers.push({
      urls: turn,
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    })
  }

  if (servers.length > 0) return servers

  // 3. Nothing configured ⇒ public STUN only. Direct P2P works for most
  //    networks; symmetric-NAT peers need a TURN entry via (1) or (2).
  return DEFAULT_ICE_SERVERS
}

export const ICE_SERVERS: RTCIceServer[] = resolveIceServers(
  import.meta.env as unknown as IceEnv,
)

/**
 * Fetch a short-lived TURN credential from a signaling `/turn` endpoint (§5) and
 * shape it as an `RTCIceServer`. The relay secret stays server-side; only the
 * expiring credential crosses the wire. Throws on any malformed response so the
 * caller fails soft to STUN-only.
 */
async function fetchTurnServer(endpoint: string): Promise<RTCIceServer> {
  const res = await fetch(endpoint, { method: 'GET' })
  if (!res.ok) throw new Error(`turn endpoint: ${res.status}`)
  const data: unknown = await res.json()
  if (typeof data !== 'object' || data === null) {
    throw new Error('turn endpoint: malformed response')
  }
  const { urls, username, credential } = data as Record<string, unknown>
  const okUrls =
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.every((u) => typeof u === 'string'))
  if (
    !okUrls ||
    typeof username !== 'string' ||
    typeof credential !== 'string'
  ) {
    throw new Error('turn endpoint: missing urls/username/credential')
  }
  return { urls: urls as string | string[], username, credential }
}

/**
 * The ICE servers to hand `RTCPeerConnection`. Starts from the static config
 * (`ICE_SERVERS`) and, if `VITE_TURN_ENDPOINT` is set, appends a freshly-minted
 * ephemeral TURN server. **Fail soft:** if the fetch fails, we still return the
 * static list — direct P2P over STUN works for most peers, so a TURN outage must
 * not block pairing.
 */
export async function loadIceServers(): Promise<RTCIceServer[]> {
  const endpoint = (
    import.meta.env as unknown as { VITE_TURN_ENDPOINT?: string }
  ).VITE_TURN_ENDPOINT?.trim()
  if (!endpoint) return ICE_SERVERS
  try {
    return [...ICE_SERVERS, await fetchTurnServer(endpoint)]
  } catch {
    return ICE_SERVERS
  }
}
