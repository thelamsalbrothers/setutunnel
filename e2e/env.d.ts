// Globals the E2E harness (`e2e/harness.ts`) exposes on `window` for the
// Playwright spec to read via `page.evaluate`. Shared by both files.
export {}

declare global {
  interface Window {
    __setu: {
      createRoom(): Promise<{ roomId: string; secretHex: string }>
      joinAndSend(
        roomId: string,
        secretHex: string,
        text: string,
      ): Promise<{ sas: string; sentHash: string }>
    }
    __recvHash?: Promise<string>
    __sas?: Promise<string>
    __error?: string
    // Set by the File System Access streaming test's stubbed showSaveFilePicker.
    __setuChunks?: number[][]
    __setuClosed?: boolean
  }
}
