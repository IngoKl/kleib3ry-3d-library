import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend } from './ambienceBlend'
import { holdRainGlass, releaseRainGlass } from './rainGlass'
import { player } from '../state/player'
import { useAmbienceStore } from '../state/ambience'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'
import { roomBounds, windowPanes, type Panel } from '../world/derive'
import { GROUND_Y } from '../world/terrain'

/**
 * Weather — the cheapest thing that turns the outside from a picture with two
 * settings into a place, and the room you are in into somewhere you are glad to
 * be inside of.
 *
 * Two halves, separate on purpose. What falls is instanced and follows you,
 * because rain a hundred metres away is fog's problem; what runs down the
 * windows is a texture on the panes the document already derives, so a window
 * somebody adds to their own map is wet without anything being said.
 *
 * A switch rather than a simulation, saved beside the lamps: "is it raining" is
 * a fact about the room in exactly the way "is it night" is.
 */

/** How many drops are in the air. The second number is low performance mode. */
const DROPS = 700
const DROPS_LOW = 220

/** The column of air the rain is drawn in, centred on you, and how tall it is. */
const RADIUS = 13
const FALL = 15

/** How far a roof can stand out past its walls. Nothing rains inside that. */
const EAVES = 0.7

type Drop = { x: number; y: number; z: number; speed: number; sway: number }

/**
 * Recycled rather than respawned: a drop reaching the ground goes back to the
 * top of the column, so the count is fixed and the frame loop allocates nothing.
 * The column travels with you, so you never reach its edge.
 */
function Falling({ keepOut }: { keepOut: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[] }) {
  const low = useSettings((s) => s.lowPerformance)
  const count = low ? DROPS_LOW : DROPS
  const mesh = useRef<THREE.InstancedMesh>(null)
  const paint = useRef<THREE.MeshBasicMaterial>(null)

  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const at = useMemo(() => new THREE.Vector3(), [])
  const spin = useMemo(() => new THREE.Quaternion(), [])
  const size = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const hidden = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  /** Seeded, so the same library rains the same way twice. */
  const drops = useMemo<Drop[]>(() => {
    let seed = 0x51ee
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    return Array.from({ length: count }, () => ({
      x: (random() * 2 - 1) * RADIUS,
      y: random() * FALL,
      z: (random() * 2 - 1) * RADIUS,
      speed: 9 + random() * 7,
      sway: (random() * 2 - 1) * 0.5,
    }))
  }, [count])

  const under = (x: number, z: number) =>
    keepOut.some(
      (box) =>
        x > box.minX - EAVES && x < box.maxX + EAVES && z > box.minZ - EAVES && z < box.maxZ + EAVES,
    )

  useFrame((_, rawDelta) => {
    const node = mesh.current
    if (!node) return
    const delta = Math.min(rawDelta, 1 / 20)

    // The streaks fade on the same eased blend the sky dries by.
    if (paint.current) paint.current.opacity = 0.42 * ambienceBlend.rain

    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i]!
      drop.y -= drop.speed * delta
      if (drop.y < 0) {
        // Back to the top, somewhere else in the column. Its position is stored
        // relative to you, so walking never leaves the rain behind.
        drop.y += FALL
        drop.x = (Math.random() * 2 - 1) * RADIUS
        drop.z = (Math.random() * 2 - 1) * RADIUS
      }

      const x = player.x + drop.x + drop.sway * (drop.y * 0.06)
      const z = player.z + drop.z
      const y = GROUND_Y + drop.y

      // Cheaper than a raycast and as convincing: you notice rain indoors, not
      // its absence in the two metres of eaves outside the window.
      at.set(x, y, z)
      matrix.compose(at, spin, under(x, z) ? hidden : size)
      node.setMatrixAt(i, matrix)
    }

    node.instanceMatrix.needsUpdate = true
  })

  // The bounding sphere is meaningless for a mesh whose instances are rewritten
  // every frame around a moving point, and a wrong one frustum-culls the rain.
  useEffect(() => {
    if (mesh.current) mesh.current.frustumCulled = false
  }, [count])

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      {/* A streak rather than a drop: at any shutter speed a human eye has, a
          falling raindrop is a line. */}
      <boxGeometry args={[0.014, 0.36, 0.014]} />
      <meshBasicMaterial ref={paint} color="#cfe4f2" transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}

/** Water on one pane, laid a hair inside the glass so it never z-fights it. */
function WetPane({
  pane,
  texture,
  register,
}: {
  pane: Panel
  texture: THREE.Texture
  register: Set<THREE.MeshBasicMaterial>
}) {
  const [w, h, d] = pane.size
  const facesX = w < d
  const width = facesX ? d : w
  const paint = useRef<THREE.MeshBasicMaterial>(null)

  // The parent's one frame loop fades every pane — a subscription per window
  // was a callback per frame each, all computing the same number.
  useEffect(() => {
    const bead = paint.current
    if (!bead) return
    register.add(bead)
    return () => {
      register.delete(bead)
    }
  }, [register])

  const own = useMemo(() => {
    const clone = texture.clone()
    // Shares the canvas — three keys uploads by source — so this costs a
    // descriptor, and buys beads the same size on a 4.6 m window and a 1.2 m one.
    clone.needsUpdate = true
    clone.repeat.set(Math.max(1, width / 0.9), Math.max(1, h / 0.9))
    return clone
  }, [texture, width, h])
  useEffect(() => () => own.dispose(), [own])

  // A hair off the glass's plane: both are transparent and neither writes
  // depth, so sharing one is a coin toss per pixel as you move your head.
  const [px, py, pz] = pane.position
  const nudge = 0.008

  return (
    <mesh
      position={facesX ? [px + nudge, py, pz] : [px, py, pz + nudge]}
      rotation-y={facesX ? Math.PI / 2 : 0}
    >
      <planeGeometry args={[width * 0.995, h * 0.995]} />
      <meshBasicMaterial
        ref={paint}
        map={own}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

export function Weather() {
  const raining = useAmbienceStore((s) => s.rain)
  const world = useWorldStore((s) => s.world)

  // "There is still rain in the air": the eased blend is above zero. Stays
  // mounted until it lands, so the shower dries out rather than cutting, and
  // the panes' shared opacity is written here rather than per window.
  const [settling, setSettling] = useState(false)
  const paneMats = useRef(new Set<THREE.MeshBasicMaterial>())
  useFrame(() => {
    const wet = ambienceBlend.rain > 0
    if (wet !== settling) setSettling(wet)
    for (const paint of paneMats.current) paint.opacity = 0.85 * ambienceBlend.rain
  })
  const active = raining || settling

  const panes = useMemo(
    () => (world ? world.rooms.flatMap((room) => windowPanes(room)) : []),
    [world],
  )

  const keepOut = useMemo(
    () => (world ? world.rooms.map((room) => roomBounds(room)) : []),
    [world],
  )

  // Held only while there is rain to draw: a canvas being repainted fifteen
  // times a second on a dry afternoon is fifteen times a second of nothing.
  const texture = useMemo(() => (active ? holdRainGlass() : null), [active])
  useEffect(() => {
    if (!texture) return
    return () => releaseRainGlass()
  }, [texture])

  if (!active || !world || !texture) return null

  return (
    <group>
      <Falling keepOut={keepOut} />
      {panes.map((pane, i) => (
        <WetPane key={`wet-${i}`} pane={pane} texture={texture} register={paneMats.current} />
      ))}
    </group>
  )
}
