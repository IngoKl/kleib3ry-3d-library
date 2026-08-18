/**
 * The site: ground, water, and where the ground runs out. Both `Outside.tsx` and
 * `floorAt` read it, so a shoreline cannot be drawn in one place and stood on in
 * another. Constants, not `library.json` — that document describes a building.
 */

/**
 * Water above sand above grass, rather than a hole cut in the ground. Keep the
 * gaps at ~1.5 cm, or they read as three floating discs from the shore.
 */
export const GROUND_Y = -0.24
export const SHORE_Y = -0.225
export const WATER_Y = -0.21

/** The brook's sheets, 4 mm under the lake's: coplanar surfaces z-fight. */
export const BROOK_BED_Y = SHORE_Y - 0.004
export const BROOK_WATER_Y = WATER_Y - 0.004

/**
 * How far the ground is drawn, and how far you may walk. The walkable radius
 * sits inside the visible one so the refusal happens where the fog hides it.
 */
export const GROUND_RADIUS = 176
export const WALK_RADIUS = 118

/**
 * `viewX` and `viewFrom` are the cleared corridor running north from the cabin,
 * so the north window looks at water rather than at trees.
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
 * What turns the ellipse into a pond, as [lobes, amplitude, phase]. Sines rather
 * than noise, so the outline is the same wherever it is asked; keep the
 * amplitudes summing to ~0.12 or the derived rings fold over.
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

/** Distance from the lake's middle in shoreline units: below 1 is water. */
export function lakeRadius(x: number, z: number): number {
  const lx = (x - LAKE.x) / LAKE.radiusX
  const lz = (z - LAKE.z) / LAKE.radiusZ
  const raw = Math.hypot(lx, lz)
  if (raw < 1e-9) return 0
  return raw / shoreShape(Math.atan2(lz, lx))
}

/**
 * The point `r` shoreline units out at `angle`, in metres. The renderer builds
 * the shore from this and the walk controller refuses steps by it.
 */
export function lakePoint(angle: number, r: number): [number, number] {
  const reach = r * shoreShape(angle)
  return [
    LAKE.x + Math.cos(angle) * reach * LAKE.radiusX,
    LAKE.z + Math.sin(angle) * reach * LAKE.radiusZ,
  ]
}

/** Where the sand ends: the beach is the ring between the water's edge and this. */
export const SHORE_EDGE = 1.078

/** What is underfoot, for footstep sounds: the beach and the brook's banks are sand. */
export function groundSurface(x: number, z: number): 'sand' | 'grass' | 'wood' {
  if (onPlatform(x, z) || bridgeAt(x, z) !== null) return 'wood'
  if (lakeRadius(x, z) < SHORE_EDGE) return 'sand'
  return alongStream(x, z, 0.7) ? 'sand' : 'grass'
}

/**
 * The ring of cleared ground above the beach. In shoreline units so it follows
 * the lake instead of cutting corners; the forest is grown around it.
 */
export const PATH = { from: SHORE_EDGE, to: 1.34 } as const

export const onPath = (x: number, z: number): boolean => {
  const r = lakeRadius(x, z)
  return r >= PATH.from && r <= PATH.to
}

/**
 * From the cabin's porch west to the lake house. Here rather than in
 * `library.json` because a route between buildings belongs to neither.
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
 * The spur down to the camp. Its own polyline, not more points on `TRAIL`:
 * joined up, the renderer draws a leg across the water.
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
 * Out of the south-east forest, past the office window, into the lake. Here
 * because three things must agree on where the water runs: the renderer, the
 * forest grown around it, and the walk controller refusing to step in.
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

/** Where a point falls on a polyline: distance off it, and how far along. */
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
 * Water you cannot walk in. The last few metres over the beach are a ford, or
 * the brook would cut the ring path round the lake in two.
 */
export function inStream(x: number, z: number): boolean {
  return alongStream(x, z) && lakeRadius(x, z) > PATH.to
}

