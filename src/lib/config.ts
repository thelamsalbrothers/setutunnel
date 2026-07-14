// Signaling server URL. Defaults to the local self-host server on :8787
// (matches `bun run dev:signaling`); override with VITE_SIGNALING_URL.
// Uses wss:// on an https page so it isn't blocked as mixed content.
const envUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined
const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'

export const SIGNALING_URL =
  envUrl ?? `${scheme}://${window.location.hostname || 'localhost'}:8787`
