/**
 * Frame-rate-independent smoothing. Use this rather than a fraction per frame,
 * which settles at a different speed on every machine and snaps hard on the
 * software rasteriser. `rate` is e-foldings per second.
 */
export const approach = (rate: number, delta: number) => 1 - Math.exp(-rate * delta)

/** The short way round: 350° to 10° is a twenty-degree turn, not a 340° one. */
export function shortestTurn(angle: number): number {
  let turn = angle % (Math.PI * 2)
  if (turn > Math.PI) turn -= Math.PI * 2
  if (turn < -Math.PI) turn += Math.PI * 2
  return turn
}
