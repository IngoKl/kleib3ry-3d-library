/**
 * The site the building stands on: ground, water, and where the ground runs out.
 *
 * The outdoors is walkable, so the geometry lives in the world layer and both
 * `Outside.tsx` and `floorAt` read it. A shoreline you can see in one place and
 * stand in in another is the bug this arrangement prevents.
 *
 * Constants rather than fields in `library.json`: that document describes a
 * building, not the valley it sits in.
 */

/**
 * The three sheets, in stacking order: water above sand above grass, rather
 * than a hole cut in the ground. Keep the gaps at ~1.5 cm — much more and they
 * read as three floating discs when you stand at the shore.
 */
export const GROUND_Y = -0.24
export const SHORE_Y = -0.225
export const WATER_Y = -0.21

/**
 * The brook's two sheets, 4 mm under the lake's: coplanar surfaces z-fight
 * where the one runs into the other.
 */
export const BROOK_BED_Y = SHORE_Y - 0.004
export const BROOK_WATER_Y = WATER_Y - 0.004

/**
 * How far the ground is drawn, and how far you may walk. The walkable radius
 * sits well inside the visible one so the refusal happens where the fog is
 * dense enough to hide it. Everything else outdoors is derived from these two.
 */
export const GROUND_RADIUS = 176
export const WALK_RADIUS = 118

/**
 * The lake. `viewX` and `viewFrom` are the corridor of cleared ground running
 * north from the cabin, so the north window looks at water and not at trees.
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
 * The wobble that turns the ellipse into a pond: low harmonics on the
 * shoreline, as [lobes, amplitude, phase]. A closed sum of sines rather than
 * noise, so the outline is the same function wherever it is asked. Keep the
 * amplitudes summing to ~0.12 — beyond that the derived rings fold over.
 */
const WOBBLE: readonly (readonly [number, number, number])[] = [
  [2, 0.05, 1.7],
  [3, 0.045, 0.4],
  [5, 0.025, 3.9],
]

/** How far the shoreline is from the lake's middle at `angle`, in ellipse units. */
export function shoreShape(angle: number): number {
  let r = 1
  for (const [lobes, amplitude, phase] of WOBBLE) r += amplitude * Math.sin(lobes * angle + phase)
  return r
}

/**
 * How far a point is from the middle of the lake, in shoreline units: below 1
 * is water, 1 is the water's edge, above 1 is dry land.
 */
export function lakeRadius(x: number, z: number): number {
  const lx = (x - LAKE.x) / LAKE.radiusX
  const lz = (z - LAKE.z) / LAKE.radiusZ
  const raw = Math.hypot(lx, lz)
  if (raw < 1e-9) return 0
  return raw / shoreShape(Math.atan2(lz, lx))
}

/**
 * The point `r` shoreline units out from the lake's middle at `angle`, in world
 * metres. The renderer builds the water and beach from this, and the walk
 * controller refuses steps by it, so the two cannot disagree.
 */
export function lakePoint(angle: number, r: number): [number, number] {
  const reach = r * shoreShape(angle)
  return [
    LAKE.x + Math.cos(angle) * reach * LAKE.radiusX,
    LAKE.z + Math.sin(angle) * reach * LAKE.radiusZ,
  ]
}

/**
 * Where the sand ends, in shoreline units — so the beach is the ring between
 * the water's edge at 1 and this. The rendered shore ring is scaled to match.
 */
export const SHORE_EDGE = 1.078

/**
 * What the ground underfoot is made of, for footstep sounds and materials. The
 * beach ring and the brook's banks are sand; everything else outdoors is grass.
 */
export function groundSurface(x: number, z: number): 'sand' | 'grass' {
  if (lakeRadius(x, z) < SHORE_EDGE) return 'sand'
  return alongStream(x, z, 0.7) ? 'sand' : 'grass'
}

/**
 * The path round the water: a ring of cleared ground just above the beach. In
 * shoreline units rather than metres so it follows the lake instead of cutting
 * corners, and the forest is grown around it.
 */
export const PATH = { from: SHORE_EDGE, to: 1.34 } as const

export const onPath = (x: number, z: number): boolean => {
  const r = lakeRadius(x, z)
  return r >= PATH.from && r <= PATH.to
}

/**
 * From the cabin's porch steps, round the reading corner and west to the lake
 * house. Here rather than in `library.json` because a route between buildings
 * is a fact about the valley, not about either building. Drawn by `Outside` and
 * cleared of trees by `forest.ts`.
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

/**
 * The spur from the lakeside walk down to the camp. Its own polyline, not more
 * points on `TRAIL`: joined up, the renderer draws a leg across the water.
 */
export const CAMP_SPUR: readonly (readonly [number, number])[] = [
  [-4.0, -58.6],
  [-4.2, -62.8],
]

/** Every made path on the site: drawn by `Outside`, cleared by the forest. */
export const TRAILS: readonly (readonly (readonly [number, number])[])[] = [TRAIL, CAMP_SPUR]

/** How wide the trodden ground is. Two abreast, which is what a path is. */
export const TRAIL_WIDTH = 1.6

/**
 * The brook: out of the south-east forest, past the office's east window, down
 * into the lake. Here rather than in `Outside.tsx` because three things must
 * agree about where the water runs — the renderer draws it, the forest is grown
 * around it, and the walk controller refuses to step into it.
 */
