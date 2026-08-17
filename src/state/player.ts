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
  /** The walk controller will not change it by more than a step without a staircase. */
  floor: 0,
  /** 0 standing, 1 fully down. Kept here so the HUD can read it. */
  crouch: 0,
  /**
   * How far the view is zoomed, and the field of view that produces. Here rather
   * than in the store because it changes every frame while you squint at a spine.
   */
  zoom: 0,
  fov: 72,
  /**
   * Until when the coffee is still working. Here rather than in the store,
   * because nothing should re-render when a stimulant wears off.
   */
  boostUntil: 0,
}

export const EYE_HEIGHT = 1.68
/** Low enough for the bottom shelf, which is unreadable from a standing eye line. */
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
