/**
 * Smoothing that does not depend on the frame rate.
 *
 * Nearly every eased value in the scene was written as
 *
 *     value += (target - value) * Math.min(1, delta * k)
 *
 * which is what everybody writes and is quietly wrong. It is a *fraction per
 * frame*, so the same code settles at a different speed on every machine: at
 * 144 fps it lags, at 30 fps it overshoots the intended curve, and on the
 * software rasteriser the smoke tests run on the clamp fires and every ease in
 * the room becomes a hard snap. A book sliding out of a shelf, the camera coming
 * off a closed page, the cat turning to look at you — all of them were different
 * animations on different hardware.
 *
 * `approach` is the exponential form of the same idea. `rate` is now a real
 * number with units: how many e-foldings a second, so `approach(10, dt)` covers
 * about 63% of the remaining distance in a tenth of a second whatever `dt`
 * happens to be. Nothing else about the call sites changes, and the rates that
 * were already tuned by eye keep meaning roughly what they meant at 60 fps.
 */
export const approach = (rate: number, delta: number) => 1 - Math.exp(-rate * delta)

/**
 * The short way round a circle, in radians.
 *
 * Turning from 350° to 10° is a twenty-degree turn, not a three-hundred-and-forty
 * degree one. Written down once because three things in the scene turn to face
 * something — the cat, your own shoulders, and anything that follows the camera —
 * and each of them had its own pair of while loops.
 */
export function shortestTurn(angle: number): number {
  let turn = angle % (Math.PI * 2)
  if (turn > Math.PI) turn -= Math.PI * 2
  if (turn < -Math.PI) turn += Math.PI * 2
  return turn
}
