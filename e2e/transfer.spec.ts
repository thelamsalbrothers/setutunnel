import { expect, test } from '@playwright/test'

/**
 * Real browser-to-browser encrypted transfer. Two isolated Chromium contexts
 * pair over the local signaling server, establish a WebRTC DataChannel, derive
 * the session (X25519 → HKDF → SAS), and stream a file. Asserts the receiver's
 * decrypted bytes hash-match what the sender sent, and that both computed the
 * same SAS — i.e. the whole §3/§4 pipeline works end to end in a real browser.
 */
test('encrypted DataChannel transfer between two browser contexts', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  const logError =
    (label: string) => (msg: { type(): string; text(): string }) => {
      if (msg.type() === 'error') console.log(`[${label}] ${msg.text()}`)
    }
  pageA.on('console', logError('A'))
  pageB.on('console', logError('B'))

  await pageA.goto('/e2e/harness.html')
  await pageB.goto('/e2e/harness.html')
  await expect(pageA.locator('#status')).toHaveText('ready')
  await expect(pageB.locator('#status')).toHaveText('ready')

  // Receiver (A) creates a room and returns the pairing info immediately.
  const room = await pageA.evaluate(() => window.__setu.createRoom())
  expect(room.roomId.length).toBeGreaterThan(0)

  const payload = 'setutunnel e2e — hello over a real DataChannel 🚀 áéí'

  // Sender (B) joins, completes the handshake, and streams the payload.
  const sent = await pageB.evaluate(
    ([roomId, secretHex, text]) =>
      window.__setu.joinAndSend(roomId, secretHex, text),
    [room.roomId, room.secretHex, payload] as const,
  )

  // Fail fast if A's side errored rather than hanging to the timeout.
  const errorA = await pageA.evaluate(() => window.__error ?? null)
  expect(errorA).toBeNull()

  const receivedHash = await pageA.evaluate(() => window.__recvHash)
  const sasA = await pageA.evaluate(() => window.__sas)

  // Byte-identical after the full E2EE round-trip.
  expect(receivedHash).toBe(sent.sentHash)
  // Both ends derived the same Short Authentication String (MITM check).
  expect(sasA).toBe(sent.sas)

  await contextA.close()
  await contextB.close()
})
