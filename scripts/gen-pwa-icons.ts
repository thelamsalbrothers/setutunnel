/**
 * Rasterizes public/pwa-icon.svg into the PNG sizes the web app manifest and
 * iOS need. Run with `bun scripts/gen-pwa-icons.ts` after changing the source
 * SVG. (Not part of the app build.)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const svg = readFileSync(new URL('../public/pwa-icon.svg', import.meta.url))
const publicDir = new URL('../public/', import.meta.url)

const targets: Array<{ file: string; size: number }> = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  const outPath = fileURLToPath(new URL(file, publicDir))
  await sharp(svg).resize(size, size).png().toFile(outPath)
  console.log(`wrote public/${file} (${size}x${size})`)
}
