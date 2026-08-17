import * as THREE from 'three'
import type { DerivedLight } from '../world/derive'

/**
 * A fixed number of point lights standing in for however many the building
 * declares. Three.js forward rendering has no per-object light culling, so every
 * point light is a term in every lit fragment's shader — with forty lamps, each
 * pixel of the cabin is shaded against the lake house's pendants.
 *
 * Mounting only nearby lights would not help: the count is what every material
 * is compiled against, so changing it recompiles the scene. The count is held
 * constant and the bindings move instead, which also makes switching a lamp off
 * genuinely cheaper rather than merely darker. The cost is that a lamp beyond
 * the pool lights nothing, which walls make close to right anyway.
 */

export type PoolLight = {
  id: string
  position: readonly [number, number, number]
  /** Roughly how far it carries. Ranking only — `apply` sets the real range. */
  reach: number
  /** Live, because a window reveal follows the ambience and a fire breathes. */
  apply: (light: THREE.PointLight) => number
}

/** Metres of slack a bound light gets before a closer one may evict it. */
const HOLD = 0.75

/** A plain array, like `state/metrics.ts`: written every frame, re-renders nothing. */
export const poolBindings: (string | null)[] = []

/** Rank by how far outside its reach you are, or a dim close lamp beats the room's pendant. */
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
 * Sticky: a slot keeps its lamp while that lamp is still wanted, so walking
 * about does not shuffle bindings and make the room flicker.
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
 * The lamps that are alight, as pool candidates. Rebuilt on a React-level event
 * rather than per frame, which is what lets an unlit lamp simply not be a
 * candidate — where "off is cheaper" comes from.
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
