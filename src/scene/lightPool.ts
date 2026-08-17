import * as THREE from 'three'
import type { DerivedLight } from '../world/derive'

/**
 * A fixed number of point lights, standing in for however many the building
 * declares.
 *
 * Three.js forward rendering has no per-object light culling: every point light
 * is a term in *every* lit fragment's shader, wherever it hangs. The default
 * map declares nearly forty, so without this each pixel of the cabin is shaded
 * against the lake house's pendants.
 *
 * Mounting only nearby lights would not work: the *count* is what the shader is
 * compiled against, and changing it recompiles every material in the scene. So
 * the count is held constant and the *bindings* move — a fixed set of slots,
 * re-pointed at the nearest lit lamps as you walk. Switching a lamp off then
 * makes the room genuinely cheaper rather than merely darker.
 *
 * The cost: a lamp beyond the pool lights nothing. With walls between rooms
 * that is close to the desired behaviour anyway.
 */

export type PoolLight = {
  id: string
  position: readonly [number, number, number]
  /** Roughly how far it carries. Ranking only — `apply` sets the real range. */
  reach: number
  /**
   * Writes colour and range onto the light and returns the intensity it wants
   * this frame. Live, because a reveal follows the ambience and a fire breathes.
   */
  apply: (light: THREE.PointLight) => number
}

/** Metres of slack a bound light gets before a closer one may evict it. */
const HOLD = 0.75

/**
 * Which candidate each slot is showing, for the probe and the tests.
 *
 * A plain array beside the pool, for the same reason `state/metrics.ts` is one:
 * it is written every frame and must not re-render anything.
 */
export const poolBindings: (string | null)[] = []

/**
 * Rank by how far *outside* its own reach you are, so a dim close lamp does not
 * beat the pendant lighting the room you are standing in.
 */
function score(light: PoolLight, camera: THREE.Vector3, bound: boolean): number {
  const [x, y, z] = light.position
  const d = Math.hypot(camera.x - x, camera.y - y, camera.z - z) - light.reach
  return bound ? d - HOLD : d
}

export type Slot = {
  currentId: string | null
  wantedId: string | null
  /** The hand-over crossfade, 0 to 1. A slot only changes lamps while dark. */
  level: number
}

export const emptySlot = (): Slot => ({ currentId: null, wantedId: null, level: 0 })

/**
 * Decide which candidate each slot should be showing. Sticky: a slot keeps its
 * lamp whenever that lamp is still wanted, so walking about does not shuffle
 * bindings and make the room flicker.
 */
export function assign(slots: Slot[], candidates: PoolLight[], camera: THREE.Vector3): void {
  const bound = new Set<string>()
  for (const slot of slots) if (slot.currentId) bound.add(slot.currentId)

  const ranked = candidates
    .map((light) => ({ light, s: score(light, camera, bound.has(light.id)) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, slots.length)
    .map((entry) => entry.light)

  const wanted = new Set(ranked.map((light) => light.id))
  const kept = new Set<string>()
  for (const slot of slots) {
    if (slot.currentId && wanted.has(slot.currentId)) {
      slot.wantedId = slot.currentId
      kept.add(slot.currentId)
    }
  }

  const spare = ranked.filter((light) => !kept.has(light.id))
  let next = 0
  for (const slot of slots) {
    if (slot.currentId && kept.has(slot.currentId)) continue
    slot.wantedId = spare[next]?.id ?? null
    next += 1
  }
}

const LAMP_COLOUR = {
  fire: new THREE.Color('#ff9346'),
  fairy: new THREE.Color('#ffcf82'),
  bulb: new THREE.Color('#ffd9a0'),
}

/**
 * The lamps that are actually alight, as pool candidates.
 *
 * Rebuilt when the world or the switches change — a React-level event — rather
 * than per frame, which is what lets a lamp that is off simply not be a
 * candidate. That is where "off is cheaper" comes from.
 */
export function lampCandidates(lights: DerivedLight[], on: Record<string, boolean>): PoolLight[] {
  const out: PoolLight[] = []
  for (const lamp of lights) {
    if (!(on[lamp.id] ?? lamp.defaultOn)) continue
    const fire = lamp.kind === 'fireplace' || lamp.kind === 'campfire'
    const fairy = lamp.kind === 'fairylights'
    // Candela, falling off with the square of distance, so these are larger
    // than they look. Unchanged from when each lamp owned its own light.
    const target = fire || lamp.kind === 'pendant' ? 4.5 : fairy ? 1.8 : 2.8
    const range = fire ? 6 : lamp.kind === 'pendant' ? 10 : fairy ? 7 : 5.6
    const colour = fire ? LAMP_COLOUR.fire : fairy ? LAMP_COLOUR.fairy : LAMP_COLOUR.bulb
    out.push({
      id: lamp.id,
      position: [lamp.x, lamp.y, lamp.z],
      reach: range,
      apply: (light) => {
        light.color.copy(colour)
        light.distance = range
        // A fire breathes a slow ±7%: its flames are deliberately static, but a
        // light is below the corner-of-eye threshold.
        if (!fire) return target
        return target * (1 + Math.sin(performance.now() * 0.0017) * 0.07)
      },
    })
  }
  return out
}
