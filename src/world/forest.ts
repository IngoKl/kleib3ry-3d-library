import { between, mulberry32 } from '../lib/rng'
import type { Bounds, Solid } from './derive'
import {
  GROUND_Y,
  LAKE,
  PATH,
  TRAIL_WIDTH,
  WALK_RADIUS,
  alongStream,
  inVista,
  lakeRadius,
  mountainHeight,
  onTrail,
  underCable,
} from './terrain'

/**
 * The forest, as data. Here rather than in `Outside.tsx` because a tree is
 * something you walk into: a collider grown from a different seed than the
 * trunk you can see is worse than no collider. One list, read by both.
 */

/**
 * Three species rather than one cone, because identical lollipops read as cheap:
 * a fir is stacked skirts, a pine holds its crown high, a birch breaks the green.
 */
export type Species = 'fir' | 'pine' | 'birch'

export type Tree = {
  x: number
  z: number
  height: number
  spread: number
  tint: number
  /** Random turn about Y, so the low-poly facets do not all face the cabin. */
  yaw: number
  species: Species
}

export const TREE_COUNT = 520

/** Nothing grows this close to the buildings. */
export const CLEARING = 4.5

/** Where a species' trunk ends and its foliage begins, as fractions of height. */
export const PROPORTIONS: Record<Species, { trunk: number; canopyFrom: number; girth: number }> = {
  fir: { trunk: 0.4, canopyFrom: 0.1, girth: 0.16 },
  pine: { trunk: 0.78, canopyFrom: 0.5, girth: 0.13 },
  birch: { trunk: 0.6, canopyFrom: 0.38, girth: 0.09 },
}

/**
 * Where a tree may not stand: the water, the paths, the view from the north
 * windows, or a room. The paths are why this is a function rather than a
 * rectangle test — the ring above the beach is where the tree line is densest,
 * and both are cleared wider than they are drawn so the walk has shoulders.
 */
export function occupied(x: number, z: number, keepOut: readonly Bounds[]): boolean {
  const r = lakeRadius(x, z)
  if (r < PATH.to) return true
  if (onTrail(x, z, TRAIL_WIDTH)) return true
  // The brook, with a verge each side: a stream seen only between trunks is one
  // nobody knows is there, and the bank is where you walk beside it.
  if (alongStream(x, z, 1.7)) return true
  // The sight-line from the north windows, stopping at the lake so the tree
  // line closes behind the far shore rather than opening onto a plain.
  if (z < LAKE.viewFrom && z > LAKE.z && Math.abs(x - LAKE.x) < LAKE.viewX) return true
  // The mountains: a tree planted at ground height on a slope floats or drowns.
  if (mountainHeight(x, z) > 0.05) return true
  // The cable car's corridor, so nothing grows up into the line.
  if (underCable(x, z, 2.5)) return true
  // The lookout's sight-fan down to the water, for the same reason as the
  // north windows' corridor: a view somebody built a platform for stays open.
  if (inVista(x, z)) return true
  for (const box of keepOut) {
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) return true
  }
  return false
}

export function growForest(keepOut: readonly Bounds[]): Tree[] {
  const random = mulberry32(0x5eed)
  const trees: Tree[] = []

  // Rejection sampling in a ring, thinned near the clearing so the tree line
  // reads as an edge rather than a wall. Sown past where the walk stops.
  for (let i = 0; i < TREE_COUNT * 6 && trees.length < TREE_COUNT; i++) {
    const angle = random() * Math.PI * 2
    const distance = 8 + Math.sqrt(random()) * (WALK_RADIUS - 4)
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    if (occupied(x, z, keepOut)) continue
    if (distance < 16 && random() > (distance - 8) / 12) continue

    // Mostly firs, a scatter of pines above the canopy, and paler birches
    // filling in at the front where the windows see them.
    const roll = random()
    const species: Species = roll < 0.55 ? 'fir' : roll < 0.8 ? 'pine' : 'birch'
    const height =
      species === 'pine'
        ? between(random, 9, 17)
        : species === 'fir'
          ? between(random, 5.5, 14)
          : between(random, 4, 8)
    const spread =
      species === 'pine'
        ? between(random, 0.9, 1.6)
        : species === 'fir'
          ? between(random, 1.0, 2.1)
          : between(random, 1.3, 2.3)

    trees.push({
      x,
      z,
      height,
      spread,
      tint: Math.floor(random() * 4),
      yaw: random() * Math.PI * 2,
      species,
    })
  }

  return trees
}

/**
 * The trunk, and only the trunk: pushing through branches is what walking in a
 * forest is, and being stopped a metre short by foliage is not. The top is
 * floored at head height, or a young birch's solid sits under your feet and is
 * filtered out of the walk entirely.
 */
export function treeSolids(trees: readonly Tree[]): Solid[] {
  return trees.map((tree) => {
    const radius = tree.spread * PROPORTIONS[tree.species].girth
    const trunk = tree.height * PROPORTIONS[tree.species].trunk
    return {
      minX: tree.x - radius,
      maxX: tree.x + radius,
      minZ: tree.z - radius,
      maxZ: tree.z + radius,
      bottom: GROUND_Y,
      top: GROUND_Y + Math.max(2.1, trunk),
    }
  })
}
