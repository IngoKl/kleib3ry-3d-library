import { between, mulberry32 } from '../lib/rng'
import type { Bounds, Solid } from './derive'
import { GROUND_Y, LAKE, PATH, TRAIL_WIDTH, lakeRadius, onTrail } from './terrain'

/**
 * The forest, as data.
 *
 * It used to be generated inside `Outside.tsx`, which was right for as long as
 * it was scenery — "nothing here is collidable either: you cannot get out of
 * the cabin except onto the porch". You can now, so a tree has to be something
 * you walk into rather than through, and a collider derived from a different
 * random seed than the trunk you can see would be worse than no collider at
 * all. One list, grown once, read by the renderer and by the walk controller.
 */

/**
 * Three species rather than one cone. A forest of identical lollipops is what
 * reads as cheap: a fir is a stack of skirts, a pine is a bare trunk with its
 * crown held high, and a birch is a pale stem with a rounded head that breaks
 * up all that conifer green.
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

export const TREE_COUNT = 420

/** Nothing grows this close to the buildings. */
export const CLEARING = 4.5

/** Where a species' trunk ends and its foliage begins, as fractions of height. */
export const PROPORTIONS: Record<Species, { trunk: number; canopyFrom: number; girth: number }> = {
  fir: { trunk: 0.4, canopyFrom: 0.1, girth: 0.16 },
  pine: { trunk: 0.78, canopyFrom: 0.5, girth: 0.13 },
  birch: { trunk: 0.6, canopyFrom: 0.38, girth: 0.09 },
}

/**
 * True where a tree would be standing in the lake, on the shore path, on the
 * trail between the buildings, in the view from the north windows, or in the
 * kitchen.
 *
 * The two paths are the reason this is a function rather than a rectangle test.
 * A walk round the water is only a walk if the trees leave room for it: grown
 * without this, the ring of ground just above the beach is exactly where the
 * tree line is densest, and "walk around the pond" becomes a hundred metres of
 * squeezing between trunks. The trail to the lake house is the same argument
 * over a straighter line — and it is cleared a little wider than it is drawn,
 * so the walk has shoulders rather than trunks at the verge.
 */
export function occupied(x: number, z: number, keepOut: readonly Bounds[]): boolean {
  const r = lakeRadius(x, z)
  if (r < PATH.to) return true
  if (onTrail(x, z, TRAIL_WIDTH)) return true
  // The sight-line from the north windows down to the water.
  if (z < LAKE.viewFrom && Math.abs(x - LAKE.x) < LAKE.viewX) return true
  for (const box of keepOut) {
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) return true
  }
  return false
}

export function growForest(keepOut: readonly Bounds[]): Tree[] {
  const random = mulberry32(0x5eed)
  const trees: Tree[] = []

  // Rejection sampling in a ring: uniform in the annulus, thinned near the
  // clearing so the tree line reads as an edge rather than as a wall.
  for (let i = 0; i < TREE_COUNT * 6 && trees.length < TREE_COUNT; i++) {
    const angle = random() * Math.PI * 2
    const distance = 8 + Math.sqrt(random()) * 92
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    if (occupied(x, z, keepOut)) continue
    if (distance < 16 && random() > (distance - 8) / 12) continue

    // Mostly firs, a scatter of taller pines above the canopy line, and
    // birches — shorter, paler — filling in at the front where you can see
    // them from the windows.
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
 * A tree you walk into: the trunk, and only the trunk.
 *
 * A fir carries its lowest skirt at knee height and pushing through branches is
 * what walking in a forest is; being stopped a metre short of a trunk by
 * foliage is not. So the collider is the stem, sized from the same girth the
 * renderer scales the trunk cylinder by.
 *
 * The top is floored at head height so that a young birch — trunk 2.4 m, half
 * of it below your shoulders — is still something you cannot walk through: a
 * solid is filtered out of the walk entirely once its top is under your feet.
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
