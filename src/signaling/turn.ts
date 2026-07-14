/**
 * Ephemeral TURN credentials — the coturn "TURN REST API" scheme (CLAUDE.md §5).
 *
 * A TURN relay needs credentials, but §5 forbids shipping a long-lived secret in
 * the (public, static) client. So the signaling server holds a shared secret
 * that matches coturn's `static-auth-secret` (`use-auth-secret` mode) and mints a
 * short-lived credential per request:
 *
 *   username   = <unix-expiry>[":"<label>]
 *   credential = base64( HMAC-SHA1( secret, username ) )
 *
 * The secret NEVER leaves the server — only the derived, *expiring* credential
 * does. This is the exact scheme coturn validates, and the same one managed
 * providers (metered.ca, Twilio, …) expose, so it stays vendor-neutral.
 *
 * Pure and runtime-agnostic: uses only Web Crypto (`crypto.subtle`) + `btoa`,
 * available in Bun, Cloudflare Workers, and the browser alike. Zero-knowledge is
 * unaffected — TURN relays ciphertext only (§4.1).
 */

export interface TurnCredential {
  username: string
  credential: string
  /** Seconds until the credential expires. */
  ttl: number
}

/** Config a signaling server reads from its environment to enable `/turn`. */
export interface TurnConfig {
  /** Comma-separated TURN URLs, e.g. `turn:host:3478,turns:host:5349`. */
  urls?: string
  /** Shared secret; must equal coturn's `static-auth-secret`. Server-only. */
  secret?: string
  /** Credential lifetime in seconds. Defaults to 24h. */
  ttlSeconds?: number
}

export interface TurnPayload {
  urls: string[]
  username: string
  credential: string
  ttl: number
}

const DEFAULT_TTL_SECONDS = 86_400 // 24h — safely outlives even long transfers

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function hmacSha1Base64(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    asBufferSource(encoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    asBufferSource(encoder.encode(message)),
  )
  return base64(new Uint8Array(signature))
}

/**
 * Mint one credential valid for `ttlSeconds` from `nowSeconds` (both in Unix
 * seconds — passed in so the function stays pure and testable).
 */
export async function mintTurnCredential(
  secret: string,
  ttlSeconds: number,
  nowSeconds: number,
  label?: string,
): Promise<TurnCredential> {
  const ttl = Math.floor(ttlSeconds)
  const expiry = Math.floor(nowSeconds) + ttl
  const username = label ? `${expiry}:${label}` : String(expiry)
  const credential = await hmacSha1Base64(secret, username)
  return { username, credential, ttl }
}

function splitUrls(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Build the JSON body for a `/turn` request, or `null` when TURN isn't configured
 * (so the endpoint returns 404 and the client cleanly falls back to STUN-only).
 */
export async function buildTurnPayload(
  config: TurnConfig,
  nowSeconds: number,
): Promise<TurnPayload | null> {
  if (!config.urls || !config.secret) return null
  const urls = splitUrls(config.urls)
  if (urls.length === 0) return null
  const ttl =
    config.ttlSeconds && config.ttlSeconds > 0
      ? config.ttlSeconds
      : DEFAULT_TTL_SECONDS
  const cred = await mintTurnCredential(config.secret, ttl, nowSeconds)
  return {
    urls,
    username: cred.username,
    credential: cred.credential,
    ttl: cred.ttl,
  }
}
