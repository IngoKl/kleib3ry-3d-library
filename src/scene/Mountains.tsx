import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  CABLE_CAR,
  CABLE_DROP,
  CABLE_SIDE,
  GROUND_Y,
  PLATFORM,
  cabinAt,
  mountainHeight,
} from '../world/terrain'
import { cableRide } from '../state/cableCar'
import { woodGrainTexture } from './materials'

/**
 * The range across the north, the lookout on its saddle, and the cable car up
 * to it. The heights come from `mountainHeight` — the same function the walk
 * controller refuses steps by — and the cabins hang on `cabinAt`, the same
 * curve the ride carries the player along, so nothing here can drift from what
 * is walked and ridden. A handful of merged draw calls; only the cabins move.
 */

/** Just past the peaks' skirts, where `mountainHeight` reaches zero. */
const RANGE = { minX: -56, maxX: 53, minZ: -133, maxZ: -63 }

/** The slopes by height: meadow into scrub into rock, snow on the tops. */
const BANDS: readonly (readonly [number, string])[] = [
  [0, '#4a5c34'],
  [5, '#556044'],
  [12, '#6a6a58'],
  [20, '#77786e'],
  [26, '#c9ced2'],
  [31, '#e8edef'],
]

function slopeColour(h: number, out: THREE.Color, a: THREE.Color, b: THREE.Color): THREE.Color {
  for (let i = 1; i < BANDS.length; i++) {
    const [from, colour] = BANDS[i - 1]!
    const [to, next] = BANDS[i]!
    if (h <= to) {
      const t = (h - from) / (to - from)
      return out.copy(a.set(colour)).lerp(b.set(next), Math.max(0, Math.min(1, t)))
    }
  }
  return out.set(BANDS[BANDS.length - 1]![1])
}

/**
 * The range as one displaced grid. The skirt is sunk a few centimetres where
 * the height runs out, so the mesh tucks under the ground disc instead of
 * z-fighting with it, and the low vertices wear the ground's own green so the
 * hand-over is a colour you cannot find.
 */
function rangeGeometry(across = 64, down = 42): THREE.BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const colour = new THREE.Color()
  const a = new THREE.Color()
  const b = new THREE.Color()

  for (let j = 0; j <= down; j++) {
    for (let i = 0; i <= across; i++) {
      const x = RANGE.minX + ((RANGE.maxX - RANGE.minX) * i) / across
      const z = RANGE.minZ + ((RANGE.maxZ - RANGE.minZ) * j) / down
      const h = mountainHeight(x, z)
      const tuck = 0.08 * Math.max(0, 1 - h / 0.5)
      positions.push(x, GROUND_Y + h - tuck, z)
      slopeColour(h, colour, a, b)
      colours.push(colour.r, colour.g, colour.b)
    }
  }

  const indices: number[] = []
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const at = j * (across + 1) + i
      // Wound to face *up*: with +x along i and +z along j, up is
      // (corner, next row, next column) — the other order shows the range
      // only from inside the hill, which reads as a hole in the world.
      indices.push(at, at + across + 1, at + 1)
      indices.push(at + 1, at + across + 1, at + across + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** A box, translated — the same shorthand the furniture bodies use. */
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const made = new THREE.BoxGeometry(w, h, d)
  made.translate(x, y, z)
  return made
}

/** A thin cylinder from `a` to `b`: one span of cable. */
function cableSpan(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  const length = a.distanceTo(b)
  const span = new THREE.CylinderGeometry(0.02, 0.02, length, 5)
  const direction = b.clone().sub(a).normalize()
  span.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction))
  const middle = a.clone().add(b).multiplyScalar(0.5)
  span.translate(middle.x, middle.y, middle.z)
  return span
}

/**
 * The lookout deck and its rails, the tower, and the station plinths' footing.
 * The rails are scenery: the walk already refuses every step off the deck,
 * because the mountainside around it is too steep to be a floor.
 */
