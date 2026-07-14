import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'

function makePayload(seed: number, size: number): Buffer {
  const buffer = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buffer[i] = (i * seed + seed) & 0xff
  return buffer
}

/**
 * Multiple files → the receiver bundles them into ONE .zip (avoids the browser
 * blocking N separate downloads). Drives the real UI end to end and unzips to
 * assert each file is byte-identical, with matching SAS on both ends.
 */
test('send multiple files, received as one zip, through the UI', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  const files = [
    {
      name: 'alpha.bin',
      type: 'application/octet-stream',
      buffer: makePayload(7, 150 * 1024),
    },
    {
      name: 'beta.bin',
      type: 'application/octet-stream',
      buffer: makePayload(13, 90 * 1024),
    },
    {
      name: 'gamma.txt',
      type: 'text/plain',
      buffer: Buffer.from('setutunnel '.repeat(4096)),
    },
  ]

  await sender.goto('/')
  await sender
    .getByTestId('file-input')
    .setInputFiles(
      files.map((f) => ({ name: f.name, mimeType: f.type, buffer: f.buffer })),
    )
  await sender.getByTestId('send-files').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })
  await expect(receiver.getByTestId('file-count')).toHaveText('3 files')
  const sasReceiver = (await receiver.getByTestId('sas').textContent())?.trim()
  const sasSender = (await sender.getByTestId('sas').textContent())?.trim()
  expect(sasReceiver).toBeTruthy()
  expect(sasReceiver).toBe(sasSender)

  const downloadPromise = receiver.waitForEvent('download')
  await receiver.getByTestId('accept').click()

  await expect(receiver.getByTestId('phase')).toHaveText('complete', {
    timeout: 30_000,
  })
  await expect(sender.getByTestId('phase')).toHaveText('complete', {
    timeout: 30_000,
  })

  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('setutunnel.zip')
  const unzipped = unzipSync(
    new Uint8Array(readFileSync(await download.path())),
  )
  for (const file of files) {
    const entry = unzipped[file.name]
    if (!entry) throw new Error(`missing ${file.name} in zip`)
    expect(Buffer.compare(Buffer.from(entry), file.buffer)).toBe(0)
  }

  await senderCtx.close()
  await receiverCtx.close()
})

/** A single file downloads directly as itself (no zip). */
test('send a single file (direct download) through the UI', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  const payload = makePayload(29, 120 * 1024)

  await sender.goto('/')
  await sender.getByTestId('file-input').setInputFiles({
    name: 'solo.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })
  await sender.getByTestId('send-files').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })

  const downloadPromise = receiver.waitForEvent('download')
  await receiver.getByTestId('accept').click()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('solo.bin')
  expect(Buffer.compare(readFileSync(await download.path()), payload)).toBe(0)

  await senderCtx.close()
  await receiverCtx.close()
})

/** A folder → one zip that preserves the directory structure. */
test('send a folder, received as a structured zip', async ({ browser }) => {
  const root = mkdtempSync(join(tmpdir(), 'setu-'))
  const dir = join(root, 'myfolder')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'top.txt'), 'top level file')
  writeFileSync(join(dir, 'sub', 'inner.txt'), 'nested file content')

  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  await sender.goto('/')
  await sender.getByTestId('folder-input').setInputFiles(dir)
  await sender.getByTestId('send-files').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })

  const downloadPromise = receiver.waitForEvent('download')
  await receiver.getByTestId('accept').click()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('setutunnel.zip')
  const unzipped = unzipSync(
    new Uint8Array(readFileSync(await download.path())),
  )
  const paths = Object.keys(unzipped)

  const inner = paths.find((p) => p.endsWith('sub/inner.txt'))
  const top = paths.find((p) => p.endsWith('top.txt'))
  if (!inner || !top) {
    throw new Error(`folder structure missing in zip: ${paths.join(', ')}`)
  }
  expect(Buffer.from(unzipped[inner]).toString()).toBe('nested file content')
  expect(Buffer.from(unzipped[top]).toString()).toBe('top level file')

  await senderCtx.close()
  await receiverCtx.close()
})

/**
 * A large single file streams straight to disk via the File System Access API
 * (§6E tier 1) instead of buffering in RAM. We stub `showSaveFilePicker` (so no
 * native dialog) to capture the streamed bytes, and force the size threshold to
 * 0 so a small test file takes the streaming path, then verify byte-identical.
 */
