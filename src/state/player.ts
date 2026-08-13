/**
 * Player pose, kept outside React because it changes every frame. The HUD and
 * the smoke tests read it; only the controller writes it.
 */
export const player = {
  x: 0,
  z: 2.1,
  yaw: 0,
  pitch: 0,
  /** Metres per second, for head bob and the HUD. */
  speed: 0,
  /** Current eye height, in world metres. Includes whichever floor you are on. */
  eye: 1.68,
  /**
   * Height of the floor under your feet. Zero everywhere until a library has a
   * loft; the walk controller will not let it change by more than a step
   * without a staircase to do it on.
   */
  floor: 0,
  /** 0 standing, 1 fully down. Kept here so the HUD can read it. */
  crouch: 0,
  /**
   * How far the view is zoomed in, 0 to 1, and the field of view that produces.
   *
   * Here rather than in the store for the usual reason: it changes every frame
   * while you are squinting at a spine across the room, and a React render per
   * frame is exactly what `state/player.ts` exists to avoid. The HUD reads it to
   * say so, and the smoke tests read it to prove it moved.
   */
  zoom: 0,
  fov: 72,
  /**
   * `performance.now()` before which the coffee is still working: the walk
   * controller reads it every frame and steps a quarter quicker until it
   * passes. Here rather than in the store because nothing should re-render
   * when a stimulant wears off.
   */
  boostUntil: 0,
}

export const EYE_HEIGHT = 1.68
/**
 * Kneeling. Low enough to read the bottom shelf comfortably — the lowest
 * compartment starts at about 0.1 m, and a spine there is unreadable from a
 * standing eye line no matter how close you get.
 */
export const KNEEL_HEIGHT = 0.92
/** Seat height plus a seated torso, for an armchair. */
export const SEATED_EYE = 1.14
export const PLAYER_RADIUS = 0.28

export function teleport(x: number, z: number, yaw = player.yaw, floor?: number) {
  player.x = x
  player.z = z
  player.yaw = yaw
  if (floor !== undefined) {
    player.floor = floor
    player.eye = floor + EYE_HEIGHT
  }
}