function structureGeometry(): { deck: THREE.BufferGeometry; timber: THREE.BufferGeometry } {
  const deckTop = PLATFORM.y
  const deck = [
    box(PLATFORM.halfX * 2, 0.12, PLATFORM.halfZ * 2, PLATFORM.x, deckTop - 0.06, PLATFORM.z),
  ]

  const timber: THREE.BufferGeometry[] = []
  // A post at each corner, down into the knoll the deck stands on.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = PLATFORM.x + sx * (PLATFORM.halfX - 0.12)
      const z = PLATFORM.z + sz * (PLATFORM.halfZ - 0.12)
      const footing = GROUND_Y + mountainHeight(x, z) - 0.3
      timber.push(box(0.16, deckTop - footing, 0.16, x, (deckTop + footing) / 2, z))
    }
  }

  // Rails: posts and a top bar round the edge, with a gap on the south side
  // where the cabins dock and the bench looks out.
  const railTop = deckTop + 1.02
  const rail = (fromX: number, toX: number, fromZ: number, toZ: number) => {
    const length = Math.hypot(toX - fromX, toZ - fromZ)
    const posts = Math.max(2, Math.round(length / 1.2))
    for (let i = 0; i <= posts; i++) {
      const t = i / posts
      timber.push(box(0.07, 1.0, 0.07, fromX + (toX - fromX) * t, deckTop + 0.5, fromZ + (toZ - fromZ) * t))
    }
    const bar = box(Math.max(Math.abs(toX - fromX), 0.07), 0.08, Math.max(Math.abs(toZ - fromZ), 0.07), (fromX + toX) / 2, railTop, (fromZ + toZ) / 2)
    timber.push(bar)
  }
  const west = PLATFORM.x - PLATFORM.halfX + 0.06
  const east = PLATFORM.x + PLATFORM.halfX - 0.06
  const north = PLATFORM.z - PLATFORM.halfZ + 0.06
  const south = PLATFORM.z + PLATFORM.halfZ - 0.06

  // The two light-posts on the north corners: the fairy lights are strung
  // between their tops (1.74 m — `siteFurniture` uses the same number), so the
  // string hangs from timber rather than floating in the sky.
  for (const x of [west, east]) {
    timber.push(box(0.09, 1.78, 0.09, x, deckTop + 0.89, north))
  }

  rail(west, east, north, north)
  rail(west, west, north, south)
  rail(east, east, north, south)
  // The south side keeps its corners; the middle is the way on and off.
  rail(west, PLATFORM.x - 1.3, south, south)
  rail(PLATFORM.x + 1.3, east, south, south)

  // The tower under the line's kink, carrying both track cables on a crossarm.
  const kink = CABLE_CAR.path[1]!
  const hanger = kink.y + CABLE_DROP
  const footing = GROUND_Y + mountainHeight(kink.x, kink.z) - 0.2
  for (const side of [-1, 1]) {
    timber.push(
      box(
        0.15,
        hanger - footing,
        0.15,
        kink.x + CABLE_SIDE.x * side,
        (hanger + footing) / 2,
        kink.z + CABLE_SIDE.z * side,
      ),
    )
  }
  // Across the two cables, which is what a crossarm is for: built along X and
  // turned to the side vector the tracks are offset by.
  const arm = new THREE.BoxGeometry(1.6, 0.14, 0.14)
  arm.rotateY(Math.atan2(-CABLE_SIDE.z, CABLE_SIDE.x))
  arm.translate(kink.x, hanger, kink.z)
  timber.push(arm)

  return { deck: mergeGeometries(deck, false)!, timber: mergeGeometries(timber, false)! }
}

/** Both track cables, hung `CABLE_DROP` over the cabin floors' course. */
function cableGeometry(): THREE.BufferGeometry {
  const spans: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    for (let i = 1; i < CABLE_CAR.path.length; i++) {
      const a = CABLE_CAR.path[i - 1]!
      const b = CABLE_CAR.path[i]!
      spans.push(
        cableSpan(
          new THREE.Vector3(a.x + CABLE_SIDE.x * side, a.y + CABLE_DROP, a.z + CABLE_SIDE.z * side),
          new THREE.Vector3(b.x + CABLE_SIDE.x * side, b.y + CABLE_DROP, b.z + CABLE_SIDE.z * side),
        ),
      )
    }
  }
  const merged = mergeGeometries(spans, false)!
  spans.forEach((span) => span.dispose())
  return merged
}

