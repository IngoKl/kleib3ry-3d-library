import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  ambienceBlend,
  colorCorners,
  goldenWarmth,
  mixColor,
  mixNumber,
  type Corners,
} from './ambienceBlend'
import { FurnitureLights } from './Furniture'
import { roomBounds } from '../world/derive'
import type { RoomSpec } from '../world/schema'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'

/**
 * Daylight through the windows plus warm interior fill — or moonlight, because
 * night is a switch now and a library is somewhere you want to be after dark.
 *
 * Only one directional light casts shadows, for the whole world: a shadow map
 * per room would eat the frame budget the books need, and a single sun angled
 * across the library reads as one building rather than several. At night the
 * same light is the moon, low and cold, so the shadow path never changes shape.
 *
 * The lamps themselves are no longer invented per room — they are furniture in
 * `library.json`, and switching one off is a thing you can do. What is left
 * here is the light that has no fitting: the sun, the sky, and the wash coming
 * back off a window reveal. A room that declares no lamps at all still gets one
 * soft fixture, so that a map somebody is halfway through writing is not pitch
 * dark while they write it.
 *
 * Intensities are kept low: hot pools under the pendants and sun stripes you can
 * read by are a stage set rather than an afternoon.
 */

/** A point light whose colour, intensity and reach fade with the ambience. */
function FadeLight({
  position,
  colour,
  intensity,
  distance,
}: {
  position: [number, number, number]
  colour: Corners<THREE.Color>
  intensity: Corners<number>
  distance: Corners<number>
}) {
  const light = useRef<THREE.PointLight>(null)
  useFrame(() => {
    const node = light.current
    if (!node) return
    mixColor(node.color, colour)
    node.intensity = mixNumber(intensity)
    node.distance = mixNumber(distance)
  })
  return <pointLight ref={light} position={position} intensity={0} />
}

const REVEAL_COLOUR = colorCorners({
  day: '#dceaf6',
  dayRain: '#b6c2c9',
  night: '#5c6478',
  nightRain: '#5c6478',
})
const REVEAL_INTENSITY = { day: 2.8, dayRain: 1.7, night: 1.0, nightRain: 1.0 }
const REVEAL_DISTANCE = { day: 9, dayRain: 9, night: 7, nightRain: 7 }

function RoomFill({
  room,
  unlit,
  reveals,
}: {
  room: RoomSpec
  unlit: boolean
  /** False in low performance mode: see `Lighting` for what that is buying. */
  reveals: boolean
}) {
  const [cx, cz] = room.origin
  const bounds = roomBounds(room)

  return (
    <>
      {unlit && !room.outdoor && (
        <pointLight
          position={[cx, room.elevation + room.height - 0.5, cz]}
          intensity={3.6}
          distance={Math.hypot(room.size[0], room.size[1]) + 2}
          color="#ffd9a8"
        />
      )}

      {/* Soft bounce off the reveal of each window, back into the room. An
          unglazed opening — a balustrade, a porch railing — is not a window and
          does not light anything. At night the same wash goes cold and faint:
          moonlight on the reveal rather than sky. */}
      {(reveals ? room.openings : [])
        .filter((opening) => opening.kind === 'window' && opening.glazed)
        .map((opening, i) => {
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
          return (
            <FadeLight
              key={`win-${i}`}
              position={position}
              colour={REVEAL_COLOUR}
              intensity={REVEAL_INTENSITY}
              distance={REVEAL_DISTANCE}
            />
          )
        })}
    </>
  )
}

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

export function Lighting() {
  const world = useWorldStore((s) => s.world)
  /**
   * Low performance mode drops the window reveals and the shadow map.
   *
   * The reveals are the expensive half and the surprising one: they are a point
   * light per glazed opening, and the default cabin has fourteen of them, all
   * of which every lit fragment in the building has to be shaded against. The
   * ambient floor is raised to make up for them, so a room is dimmer and
   * flatter rather than dark.
   */
  const low = useSettings((s) => s.lowPerformance)

  /** One shadow camera wide enough to cover every room in the document. */
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

  /** Rooms with no lamp of their own, which get a fallback fixture. */
  const unlit = useMemo(() => {
    if (!world) return new Set<string>()
    const lit = new Set(world.lights.map((lamp) => lamp.roomId))
    return new Set(world.rooms.map((room) => room.id).filter((id) => !lit.has(id)))
  }, [world])

  const spanX = extent.maxX - extent.minX
  const spanZ = extent.maxZ - extent.minZ
  const midX = (extent.minX + extent.maxX) / 2
  const midZ = (extent.minZ + extent.maxZ) / 2
  const radius = Math.hypot(spanX, spanZ) / 2 + 5

  // The target has to be *in the scene* for its world matrix to update —
  // `target-position` on a detached default target leaves the sun aimed at the
  // world origin no matter where the building is.
  const sunTarget = useMemo(() => new THREE.Object3D(), [])

  const ambient = useRef<THREE.AmbientLight>(null)
  const hemisphere = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)

  // The sky-wide lights, faded along the ambience blend rather than switched:
  // dusk is the sun cooling into the moon while the ambient floor warms — and
  // passing, mid-fade, through the golden hour.
  useFrame(() => {
    const warmth = goldenWarmth()
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
      <ambientLight ref={ambient} intensity={0.38 + (low ? 0.16 : 0)} color="#fdf2e0" />
      <hemisphereLight ref={hemisphere} args={['#cfdff0', '#8a6f4c', 0.5]} />

      {/* Low and to the north-west, which is where the lake is: afternoon
          light coming in through the big window rather than noon overhead. At
          night the same light is the moon over the same lake. */}
      <primitive object={sunTarget} position={[midX, 0, midZ]} />
      <directionalLight
        ref={sun}
        position={[midX - spanX * 0.5, extent.height + radius * 0.55, extent.minZ - radius * 0.7]}
        target={sunTarget}
        // Under cloud the sun is not dimmer so much as *diffuse*: most of the
        // day arrives through the hemisphere above rather than as a beam, which
        // is why the direct light drops much further than the room does.
        intensity={1.9}
        color="#ffe6c2"
        castShadow={!low}
        shadow-mapSize={[2048, 2048]}
        // Square and generous. The frustum is in the *light's* view space, so a
        // box sized to the building's plan does not cover the building once the
        // sun is off-axis — and the edge of the shadow map is a hard vertical
        // seam of brightness straight up the middle of the room.
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 3 + 20}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />

      {world?.rooms.map((room) => (
        <RoomFill key={room.id} room={room} unlit={unlit.has(room.id)} reveals={!low} />
      ))}
      <FurnitureLights />
    </>
  )
}
