import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend, colorCorners, goldenWarmth, mixColor, mixNumber } from './ambienceBlend'
import { FurnitureLights } from './Furniture'
import { assign, emptySlot, lampCandidates, poolBindings, type PoolLight } from './lightPool'
import { approach } from '../lib/ease'
import { roomBounds } from '../world/derive'
import { useAmbienceStore } from '../state/ambience'
import { effectiveQuality, SHADOW_MAP_SIZE, useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'

/**
 * Daylight through the windows plus warm interior fill, or moonlight after dark.
 *
 * One directional light casts shadows for the whole world: a shadow map per room
 * would eat the budget the books need, and one sun reads as one building. At
 * night it becomes the moon, so the shadow path never changes shape.
 *
 * Everything with a position is a light-pool candidate rather than a mounted
 * light — see `lightPool.ts`. What stays mounted here has no position at all:
 * the sun, the sky and the ambient floor. Intensities are kept low, because hot
 * pools and readable sun stripes are a stage set rather than an afternoon.
 */

const REVEAL_COLOUR = colorCorners({
  day: '#dceaf6',
  dayRain: '#b6c2c9',
  night: '#5c6478',
  nightRain: '#5c6478',
})
const REVEAL_INTENSITY = { day: 2.8, dayRain: 1.7, night: 1.0, nightRain: 1.0 }
const REVEAL_DISTANCE = { day: 9, dayRain: 9, night: 7, nightRain: 7 }
/** Metres of handicap a window reveal carries when the pool ranks it. */
const REVEAL_BIAS = 2
const FALLBACK_COLOUR = new THREE.Color('#ffd9a8')

const AMBIENT_COLOUR = colorCorners({
  day: '#fdf2e0',
  dayRain: '#e2e6e6',
  night: '#a8967e',
  nightRain: '#a8967e',
})
const AMBIENT_INTENSITY = { day: 0.38, dayRain: 0.42, night: 0.34, nightRain: 0.34 }
const HEMISPHERE_SKY = colorCorners({
  day: '#cfdff0',
  dayRain: '#9fabb2',
  night: '#41465c',
  nightRain: '#41465c',
})
const HEMISPHERE_GROUND = colorCorners({
  day: '#8a6f4c',
  dayRain: '#6c6350',
  night: '#33291e',
  nightRain: '#33291e',
})
const HEMISPHERE_INTENSITY = { day: 0.5, dayRain: 0.55, night: 0.45, nightRain: 0.45 }
const SUN_COLOUR = colorCorners({
  day: '#ffe6c2',
  dayRain: '#cdd4d6',
  night: '#b4c4e2',
  nightRain: '#b4c4e2',
})
const SUN_INTENSITY = { day: 1.9, dayRain: 0.55, night: 0.35, nightRain: 0.35 }

/** The golden-hour targets, lerped in by `goldenWarmth` after the corner mix. */
const GOLDEN_SUN = new THREE.Color('#ff9a4d')
const GOLDEN_SKY = new THREE.Color('#d9a06a')
/** The blue-white everything pales to for a lightning frame. */
const LIGHTNING_COLD = new THREE.Color('#dfe6ff')

/**
 * How much ground the shadow map covers, following the camera rather than
 * spanning the document: at this size 512 does what a document-wide box needed
 * 2048 for.
 */
const SHADOW_RADIUS = 18
/** How far back up the sun's own direction the light sits. Covers the box above. */
const SHADOW_THROW = 42

/**
 * A fixed count of point lights, re-pointed at whatever is nearest. Fixed
 * because the count is what every lit material is compiled against.
 */
function LightPool({ candidates, slots }: { candidates: PoolLight[]; slots: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const state = useMemo(() => {
    poolBindings.length = slots
    poolBindings.fill(null)
    return Array.from({ length: slots }, emptySlot)
  }, [slots])
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])
  const frame = useRef(0)
  const primed = useRef(false)

  useFrame((three, delta) => {
    // Re-ranking every frame is wasted work and invites churn; a few times a
    // second sits well inside the crossfade below.
    frame.current += 1
    if (frame.current % 8 === 1) assign(state, candidates, three.camera.position)

    const rise = approach(6, delta)
    for (let i = 0; i < state.length; i++) {
      const slot = state[i]!
      const light = lights.current[i]
      if (!light) continue

      if (!primed.current && slot.wantedId) {
        // The room must not visibly warm up on load: the first binding lands on
        // its target rather than fading in from dark.
        slot.currentId = slot.wantedId
        slot.level = 1
      } else if (slot.wantedId !== slot.currentId) {
        // Hand over dark. A slot never jumps from one lamp to another while lit,
        // which is what keeps a re-binding from reading as a flash.
        slot.level += (0 - slot.level) * rise
        if (slot.level < 0.02) {
          slot.level = 0
          slot.currentId = slot.wantedId
        }
      } else if (slot.currentId) {
        slot.level += (1 - slot.level) * rise
      }

      const candidate = slot.currentId ? byId.get(slot.currentId) : undefined
      poolBindings[i] = candidate ? slot.currentId : null
      if (!candidate) {
        // Its lamp went out mid-fade. Free the slot outright rather than
        // crossfade from something already dark, or its replacement waits.
        light.intensity = 0
        slot.level = 0
        continue
      }
      const [x, y, z] = candidate.position
      light.position.set(x, y, z)
      light.intensity = candidate.apply(light) * slot.level
    }
    if (frame.current > 1) primed.current = true
  })

  return (
    <>
      {Array.from({ length: slots }, (_, i) => (
        <pointLight
          key={i}
          ref={(node) => {
            lights.current[i] = node
          }}
          intensity={0}
        />
      ))}
    </>
  )
}

