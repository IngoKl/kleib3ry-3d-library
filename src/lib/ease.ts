/**
 * Frame-rate-independent smoothing. Use this, not
 * `value += (target - value) * Math.min(1, delta * k)`, which is a fraction
 * *per frame* and so settles at a different speed on every machine — and snaps
 * hard on the software rasteriser the smoke tests run on.
 *
 * `rate` is e-foldings per second: `approach(10, dt)` covers about 63% of the
 * remaining distance in a tenth of a second, whatever `dt` is.
 */
export const approach = (rate: number, delta: number) => 1 - Math.exp(-rate * delta)

/**
 * The short way round a circle, in radians: 350° to 10° is a twenty-degree
 * turn, not a three-hundred-and-forty degree one.
 */
export function shortestTurn(angle: number): number {
  let turn = angle % (Math.PI * 2)
  if (turn > Math.PI) turn -= Math.PI * 2
  if (turn < -Math.PI) turn += Math.PI * 2
  return turn
}
