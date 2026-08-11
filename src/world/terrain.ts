/**
 * The site the building stands on: ground, water, and where the ground runs out.
 *
 * This exists because the outdoors stopped being scenery. It used to be enough
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
