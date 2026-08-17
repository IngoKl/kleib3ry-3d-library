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
 * The brook's own two sheets, four millimetres under the lake's — so that where
 * the one runs into the other there is a winner rather than a fight. Two
 * surfaces at exactly one height shimmer against each other, which is the whole
 * reason these numbers are written down in one place.
 */
export const BROOK_BED_Y = SHORE_Y - 0.004
export const BROOK_WATER_Y = WATER_Y - 0.004

/**
 * How far the ground reaches before the fog has swallowed it anyway, and how
 * far you are allowed to walk.
 *
 * The walkable radius is deliberately well inside the visible one. At 118 m the
 * fog is dense enough that the refusal reads as "the forest goes on" rather
 * than as a wall — which is the cheapest honest end to a world whose point is a
 * cabin, not a continent. Everything else out here is written in terms of these
 * two, so the valley can be grown by changing them and nothing is left behind:
 * the ground disc's rings, where the swell starts, the hills, how far the
 * forest is sown.
 */
export const GROUND_RADIUS = 176
export const WALK_RADIUS = 118

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
 * The wobble that turns the ellipse into a pond: a few low harmonics on the
 * shoreline, as [lobes, amplitude, phase].
 *
 * Three frequencies rather than noise because the outline has to be the same
 * function everywhere it is asked — walked to, drawn, and grown around — and a
 * closed sum of sines is trivially that. Amplitudes sum to ~0.12, small enough
 * that every ring derived in shoreline units (the beach, the path, the tree
 * line) deforms with it without ever folding over itself.
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
 * How far a point is from the middle of the lake, in units of shoreline: below
 * 1 is water, 1 is the water's edge, above 1 is dry land.
 *
 * An ellipse with a slow wobble on it rather than a distance, because a perfect
 * ellipse reads as a compass drawing — and the whole reason this function
 * exists is that the shore you walk to has to be the shore you can see.
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
 * metres. The renderer builds the water and the beach from this — the same
 * function the walk controller refuses steps with, which is the agreement that
 * keeps the shore you see and the shore you stand at the same shore.
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
 * What the ground underfoot is made of, for anything that wants to sound or
 * look like it — the beach ring and the brook's gravel banks are sand,
 * everything else out of doors is grass. Owned here so the shore you hear is
 * the shore you see.
 */
export function groundSurface(x: number, z: number): 'sand' | 'grass' {
  if (lakeRadius(x, z) < SHORE_EDGE) return 'sand'
  return alongStream(x, z, 0.7) ? 'sand' : 'grass'
}

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

/**
 * The spur down to the camp: a few trodden metres from the walk round the
 * water to the stone pad on the far shore. Its own polyline rather than more
 * points on `TRAIL` — joined up, the renderer would draw a leg from the lake
 * house straight across the water.
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
 * The brook.
 *
 * The valley had water on one side of the houses and nothing on the other. This
 * is the other: a stream out of the south-east forest, past the office's east
 * window, and down into the lake — which means the lake is no longer somewhere
 * you go, it is somewhere the ground you are standing on is going.
 *
 * A polyline like the trail, and here rather than in `Outside.tsx` for the same
 * reason the lake is: three things have to agree about where the water runs.
 * The renderer draws it, the forest is grown around it, and the walk controller
 * refuses to step into it — and a brook you can see in one place and walk
 * through in another is precisely the bug this module exists to prevent.
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
 * True where the brook is water you cannot walk in.
 *
 * Not the whole of it: across the shore the stream fans out over the sand and
 * runs ankle deep, so the last few metres are a ford. That is what a stream
 * does where it meets a beach, and it is also what keeps the walk round the
 * lake in one piece — a brook that blocked all the way to the waterline would
 * cut the ring path, and the crossing would be a bridge standing in a puddle.
 */
export function inStream(x: number, z: number): boolean {
  return alongStream(x, z) && lakeRadius(x, z) > PATH.to
}

/**
 * A plank crossing: where it is, which way the water runs under it, and how far
 * the deck reaches across.
 *
 * Written as "somewhere you would want to cross", snapped to the middle of the
 * brook and squared up to the flow, because the decision is the *where* and
 * the rest is arithmetic that must not be allowed to disagree with the water.
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
  // The plank over the brook is a floor like any other, and it is asked about
  // before the water it crosses.
  const deck = bridgeAt(x, z)
  if (deck !== null) return deck
  if (inStream(x, z)) return null
  return GROUND_Y
}