/**
 * A plank crossing, authored roughly then snapped to the middle of the brook and
 * squared to the flow, so the deck cannot drift away from the water.
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

// ---- the mountains -------------------------------------------------------

/**
 * The range across the north, behind the lake, as [x, z, radius, height].
 * Overlapping smoothstep mounds rather than noise, so the height under a point
 * is the same wherever it is asked — the mesh, the walk refusal, the forest
 * line and the cable car all read this one function.
 */
const PEAKS: readonly (readonly [number, number, number, number])[] = [
  [-30, -95, 24, 17],
  [-10, -101, 30, 26],
  [10, -95, 27, 21],
  [30, -86, 21, 12],
]

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** How far the mountains rise above the ground plane at a point. 0 off the range. */
export function mountainHeight(x: number, z: number): number {
  let h = 0
  for (const [px, pz, radius, height] of PEAKS) {
    const t = 1 - Math.hypot(x - px, z - pz) / radius
    if (t > 0) h += height * smoothstep(t)
  }
  return h
}

/**
 * Where the walkable toe of the range ends. Below this the slope is ground you
 * walk up; above it `terrainAt` refuses, the same answer the lake gives — the
 * mountains are seen, not climbed, and the cable car is the way up.
 */
export const MOUNTAIN_STEP = 0.35

/**
 * The lookout: a deck on the saddle between the two big peaks, looking south
 * over the whole lake. Its height is taken from the mountain under it, so
 * re-shaping a peak can never leave the deck buried or hanging.
 */
const PLATFORM_AT = { x: 0, z: -98, halfX: 3.4, halfZ: 2.6 }

/** The highest ground under the deck's rectangle, sampled — the knoll it stands on. */
function platformFooting(): number {
  let top = 0
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const x = PLATFORM_AT.x + ((i / 8) * 2 - 1) * PLATFORM_AT.halfX
      const z = PLATFORM_AT.z + ((j / 8) * 2 - 1) * PLATFORM_AT.halfZ
      top = Math.max(top, mountainHeight(x, z))
    }
  }
  return top
}

export const PLATFORM = {
  ...PLATFORM_AT,
  /** The deck's walking surface, a plank's rise above the knoll's highest point. */
  y: GROUND_Y + platformFooting() + 0.15,
} as const

export function onPlatform(x: number, z: number): boolean {
  return (
    Math.abs(x - PLATFORM.x) <= PLATFORM.halfX && Math.abs(z - PLATFORM.z) <= PLATFORM.halfZ
  )
}

/**
 * The cable car: one line from a stop by the camp up to the lookout, two
 * counterweighted cabins that swap ends. `path` is the *cabin floor's* course —
 * boarding height at the base, deck height at the top — so the ride and the
 * drawn cabins cannot disagree about where the floor is.
 */
const CABLE_BASE = { x: 1.5, z: -66 }
const CABLE_TOP = { x: 0, z: PLATFORM.z + PLATFORM.halfZ + 0.8 }

/** From the cable down to the cabin floor: the hanger arm plus the cabin. */
export const CABLE_DROP = 2.6

export type CablePoint = { x: number; y: number; z: number }

export const CABLE_CAR = {
  base: CABLE_BASE,
  top: CABLE_TOP,
  /** Board a step up from the grass, arrive level with the deck. */
  path: [
    { x: CABLE_BASE.x, y: GROUND_Y + 0.26, z: CABLE_BASE.z },
    // The tower's kink, lifting the line clear of the slope it climbs.
    { x: 1.2, y: GROUND_Y + 5.0, z: -71.5 },
    { x: CABLE_TOP.x, y: PLATFORM.y, z: CABLE_TOP.z },
  ] as readonly CablePoint[],
  /** Where you stand once you have stepped off, at either end. */
  landings: {
    // A pace south of the base stop, on the grass towards the camp.
    base: { x: CABLE_BASE.x, z: CABLE_BASE.z + 1.6, y: GROUND_Y },
    // Through the rail gap, clear of the deck's chairs.
    top: { x: PLATFORM.x + 0.4, z: PLATFORM.z + PLATFORM.halfZ - 0.9, y: PLATFORM.y },
  },
  seconds: 14,
} as const

