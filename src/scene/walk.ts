import { aabbFromCentre, resolveMove, type Aabb, type Point } from './collision'
import { STEP_UP, floorAt, type DerivedWorld, type Solid } from '../world/derive'
import { shelfColliders } from '../world/shelf'

/**
 * Walking in a building with more than one floor. The sliding maths is the
 * axis-separated AABB in `collision.ts`; what a loft adds is a second question —
 * what am I standing on, and is it within a step of what I was on.
 *
 * Answered here rather than in the controller so it tests without a browser. One
 * check prevents both walking off the loft and walking up a wall; a staircase
 * allows a bigger climb by being a floor that ramps.
 */
export type Stance = Point & { floor: number }

/**
 * Everything a body can hit. Door state is ambience, which the static derivation
 * does not know, so callers rebuild on a toggle — an edit, not a frame cost. One
 * list, so the player and a thrown book agree about what is solid.
 */
export function worldSolids(world: DerivedWorld, ambienceOn: Record<string, boolean>): Solid[] {
  const doors = world.furniture
    .filter((item) => item.kind === 'door' && !(ambienceOn[item.id] ?? (item.on ?? true)))
    .map((door) => ({
      ...aabbFromCentre(door.x, door.z, door.width, 0.16, door.rotationY),
      bottom: door.y,
      top: door.y + door.height,
    }))
  return [...world.solids, ...shelfColliders(world.shelves), ...doors]
}

/** The solids that can block someone standing at `floor`, flattened to 2D. */
export function solidsAt(solids: readonly Solid[], floor: number, headroom = 1.7): Aabb[] {
  const feet = floor + 0.1
  const head = floor + headroom
  const out: Aabb[] = []
  for (const solid of solids) {
    if (solid.top > feet && solid.bottom < head) out.push(solid)
  }
  return out
}

/** True if `to` is somewhere you could actually be standing, given where you are. */
function landing(world: DerivedWorld, to: Point, floor: number): number | null {
  const y = floorAt(world, to.x, to.z, floor)
  if (y === null) return null
  // Down as well as up: the drop off a loft edge is not a step, it is a fall,
  // and the cheapest way not to have to model falling is not to allow it.
  return Math.abs(y - floor) <= STEP_UP ? y : null
}

/**
 * Slide along whatever is in the way, then refuse any part of the move that
 * would leave you standing on nothing. The axes retry separately, as in
 * `resolveMove`: a stairwell edge should slide you along rather than stop you.
 */
export function stepPlayer(
  world: DerivedWorld,
  solids: readonly Solid[],
  from: Stance,
  to: Point,
  radius: number,
): Stance {
  const boxes = solidsAt(solids, from.floor)
  const slid = resolveMove(from, to, radius, boxes)

  const whole = landing(world, slid, from.floor)
  if (whole !== null) return { x: slid.x, z: slid.z, floor: whole }

  const onlyX = { x: slid.x, z: from.z }
  const alongX = landing(world, onlyX, from.floor)
  if (alongX !== null) return { ...onlyX, floor: alongX }

  const onlyZ = { x: from.x, z: slid.z }
  const alongZ = landing(world, onlyZ, from.floor)
  if (alongZ !== null) return { ...onlyZ, floor: alongZ }

  return from
}

/**
 * Put someone down anywhere — a spawn point, or a test teleporting. With no
 * previous floor, the highest within a step of `near` wins, then whatever floor
 * is there at all, so a teleport into the loft lands on the loft.
 */
export function groundAt(world: DerivedWorld, x: number, z: number, near = 0): number {
  return floorAt(world, x, z, near) ?? floorAt(world, x, z, Infinity) ?? 0
}
