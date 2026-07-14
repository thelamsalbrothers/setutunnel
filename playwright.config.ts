import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E (CLAUDE.md §9): the only way to honestly verify the browser-
 * only pieces (WebRTC binding + real DataChannel transfer). Starts the Vite dev
 * server and the Bun signaling server, then drives two Chromium pages through a
 * real encrypted transfer. The mDNS flag exposes loopback ICE candidates so two
 * contexts on the same machine can connect without external STUN.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'bunx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'bun signaling/server.ts',
      url: 'http://localhost:8787/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