export function Lighting() {
  const world = useWorldStore((s) => s.world)
  const on = useAmbienceStore((s) => s.on)
  const settings = useSettings()
  const quality = effectiveQuality(settings)

  /** Only the sun's direction comes from this; the shadow camera follows the player. */
  const extent = useMemo(() => {
    if (!world || world.rooms.length === 0) {
      return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, height: 3.2 }
    }
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let height = 0
    for (const room of world.rooms) {
      const b = roomBounds(room)
      minX = Math.min(minX, b.minX)
      maxX = Math.max(maxX, b.maxX)
      minZ = Math.min(minZ, b.minZ)
      maxZ = Math.max(maxZ, b.maxZ)
      height = Math.max(height, room.elevation + room.height)
    }
    return { minX, maxX, minZ, maxZ, height }
  }, [world])

  /**
   * Every positioned light, as pool candidates: lit lamps, the wash off each
   * glazed reveal, and a fallback fixture for a room that declares none — so a
   * half-written map is not pitch dark while somebody writes it.
   */
  const candidates = useMemo(() => {
    if (!world) return []
    const lit = new Set(world.lights.map((lamp) => lamp.roomId))
    const out: PoolLight[] = lampCandidates(world.lights, on)

    for (const room of world.rooms) {
      const [cx, cz] = room.origin
      const bounds = roomBounds(room)

      if (!lit.has(room.id) && !room.outdoor) {
        const range = Math.hypot(room.size[0], room.size[1]) + 2
        out.push({
          id: `fill-${room.id}`,
          position: [cx, room.elevation + room.height - 0.5, cz],
          reach: range,
          apply: (light) => {
            light.color.copy(FALLBACK_COLOUR)
            light.distance = range
            return 3.6
          },
        })
      }

      // Soft bounce off each window reveal, back into the room. An unglazed
      // opening is not a window and lights nothing; at night the wash goes cold.
      for (const [i, opening] of room.openings.entries()) {
        if (opening.kind !== 'window' || !opening.glazed) continue
        const y = room.elevation + opening.sill + opening.height / 2
        const inset = 0.8
        const position: [number, number, number] =
          opening.wall === 'north'
            ? [cx + opening.at, y, bounds.minZ + inset]
            : opening.wall === 'south'
              ? [cx + opening.at, y, bounds.maxZ - inset]
              : opening.wall === 'west'
                ? [bounds.minX + inset, y, cz + opening.at]
                : [bounds.maxX - inset, y, cz + opening.at]
        out.push({
          id: `win-${room.id}-${i}`,
          position,
          // Ranked shorter than it reaches, so a wall of windows cannot crowd
          // the room's own lamps out of the pool.
          reach: REVEAL_DISTANCE.day - REVEAL_BIAS,
          apply: (light) => {
            mixColor(light.color, REVEAL_COLOUR)
            light.distance = mixNumber(REVEAL_DISTANCE)
            return mixNumber(REVEAL_INTENSITY)
          },
        })
      }
    }
    return out
  }, [world, on])

  /**
   * Never more slots than the building could fill, so a one-room map carries no
   * spares. Stable per document: switching a lamp changes candidates, not slots.
   */
  const ceiling = useMemo(() => {
    if (!world) return 0
    const reveals = world.rooms.reduce(
      (n, room) => n + room.openings.filter((o) => o.kind === 'window' && o.glazed).length,
      0,
    )
    return world.lights.length + reveals + world.rooms.length
  }, [world])
  const slots = Math.max(1, Math.min(quality.lightBudget, ceiling))

  const spanX = extent.maxX - extent.minX
  const spanZ = extent.maxZ - extent.minZ
  const midX = (extent.minX + extent.maxX) / 2
  const midZ = (extent.minZ + extent.maxZ) / 2
  const radius = Math.hypot(spanX, spanZ) / 2 + 5

  // The target must be in the scene for its world matrix to update, or the sun
  // stays aimed at the world origin wherever the building is.
  const sunTarget = useMemo(() => new THREE.Object3D(), [])

  /**
   * Low and to the north-west, over the lake. Derived once and held: the sun
   * travels with the player, so only its direction is a fact about the building.
   */
  const sunDirection = useMemo(() => {
    const from = new THREE.Vector3(
      midX - spanX * 0.5,
      extent.height + radius * 0.55,
      extent.minZ - radius * 0.7,
    )
    return from.sub(new THREE.Vector3(midX, 0, midZ)).normalize()
  }, [midX, midZ, spanX, extent.height, extent.minZ, radius])

  const ambient = useRef<THREE.AmbientLight>(null)
  const hemisphere = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)

  const shadowSize = quality.shadowQuality === 'off' ? 0 : SHADOW_MAP_SIZE[quality.shadowQuality]

  // Faded along the ambience blend rather than switched: dusk is the sun
  // cooling into the moon, passing through the golden hour on the way.
  useFrame((three) => {
    const warmth = goldenWarmth()
    const low = settings.lowPerformance
    if (ambient.current) {
      mixColor(ambient.current.color, AMBIENT_COLOUR)
      // The flash rides the ambient: everything pales at once, then the dark
      // comes back over a few frames as the decay runs out.
      ambient.current.color.lerp(LIGHTNING_COLD, Math.min(1, ambienceBlend.lightning * 0.6))
      ambient.current.intensity =
        mixNumber(AMBIENT_INTENSITY) + (low ? 0.16 : 0) + ambienceBlend.lightning * 1.1
    }
    if (hemisphere.current) {
      mixColor(hemisphere.current.color, HEMISPHERE_SKY)
      hemisphere.current.color.lerp(GOLDEN_SKY, warmth * 0.25)
      mixColor(hemisphere.current.groundColor, HEMISPHERE_GROUND)
      hemisphere.current.intensity = mixNumber(HEMISPHERE_INTENSITY)
    }
    if (sun.current) {
      mixColor(sun.current.color, SUN_COLOUR)
      sun.current.color.lerp(GOLDEN_SUN, warmth * 0.85)
      // The sun softens as it reddens: a setting sun is most of the colour
      // and less of the push.
      sun.current.intensity = mixNumber(SUN_INTENSITY) * (1 - 0.3 * warmth)

      // Snapped to whole texels, or the map slides under the geometry by
      // fractions of one and every shadow edge crawls as you move.
      if (shadowSize > 0) {
        const step = (SHADOW_RADIUS * 2) / shadowSize
        const eye = three.camera.position
        const x = Math.round(eye.x / step) * step
        const z = Math.round(eye.z / step) * step
        sunTarget.position.set(x, 0, z)
        sun.current.position.set(
          x + sunDirection.x * SHADOW_THROW,
          sunDirection.y * SHADOW_THROW,
          z + sunDirection.z * SHADOW_THROW,
        )
      }
    }
  })

  return (
    <>
      {/* Shelves face into the room with their backs to the walls, so they see
          almost none of the window light. Without a generous ambient floor the
          spines read as black and the library is unbrowsable — which is also
          why night does not go truly dark: the ambient floor stays generous
          and *warm*, so the dark is lamplight fading into shadow rather than
          black corners with hot pools between them. */}
      {/* The daytime fill is warm and low — even white light at office levels
          reads as a meeting room. The sun below carries more of the day. */}
      <ambientLight
        ref={ambient}
        intensity={0.38 + (settings.lowPerformance ? 0.16 : 0)}
        color="#fdf2e0"
      />
      <hemisphereLight ref={hemisphere} args={['#cfdff0', '#8a6f4c', 0.5]} />

      <primitive object={sunTarget} position={[midX, 0, midZ]} />
      <directionalLight
        ref={sun}
        position={[midX - spanX * 0.5, extent.height + radius * 0.55, extent.minZ - radius * 0.7]}
        target={sunTarget}
        // Under cloud the sun is diffuse rather than dim — most of the day
        // arrives through the hemisphere — so direct light drops furthest.
        intensity={1.9}
        color="#ffe6c2"
        castShadow={shadowSize > 0}
        shadow-mapSize={[shadowSize || 1, shadowSize || 1]}
        // Sized to where you stand rather than to the document. The frustum is
        // in the light's view space, so it stays square as the sun goes off-axis.
        shadow-camera-left={-SHADOW_RADIUS}
        shadow-camera-right={SHADOW_RADIUS}
        shadow-camera-top={SHADOW_RADIUS}
        shadow-camera-bottom={-SHADOW_RADIUS}
        shadow-camera-near={0.5}
        shadow-camera-far={SHADOW_THROW * 2}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />

      <LightPool candidates={candidates} slots={slots} />
      <FurnitureLights />
    </>
  )
}
