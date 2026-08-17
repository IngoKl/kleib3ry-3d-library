import type { BookDimensions } from '../data/dimensions'
import { supportAt, type DerivedWorld } from '../world/derive'

/**
 * Books falling and being kicked about: gravity, a support height and a shove,
 * not a physics engine — a wasm runtime would cost the desktop CSP its
 * `wasm-unsafe-eval` exemption. The one place a book's position is stored rather
 * than derived from an ordering.
 */

export type Body = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  /** Radians per second about Y, so a thrown book turns as it goes. */
  spin: number
  /** True once it has stopped moving. Asleep bodies cost nothing per frame. */
  resting: boolean
}

const GRAVITY = 9.81
/** How much speed survives a landing. Paper does not bounce much. */
const RESTITUTION = 0.18
/** Sliding friction while in contact with the floor, per second. */
const FRICTION = 6.5
const AIR_DRAG = 0.4
/** Below this, in metres per second, a book is simply lying there. */
const SLEEP_SPEED = 0.06

export type Support = (x: number, z: number, from: number) => number

/**
 * Whether a point is inside something solid. Optional: kicked books are slow
 * enough not to need it, thrown ones sail into the next room without it.
 */
export type Blocked = (x: number, y: number, z: number) => boolean

/**
 * Bodies thrown this frame, waiting to be adopted. A stored placement is only a
 * point with nowhere to carry a velocity, so without this a throw arrives
 * indistinguishable from a resting placement and is seeded asleep in mid-air.
 */
const launched = new Map<string, Body>()

export function launchBody(id: string, body: Body) {
  launched.set(id, body)
}

export function takeLaunchedBody(id: string): Body | undefined {
  const body = launched.get(id)
  if (body) launched.delete(id)
  return body
}

/** The world's own answer to "what is under this point", curried for the step. */
export const supportFrom = (world: DerivedWorld): Support => (x, z, from) =>
  supportAt(world, x, z, from)

/**
 * A fixed step, with a slow frame running several, so gravity is not a function
 * of frame rate — the tests run at a frame or two a second. Catch-up is capped,
 * or a long stall teleports a book through a table in one step.
 */
const FIXED_STEP = 1 / 90
const MAX_CATCH_UP = 0.2

/**
 * One frame of falling, however long it was. A resting body is returned
 * untouched, so a room full of settled books costs nothing.
 */
export function stepBody(
  body: Body,
  thickness: number,
  dt: number,
  support: Support,
  blocked?: Blocked,
): Body {
  if (body.resting) return body

  const elapsed = Math.min(Math.max(dt, 0), MAX_CATCH_UP)
  const count = Math.max(1, Math.ceil(elapsed / FIXED_STEP))
  const step = elapsed / count

  let out = body
  for (let i = 0; i < count && !out.resting; i++) out = advance(out, thickness, step, support, blocked)
  return out
}

/** One fixed step. The physics lives here; `stepBody` is only the clock. */
function advance(
  body: Body,
  thickness: number,
  step: number,
  support: Support,
  blocked?: Blocked,
): Body {
  const next: Body = { ...body }

  next.vy -= GRAVITY * step
  const drag = Math.max(0, 1 - AIR_DRAG * step)
  next.vx *= drag
  next.vz *= drag

  next.x += next.vx * step
  next.y += next.vy * step
  next.z += next.vz * step
  next.yaw += next.spin * step
  next.spin *= Math.max(0, 1 - 3 * step)

  // A step into something solid is refused sideways and the book drops where it
  // hit. One released already inside something is let fly clear instead.
  if (blocked && blocked(next.x, next.y, next.z) && !blocked(body.x, body.y, body.z)) {
    next.x = body.x
    next.z = body.z
    next.vx = 0
    next.vz = 0
    next.spin = 0
  }

  // Measured from just above the book, so it lands on the surface it is falling
  // towards rather than one it has already passed through.
  const rest = support(next.x, next.z, body.y + thickness) + thickness / 2

  if (next.y <= rest) {
    next.y = rest
    if (next.vy < -0.4) {
      next.vy = -next.vy * RESTITUTION
    } else {
      next.vy = 0
      const slow = Math.max(0, 1 - FRICTION * step)
      next.vx *= slow
      next.vz *= slow
      next.spin *= slow
      if (Math.hypot(next.vx, next.vz) < SLEEP_SPEED) {
        next.vx = 0
        next.vz = 0
        next.spin = 0
        next.resting = true
      }
    }
  }

  return next
}

/** Shove a book out from under someone's feet. Horizontal only. */
export function shove(
  body: Body,
  from: { x: number; z: number },
  radius: number,
  speed: number,
): Body {
  const dx = body.x - from.x
  const dz = body.z - from.z
  const distance = Math.hypot(dx, dz)
  if (distance > radius) return body
  // Standing exactly on it: pick a direction rather than divide by zero.
  const nx = distance < 1e-4 ? 1 : dx / distance
  const nz = distance < 1e-4 ? 0 : dz / distance
  const strength = Math.min(1.6, speed * 0.55 + 0.25)

  // A velocity, not a teleport: jumping to the player-circle boundary puts
  // books inside walls in one frame. The kick reapplies until it is clear.
  return {
    ...body,
    vx: nx * strength,
    vz: nz * strength,
    spin: (nx - nz) * 0.9,
    resting: false,
  }
}

/**
 * Where a book leaves your hands: in front, at chest height, carrying your
 * walking speed so dropping one while running throws it ahead.
 */
export function throwFrom(
  pose: { x: number; z: number; yaw: number; eye: number; speed: number },
  dimensions: BookDimensions,
  gentle: boolean,
): Body {
  const forwardX = -Math.sin(pose.yaw)
  const forwardZ = -Math.cos(pose.yaw)
  const push = gentle ? 0.5 : 1.6 + pose.speed * 0.4

  return {
    x: pose.x + forwardX * 0.45,
    y: pose.eye - 0.35 + dimensions.thickness / 2,
    z: pose.z + forwardZ * 0.45,
    vx: forwardX * push,
    vy: gentle ? -0.1 : 0.4,
    vz: forwardZ * push,
    // Laid down square when placed gently, tumbling when thrown.
    yaw: pose.yaw + (gentle ? 0 : 0.35),
    spin: gentle ? 0 : 2.2,
    resting: false,
  }
}