/**
 * The two track lines run a cabin's width apart, so the cabins pass mid-line
 * rather than through each other. Cabin A rides `+CABLE_SIDE`, B the mirror —
 * the renderer and the ride both apply it, or the rider floats beside the car.
 */
export const CABLE_SIDE = (() => {
  const dx = CABLE_TOP.x - CABLE_BASE.x
  const dz = CABLE_TOP.z - CABLE_BASE.z
  const length = Math.hypot(dx, dz)
  return { x: (dz / length) * 0.55, z: (-dx / length) * 0.55 }
})()

/** Along-the-line distances, so the cabin covers ground evenly through the kink. */
const CABLE_LENGTHS = (() => {
  const spans = [0]
  for (let i = 1; i < CABLE_CAR.path.length; i++) {
    const a = CABLE_CAR.path[i - 1]!
    const b = CABLE_CAR.path[i]!
    spans.push(spans[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))
  }
  return spans
})()

/** Where a cabin's floor is, `t` from 0 at the base stop to 1 at the lookout. */
export function cabinAt(t: number): CablePoint {
  const total = CABLE_LENGTHS[CABLE_LENGTHS.length - 1]!
  const along = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < CABLE_CAR.path.length; i++) {
    if (along > CABLE_LENGTHS[i]! && i < CABLE_CAR.path.length - 1) continue
    const a = CABLE_CAR.path[i - 1]!
    const b = CABLE_CAR.path[i]!
    const span = CABLE_LENGTHS[i]! - CABLE_LENGTHS[i - 1]!
    const s = span === 0 ? 0 : (along - CABLE_LENGTHS[i - 1]!) / span
    return {
      x: a.x + (b.x - a.x) * s,
      y: a.y + (b.y - a.y) * s,
      z: a.z + (b.z - a.z) * s,
    }
  }
  return CABLE_CAR.path[CABLE_CAR.path.length - 1]!
}

/**
 * The cleared fan between the lookout and the water, cut through the far
 * shore's band of forest. Without it a tall pine at the shore stands exactly
 * in the one sight-line the platform exists for.
 */
export function inVista(x: number, z: number): boolean {
  if (z > -50 || z < -80) return false
  // 0 under the platform, 1 at the lake's middle; the fan widens on the way down.
  const t = (z - PLATFORM.z) / (LAKE.z - PLATFORM.z)
  const centreX = PLATFORM.x + (LAKE.x - PLATFORM.x) * t
  return Math.abs(x - centreX) < 4 + 10 * t
}

/** True within `margin` of the cable's plan line — the corridor kept clear of trees. */
export function underCable(x: number, z: number, margin: number): boolean {
  return (
    toSegment(x, z, CABLE_CAR.base.x, CABLE_CAR.base.z, CABLE_CAR.top.x, CABLE_CAR.top.z) <=
    margin
  )
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
 * Ground height under a point, or null where there is nothing to stand on —
 * which is how `floorAt` refuses a step, the same answer a stairwell gives.
 */
export function terrainAt(x: number, z: number): number | null {
  if (Math.hypot(x, z) > WALK_RADIUS) return null
  // Stopped a whisker short of the water's edge, so you end up on sand looking
  // at the lake rather than ankle-deep in it.
  if (lakeRadius(x, z) < 1.004) return null
  // The plank is a floor, so it is asked about before the water it crosses.
  const deck = bridgeAt(x, z)
  if (deck !== null) return deck
  // The lookout is a floor too, asked before the mountainside it stands on.
  if (onPlatform(x, z)) return PLATFORM.y
  // Walkable up the toe of the range, then refused: the cable car is the way up.
  const rise = mountainHeight(x, z)
  if (rise > MOUNTAIN_STEP) return null
  if (inStream(x, z)) return null
  return GROUND_Y + rise
}
