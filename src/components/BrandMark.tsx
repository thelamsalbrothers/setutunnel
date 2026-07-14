/** The SetuTunnel mark: the tunnel glyph alone (mouth + inner arch for depth),
 *  no tile, no wordmark — the mark is the brand. On hover it lights up: a soft,
 *  blurry violet glow blooms behind the glyph. */
export function BrandMark() {
  return (
    <div
      className="group relative flex items-center"
      role="img"
      aria-label="SetuTunnel"
    >
      {/* Soft bloom — a blurred violet disc that fades in behind the mark. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/50 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100"
      />
      <svg
        viewBox="0 0 24 24"
        className="relative h-9 w-9 transform-gpu text-primary transition-transform duration-300 ease-out will-change-transform group-hover:scale-[1.08]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.5 20V12a8.5 8.5 0 0 1 17 0v8" />
        <path d="M9 20v-7.5a3 3 0 0 1 6 0V20" opacity="0.5" />
      </svg>
    </div>
  )
}
