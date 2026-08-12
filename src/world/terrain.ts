/**
 * The site the building stands on: ground, water, and where the ground runs out.
 *
 * The outdoors is not scenery: you walk on it. It would be enough
 * for `Outside.tsx` to own the lake, since nothing but the camera could ever
 * reach it and the porch railing was the edge of the world. Now you can walk
 * out of the porch and round the water, which means two things that were one
 * thing have to agree: what the lake *looks* like and where the lake *is*. So
 * the geometry lives here, in the world layer, and the renderer reads it —
 * rather than the walk controller having to guess at numbers in a scene file.
 *
 * Everything here is a constant rather than a field in `library.json`. The
 * document describes a *building*; the valley it sits in is not something you
 * lay out room by room, and inventing a terrain schema to hold four ellipse
 * radii would be a format to maintain for no decision anybody wants to make.
 */

/**
 * The three sheets, in the order they stack. Water above sand above grass,
 * centimetres apart, rather than a hole cut in the ground for a lake nobody
 * swims in — the same trick as before, but with the gaps closed up now that you
 * can stand at the shore and look down at them. At 1.5 cm they read as water
 * lapping a beach; at the old 6 cm they read as three floating discs.
 */
export const GROUND_Y = -0.24
export const SHORE_Y = -0.225
export const WATER_Y = -0.21

/**
 * How far the ground reaches before the fog has swallowed it anyway, and how
 * far you are allowed to walk.
 *
 * The walkable radius is deliberately well inside the visible one. At 96 m the
 * fog is dense enough that the refusal reads as "the forest goes on" rather
 * than as a wall — which is the cheapest honest end to a world whose point is a
 * cabin, not a continent.
 */
export const GROUND_RADIUS = 150
export const WALK_RADIUS = 96

/**
 * The lake.
 *
 * `viewX` and `viewFrom` are the corridor of cleared ground running north from
 * the cabin. Without it the north window looks at the backs of forty trees and
 * the whole point of siting the cabin here is lost.
 */
export const LAKE = {
  x: -4,
  z: -34,
  radiusX: 34,
  radiusZ: 21,
  viewX: 15,
  viewFrom: -6,
} as const

/**
 * How far a point is from the middle of the lake, in units of shoreline: below
 * 1 is water, 1 is the water's edge, above 1 is dry land.
 *
 * An ellipse rather than a distance because the lake is an ellipse, and the
 * whole reason this function exists is that the shore you walk to has to be the
 * shore you can see.
 */
export function lakeRadius(x: number, z: number): number {
  const lx = (x - LAKE.x) / LAKE.radiusX
  const lz = (z - LAKE.z) / LAKE.radiusZ
  return Math.hypot(lx, lz)
}

/**
 * Where the sand ends, in shoreline units — so the beach is the ring between
 * the water's edge at 1 and this. The rendered shore ring is scaled to match.
 */
export const SHORE_EDGE = 1.078

/**
 * The path round the water: a ring of cleared ground just above the beach.
 *
 * It is defined in shoreline units rather than metres so that it follows the
 * lake round instead of cutting corners off it, and it is what the forest is
 * grown around — a walk round the pond is a walk the trees leave room for, not
 * a walk you win by weaving between trunks.
 */
export const PATH = { from: SHORE_EDGE, to: 1.34 } as const

export const onPath = (x: number, z: number): boolean => {
  const r = lakeRadius(x, z)
  return r >= PATH.from && r <= PATH.to
}

/**
 * The one made path on the site: from the cabin's porch steps, round the back of
 * the reading corner and west along the slope to the lake house.
 *
 * A polyline rather than anything derived, for the same reason the lake is an
 * ellipse rather than a field in `library.json`: a second building is something
 * the document can describe, but the *route* between two of them is a fact about
 * this valley — which side of the reading corner you go round, where the ground
 * is walkable — and there is no decision in it anybody wants to restate.
 *
 * Read twice, like everything else out here: `Outside` draws it, and the forest
 * is grown around it. A trail with trees standing in it is a clearing you have
 * to weave through, which is not a trail.
 */
export const TRAIL: readonly (readonly [number, number])[] = [
  [2.6, 8.9],
  [-1.5, 8.6],
  [-7.0, 6.5],
  [-12.5, 4.0],
  [-16.5, 0.5],
  [-19.5, -1.5],
  [-20.6, -2.2],
]

/** How wide the trodden ground is. Two abreast, which is what a path is. */
export const TRAIL_WIDTH = 1.6

/** Distance from a point to a segment, in plan. */
function toSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const length = dx * dx + dz * dz
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

/** True on the trodden ground, within `margin` of the centre line. */
export function onTrail(x: number, z: number, margin = TRAIL_WIDTH / 2): boolean {
  for (let i = 1; i < TRAIL.length; i++) {
    const [ax, az] = TRAIL[i - 1]!
    const [bx, bz] = TRAIL[i]!
    if (toSegment(x, z, ax, az, bx, bz) <= margin) return true
  }
  return false
}

/**
 * The height of the ground under a point, or null where there is no ground to
 * stand on — in the water, or past the edge of the world.
 *
 * Null rather than a number is what `floorAt` needs to refuse a step, and it is
 * the same answer a stairwell gives: nothing here, do not walk into it.
 */
export function terrainAt(x: number, z: number): number | null {
  if (Math.hypot(x, z) > WALK_RADIUS) return null
  // The beach is dry land and you walk on it; the water is not. Stopped a
  // whisker short of the edge rather than exactly on it, so you finish standing
  // on sand looking at the lake rather than ankle-deep in it.
  if (lakeRadius(x, z) < 1.004) return null
  return GROUND_Y
}
