import { defineConfig } from 'vitest/config'

// Crypto/protocol/transport are pure and framework-agnostic (CLAUDE.md §8),
// so unit tests run in a plain Node environment with Web Crypto available
// on the global `crypto` object (Node 20+). No React/DOM plugins needed here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