test('large single file streams to disk (File System Access API)', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  await receiver.addInitScript(() => {
    localStorage.setItem('setu:streamThreshold', '0') // force the streaming path
    const chunks: number[][] = []
    window.__setuChunks = chunks
    window.__setuClosed = false
    ;(
      window as unknown as { showSaveFilePicker: () => Promise<unknown> }
    ).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (data: BufferSource) => {
          const u8 =
            data instanceof Uint8Array
              ? data
              : new Uint8Array(data as ArrayBuffer)
          chunks.push(Array.from(u8))
        },
        close: async () => {
          window.__setuClosed = true
        },
      }),
    })
  })

  const payload = makePayload(101, 200 * 1024)

  await sender.goto('/')
  await sender.getByTestId('file-input').setInputFiles({
    name: 'movie.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })
  await sender.getByTestId('send-files').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })
  await receiver.getByTestId('accept').click()

  await expect(receiver.getByTestId('phase')).toHaveText('complete', {
    timeout: 30_000,
  })

  const streamed = await receiver.evaluate(() => ({
    bytes: (window.__setuChunks ?? []).flat(),
    closed: window.__setuClosed === true,
  }))
  expect(streamed.closed).toBe(true)
  expect(Buffer.compare(Buffer.from(streamed.bytes), payload)).toBe(0)

  await senderCtx.close()
  await receiverCtx.close()
})

/**
 * Multiple files stream to disk as ONE zip (§6E) — flat memory for folders too.
 * Same stub approach: capture what the streaming zip writes to the (faked) disk,
 * then unzip it and verify each file byte-identical.
 */
test('multiple files stream to disk as one zip (File System Access API)', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  await receiver.addInitScript(() => {
    localStorage.setItem('setu:streamThreshold', '0') // force the streaming path
    const chunks: number[][] = []
    window.__setuChunks = chunks
    window.__setuClosed = false
    ;(
      window as unknown as { showSaveFilePicker: () => Promise<unknown> }
    ).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (data: BufferSource) => {
          const u8 =
            data instanceof Uint8Array
              ? data
              : new Uint8Array(data as ArrayBuffer)
          chunks.push(Array.from(u8))
        },
        close: async () => {
          window.__setuClosed = true
        },
      }),
    })
  })

  const files = [
    {
      name: 'alpha.bin',
      type: 'application/octet-stream',
      buffer: makePayload(7, 150 * 1024),
    },
    {
      name: 'beta.txt',
      type: 'text/plain',
      buffer: Buffer.from('setutunnel '.repeat(3000)),
    },
  ]

  await sender.goto('/')
  await sender
    .getByTestId('file-input')
    .setInputFiles(
      files.map((f) => ({ name: f.name, mimeType: f.type, buffer: f.buffer })),
    )
  await sender.getByTestId('send-files').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })
  await receiver.getByTestId('accept').click()

  await expect(receiver.getByTestId('phase')).toHaveText('complete', {
    timeout: 30_000,
  })

  const result = await receiver.evaluate(() => ({
    bytes: (window.__setuChunks ?? []).flat(),
    closed: window.__setuClosed === true,
  }))
  expect(result.closed).toBe(true)
  const unzipped = unzipSync(new Uint8Array(result.bytes))
  for (const f of files) {
    const entry = unzipped[f.name]
    if (!entry) throw new Error(`missing ${f.name} in streamed zip`)
    expect(Buffer.compare(Buffer.from(entry), f.buffer)).toBe(0)
  }

  await senderCtx.close()
  await receiverCtx.close()
})

/**
 * Short-code (SPAKE2) pairing through the real UI: the sender shows a spoken
 * code, the receiver types it, they run the PAKE, agree on a matching SAS, and
 * the file transfers byte-identical — no link involved.
 */
test('pair with a short code (SPAKE2) and transfer through the UI', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  const payload = makePayload(53, 96 * 1024)

  await sender.goto('/')
  await sender.getByTestId('pairmode-code').click()
  await sender.getByTestId('file-input').setInputFiles({
    name: 'secret.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })
  await sender.getByTestId('send-files').click()

  await expect(sender.getByTestId('pairing-code')).toBeVisible({
    timeout: 15_000,
  })
  const code = (await sender.getByTestId('pairing-code').textContent())?.trim()
  if (!code) throw new Error('no short code appeared')

  await receiver.goto('/')
  await receiver.getByTestId('go-receive').click()
  await receiver.getByTestId('code-input').fill(code)
  await receiver.getByTestId('code-submit').click()

  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })
  const sasReceiver = (await receiver.getByTestId('sas').textContent())?.trim()
  const sasSender = (await sender.getByTestId('sas').textContent())?.trim()
  expect(sasReceiver).toBeTruthy()
  expect(sasReceiver).toBe(sasSender)

  const downloadPromise = receiver.waitForEvent('download')
  await receiver.getByTestId('accept').click()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('secret.bin')
  expect(Buffer.compare(readFileSync(await download.path()), payload)).toBe(0)

  await senderCtx.close()
  await receiverCtx.close()
})

