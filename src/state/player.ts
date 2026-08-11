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
  /** Current eye height. Moves between standing, kneeling and sitting. */
  eye: 1.68,
  /** 0 standing, 1 fully down. Kept here so the HUD can read it. */
  crouch: 0,
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

export function teleport(x: number, z: number, yaw = player.yaw) {
  player.x = x
  player.z = z
  player.yaw = yaw
}