export const STREAM: readonly (readonly [number, number])[] = [
  [92, 86],
  [64, 58],
  [43, 37],
  [30, 23],
  [22, 14],
  [17.5, 7],
  [15.6, 0],
  [14.2, -7],
  [12.6, -13],
  [11, -17.4],
]

/** How wide the water is at the spring and at the mouth. A brook gathers. */
const STREAM_WIDTH = [1.7, 3.6] as const

/** How wide the brook is `along` its length, 0 at the spring and 1 at the mouth. */
export const streamWidth = (along: number): number =>
  STREAM_WIDTH[0] + (STREAM_WIDTH[1] - STREAM_WIDTH[0]) * Math.max(0, Math.min(1, along))

/**
 * Where a point falls on a polyline: how far off the middle of it, and how far
 * down it as a fraction of the whole.
 */
function nearestOn(
  line: readonly (readonly [number, number])[],
  x: number,
  z: number,
): { distance: number; along: number } {
  let best = Infinity
  let at = 0
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]!
    const [bx, bz] = line[i]!
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    if (length === 0) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (length * length)))
    const distance = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
    if (distance < best) {
      best = distance
      at = travelled + t * length
    }
    travelled += length
  }
  return { distance: best, along: travelled === 0 ? 0 : at / travelled }
}

/** True within `margin` of the water's edge — the banks, where nothing grows. */
export function alongStream(x: number, z: number, margin = 0): boolean {
  const brook = nearestOn(STREAM, x, z)
  return brook.distance <= streamWidth(brook.along) / 2 + margin
}

/**
 * True where the brook is water you cannot walk in. The last few metres, where
 * it fans out over the beach, are a ford — without that exception the brook
 * would cut the ring path round the lake in two.
 */
export function inStream(x: number, z: number): boolean {
  return alongStream(x, z) && lakeRadius(x, z) > PATH.to
}

/**
 * A plank crossing. Authored as a rough point to cross at, then snapped to the
 * middle of the brook and squared up to the flow, so the deck cannot drift out
 * of agreement with the water.
 */
export type Bridge = {
  x: number
  z: number
  /** Unit vector along the flow. The deck lies across it. */
  dx: number
  dz: number
  /** Half the deck's length, across the water, with a footing on each bank. */
  reach: number
}

/** Half the deck's width, along the flow: two abreast, like the trail. */
export const BRIDGE_DECK = 1.05

/** The deck stands a little proud of the bank, the way a plank bridge does. */
export const BRIDGE_Y = GROUND_Y + 0.06

/** One crossing, out of the cabin's east side past the office. */
const CROSSINGS: readonly (readonly [number, number])[] = [[16.6, 3.6]]

export const BRIDGES: readonly Bridge[] = CROSSINGS.map(([tx, tz]) => {
  let best = { distance: Infinity, x: tx!, z: tz!, dx: 0, dz: 1, along: 0 }
  let travelled = 0
  let total = 0
  for (let i = 1; i < STREAM.length; i++) total += Math.hypot(
    STREAM[i]![0] - STREAM[i - 1]![0],
    STREAM[i]![1] - STREAM[i - 1]![1],
  )
  for (let i = 1; i < STREAM.length; i++) {
    const [ax, az] = STREAM[i - 1]!
    const [bx, bz] = STREAM[i]!
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    const t = Math.max(0, Math.min(1, ((tx! - ax) * dx + (tz! - az) * dz) / (length * length)))
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(tx! - px, tz! - pz)
    if (distance < best.distance) {
      best = {
        distance,
        x: px,
        z: pz,
        dx: dx / length,
        dz: dz / length,
        along: (travelled + t * length) / total,
      }
    }
    travelled += length
  }
  return {
    x: best.x,
    z: best.z,
    dx: best.dx,
    dz: best.dz,
    reach: streamWidth(best.along) / 2 + 1.1,
  }
})

/** The height of the deck under a point, or null where there is no bridge. */
export function bridgeAt(x: number, z: number): number | null {
  for (const bridge of BRIDGES) {
    const ox = x - bridge.x
    const oz = z - bridge.z
    const along = ox * bridge.dx + oz * bridge.dz
    const across = ox * bridge.dz - oz * bridge.dx
    if (Math.abs(along) <= BRIDGE_DECK && Math.abs(across) <= bridge.reach) return BRIDGE_Y
  }
  return null
}

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

/** True on the trodden ground of any path, within `margin` of a centre line. */
export function onTrail(x: number, z: number, margin = TRAIL_WIDTH / 2): boolean {
  for (const line of TRAILS) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1]!
      const [bx, bz] = line[i]!
      if (toSegment(x, z, ax, az, bx, bz) <= margin) return true
    }
  }
  return false
}

/**
 * The height of the ground under a point, or null where there is nothing to
 * stand on — in the water, or past the edge of the world. Null is what
 * `floorAt` needs to refuse a step, the same answer a stairwell gives.
 */
export function terrainAt(x: number, z: number): number | null {
  if (Math.hypot(x, z) > WALK_RADIUS) return null
  // Stopped a whisker short of the water's edge, so you end up on sand looking
  // at the lake rather than ankle-deep in it.
  if (lakeRadius(x, z) < 1.004) return null
  // The plank is a floor, so it is asked about before the water it crosses.
  const deck = bridgeAt(x, z)
  if (deck !== null) return deck
  if (inStream(x, z)) return null
  return GROUND_Y
}