/**
 * §6E tier 2: with NO File System Access API (the Firefox/Safari situation),
 * a large receive streams to disk through the /dl/ service worker instead of
 * buffering in RAM. We force that path by removing `showSaveFilePicker`, then
 * confirm the native download the SW produces is byte-identical.
 */
test('large single file streams to disk via a service worker (tier 2, no FSA)', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  await receiver.addInitScript(() => {
    // Force the non-Chromium path: pretend File System Access isn't available.
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker
    localStorage.setItem('setu:streamThreshold', '0')
  })

  const payload = makePayload(71, 160 * 1024)

  await sender.goto('/')
  await sender.getByTestId('file-input').setInputFiles({
    name: 'via-sw.bin',
    mimeType: 'application/octet-stream',
    buffer: payload,
  })
  await sender.getByTestId('send-files').click()
  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })

  const downloadPromise = receiver.waitForEvent('download', { timeout: 30_000 })
  await receiver.getByTestId('accept').click()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('via-sw.bin')
  expect(Buffer.compare(readFileSync(await download.path()), payload)).toBe(0)

  await senderCtx.close()
  await receiverCtx.close()
})

/** Files are staged (reviewable) before sending — you can remove one, then send. */
test('stages files with a removable grid before sending', async ({
  browser,
}) => {
  const senderCtx = await browser.newContext()
  const sender = await senderCtx.newPage()

  await sender.goto('/')
  await sender.getByTestId('file-input').setInputFiles([
    {
      name: 'keep.bin',
      mimeType: 'application/octet-stream',
      buffer: makePayload(1, 2048),
    },
    {
      name: 'drop.bin',
      mimeType: 'application/octet-stream',
      buffer: makePayload(2, 2048),
    },
  ])

  // Both files are staged (no auto-jump to pairing).
  await expect(sender.getByTestId('staged-name')).toHaveCount(2)
  await expect(sender.getByTestId('pairing-link')).toHaveCount(0)

  // Remove one, then send the rest.
  await sender.getByRole('button', { name: 'Remove drop.bin' }).click()
  await expect(sender.getByTestId('staged-name')).toHaveCount(1)
  await expect(sender.getByTestId('staged-name')).toHaveText('keep.bin')

  await sender.getByTestId('send-files').click()
  await expect(sender.getByTestId('pairing-link')).toBeVisible({
    timeout: 15_000,
  })

  await senderCtx.close()
})

test('share a text snippet through the UI', async ({ browser }) => {
  const senderCtx = await browser.newContext()
  const receiverCtx = await browser.newContext()
  const sender = await senderCtx.newPage()
  const receiver = await receiverCtx.newPage()

  const message =
    'Meeting link: https://example.com/room/42\nCode: 7-otter-anvil 🔐'

  await sender.goto('/')
  await sender.getByTestId('mode-text').click()
  await sender.getByTestId('text-input').fill(message)
  await sender.getByTestId('send-text').click()

  const link = await sender
    .getByTestId('pairing-link')
    .textContent({ timeout: 15_000 })
  if (!link) throw new Error('no pairing link appeared')

  await receiver.goto(link)
  await expect(receiver.getByTestId('accept')).toBeVisible({ timeout: 20_000 })
  await receiver.getByTestId('accept').click()

  const received = receiver.getByTestId('received-text')
  await expect(received).toBeVisible({ timeout: 30_000 })
  expect(await received.textContent()).toBe(message)

  await senderCtx.close()
  await receiverCtx.close()
})

test('home renders in both themes and mobile', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /send a file/i }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/home-a.png', fullPage: true })

  // Flip the theme (default follows the OS) and confirm the toggle applies.
  const toggle = page.getByRole('button', { name: /switch to/i })
  const before = await toggle.getAttribute('aria-label')
  await toggle.click()
  await expect(toggle).not.toHaveAttribute('aria-label', before ?? '')
  await page.screenshot({ path: 'test-results/home-b.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/home-mobile.png',
    fullPage: true,
  })
})
