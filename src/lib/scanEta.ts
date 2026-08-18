/**
 * How long a scan has left, from how far it has got. A plain ratio on purpose:
 * the pace swings with file size, so anything cleverer is still a guess and
 * this one is legible.
 */
export function etaMs(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0 || total <= 0 || done >= total || elapsedMs <= 0) return null
  return (elapsedMs / done) * (total - done)
}

/** The estimate in words, as rough as the number it comes from. */
export function describeEta(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 10) return 'a few seconds left'
  if (seconds < 90) return 'about a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `about ${hours} h ${rest} min left` : `about ${hours} h left`
}
