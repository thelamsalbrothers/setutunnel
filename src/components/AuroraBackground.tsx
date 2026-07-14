/** Flat backdrop with a whisper-faint grid — no glow, shadcn-clean. */
export function AuroraBackground() {
  return (
    <div
      aria-hidden="true"
      className="setu-grid pointer-events-none fixed inset-0 -z-10"
    />
  )
}
