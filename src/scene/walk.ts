import { aabbFromCentre, resolveMove, type Aabb, type Point } from './collision'
import { STEP_UP, floorAt, type DerivedWorld, type Solid } from '../world/derive'
import { shelfColliders } from '../world/shelf'

/**
 * Walking, once a library has more than one floor.
 *
 * The sliding maths is still the axis-separated AABB in `collision.ts` — no
 * physics engine, no wasm, and therefore no `wasm-unsafe-eval` in the desktop
 * CSP. What a loft adds is a third question on top of "did I hit something":
 * *what am I standing on now*, and is it near enough to the thing I was
 * standing on a moment ago to have stepped onto it.
 *
 * That question is answered here rather than in the controller so it can be
 * tested without a browser, and so the two failure modes it exists to prevent
 * are written down in one place:
 *
 *   - walking off the loft into thin air, and
 *   - walking *up* a wall because the floor above happened to be in range.
 *
 * Both are the same check: a move is only allowed if the floor under where you
 * are going is within a step of the floor you are on. A staircase is what makes
 * a bigger climb possible, and it does it by being a floor that ramps.
 */
export type Stance = Point & { floor: number }

/**
 * Everything a body can hit: the derived walls and furniture, the bookcase
 * carcasses, and whichever doors are shut. Door state is ambience, which the
 * static derivation deliberately does not know — callers rebuild on it, and a
 * swing is an edit, so that is cheap. One list, so the player, a thrown book
 * and anything else that collides all agree about what is solid.
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
 * One step of walking: slide along whatever is in the way, then refuse any part
 * of the move that would leave you standing on nothing.
 *
 * The two axes are retried separately for the same reason `resolveMove` tries
 * them separately — walking along the edge of a stairwell should slide you
 * along it rather than stopping you dead.
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
 * Put someone down at a position that may be anywhere — a spawn point, or a
 * test teleporting across the room. There is no previous floor to step from, so
 * the highest floor within a step of `near` wins; failing that, whatever floor
 * is there at all, so a teleport into the loft lands on the loft rather than
 * falling back to nothing.
 */
export function groundAt(world: DerivedWorld, x: number, z: number, near = 0): number {
  return floorAt(world, x, z, near) ?? floorAt(world, x, z, Infinity) ?? 0
}