/** One cabin's body and its ironwork, floor at local y = 0 so it sits on `cabinAt`. */
function cabinGeometry(): { body: THREE.BufferGeometry; iron: THREE.BufferGeometry } {
  const body = [
    box(1.15, 0.09, 1.15, 0, -0.045, 0),
    // Waist-high sides; the rest is open, because the view is the point.
    box(1.15, 0.72, 0.05, 0, 0.36, -0.55),
    box(1.15, 0.72, 0.05, 0, 0.36, 0.55),
    box(0.05, 0.72, 1.15, -0.55, 0.36, 0),
    box(0.05, 0.72, 1.15, 0.55, 0.36, 0),
    box(1.25, 0.07, 1.25, 0, 1.95, 0),
  ]
  const iron: THREE.BufferGeometry[] = [
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => box(0.06, 1.95, 0.06, sx * 0.53, 0.975, sz * 0.53)),
    ),
    box(0.08, CABLE_DROP - 1.95, 0.08, 0, (1.95 + CABLE_DROP) / 2, 0),
  ]
  const wheel = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10)
  wheel.rotateX(Math.PI / 2)
  wheel.translate(0, CABLE_DROP, 0)
  iron.push(wheel)
  return { body: mergeGeometries(body, false)!, iron: mergeGeometries(iron, false)! }
}

function Cabins() {
  const a = useRef<THREE.Group>(null)
  const b = useRef<THREE.Group>(null)

  const parts = useMemo(() => cabinGeometry(), [])
  useEffect(
    () => () => {
      parts.body.dispose()
      parts.iron.dispose()
    },
    [parts],
  )

  // Facing along the line, once: the course only bends in elevation.
  const yaw = useMemo(
    () =>
      Math.atan2(CABLE_CAR.top.x - CABLE_CAR.base.x, CABLE_CAR.top.z - CABLE_CAR.base.z),
    [],
  )

  useFrame(() => {
    const east = cabinAt(cableRide.lineT)
    const west = cabinAt(1 - cableRide.lineT)
    a.current?.position.set(east.x + CABLE_SIDE.x, east.y, east.z + CABLE_SIDE.z)
    b.current?.position.set(west.x - CABLE_SIDE.x, west.y, west.z - CABLE_SIDE.z)
  })

  const cabin = (ref: React.RefObject<THREE.Group | null>) => (
    <group ref={ref} rotation-y={yaw}>
      <mesh geometry={parts.body} castShadow>
        <meshStandardMaterial color="#7d3c33" roughness={0.85} />
      </mesh>
      <mesh geometry={parts.iron}>
        <meshStandardMaterial color="#4b4e4a" roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  )

  return (
    <group>
      {cabin(a)}
      {cabin(b)}
    </group>
  )
}

export function Mountains() {
  const range = useMemo(() => rangeGeometry(), [])
  const structure = useMemo(() => structureGeometry(), [])
  const cables = useMemo(() => cableGeometry(), [])
  useEffect(
    () => () => {
      range.dispose()
      structure.deck.dispose()
      structure.timber.dispose()
      cables.dispose()
    },
    [range, structure, cables],
  )

  return (
    <group>
      {/* The range itself. It receives the sun's shadow box near the base
          station but casts none: it is the largest surface out here, and its
          own shading carries the form. */}
      <mesh geometry={range} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} flatShading />
      </mesh>

      <mesh geometry={structure.deck} receiveShadow>
        <meshStandardMaterial color="#8f7a55" roughness={0.9} map={woodGrainTexture()} />
      </mesh>
      <mesh geometry={structure.timber} castShadow>
        <meshStandardMaterial color="#6f5b3e" roughness={0.92} />
      </mesh>

      <mesh geometry={cables}>
        <meshStandardMaterial color="#3c3f3c" roughness={0.55} metalness={0.5} />
      </mesh>

      <Cabins />
    </group>
  )
}
