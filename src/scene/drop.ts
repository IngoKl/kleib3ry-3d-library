import type { BookDimensions } from '../data/dimensions'
import { supportAt, type DerivedWorld } from '../world/derive'

/**
 * Books falling, and being kicked about the floor.
 *
 * The standing decision not to use a physics engine still holds — a wasm
 * runtime would cost the desktop CSP its `wasm-unsafe-eval` exemption, and a
 * solver would be running every frame for a handful of paperbacks. What is
 * actually wanted is much smaller than rigid-body dynamics: a dropped book
 * should fall, land flat, stop, and shift when you walk into it. That is
 * gravity, a support height, and a shove, which is what this is.
 *
 * Everything a shelved or boxed book does is still *derived* from an ordering —
 * see `shelving.ts` and `boxes.ts`. This is the one place in the app where a
 * book's position is a stored number, because "on the rug, where I dropped it"
 * cannot be derived from anything else.
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
 * Bodies thrown this frame, waiting for the renderer to adopt them.
 *
 * The store's placement is just a point — it has nowhere to carry a velocity —
 * so a drop used to arrive in `LooseBooks` looking exactly like a saved resting
 * placement and was seeded asleep, leaving the book hanging where your hand
 * was. The throw parks its full body here and the simulation picks it up.
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
 * The simulation's own clock.
 *
 * Falling used to advance by one clamped frame per frame, which quietly made
 * gravity a function of the frame rate: at sixty frames a second a dropped book
 * landed at once, and on the software rasteriser the tests run on — a frame or
 * two a second — the same book took most of a minute to come down, because each
 * frame bought it a thirtieth of a second of falling.
 *
 * So the step is fixed and a slow frame runs several of them. The catch-up is
 * capped rather than unbounded: after a long stall (a tab in the background, a
 * shader compiling) it is better for a book to fall a fifth of a second's worth
 * and carry on next frame than to teleport through a table because one step
 * covered two metres.
 */
const FIXED_STEP = 1 / 90
const MAX_CATCH_UP = 0.2

/**
 * One frame of falling, however long that frame was.
 *
 * `thickness` is how far the book's centre sits above whatever it is lying on.
 * A resting body is returned unchanged and untouched, which is what keeps a
 * room full of dropped books free once they have settled.
 */
export function stepBody(body: Body, thickness: number, dt: number, support: Support): Body {
  if (body.resting) return body

  const elapsed = Math.min(Math.max(dt, 0), MAX_CATCH_UP)
  const count = Math.max(1, Math.ceil(elapsed / FIXED_STEP))
  const step = elapsed / count

  let out = body
  for (let i = 0; i < count && !out.resting; i++) out = advance(out, thickness, step, support)
  return out
}

/** One fixed step. Everything about the physics lives here; `stepBody` is the clock. */
function advance(body: Body, thickness: number, step: number, support: Support): Body {
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

  // Where the floor — or the table it is over — is, measured from just above
  // the book so it lands on the surface it is falling towards rather than on
  // one it has already passed through.
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

/**
 * Shove a book out from under someone's feet.
 *
 * Walking into things is the only force in the room besides gravity, and it is
 * what makes a pile on the floor feel like it is in the way rather than
 * painted on. The push is horizontal only: nobody kicks a book into the air.
 */
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
  // Standing exactly on it: pick a direction rather than dividing by zero.
  const nx = distance < 1e-4 ? 1 : dx / distance
  const nz = distance < 1e-4 ? 0 : dz / distance
  const strength = Math.min(1.6, speed * 0.55 + 0.25)

  return {
    ...body,
    x: from.x + nx * radius,
    z: from.z + nz * radius,
    vx: nx * strength,
    vz: nz * strength,
    spin: (nx - nz) * 0.9,
    resting: false,
  }
}

/**
 * Where a book leaves your hands: a little way in front of you, at chest
 * height, with the speed you were walking at added so that dropping one while
 * running throws it ahead of you.
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
