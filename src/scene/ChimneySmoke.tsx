import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ambienceBlend, colorCorners, mixColor } from './ambienceBlend'
import { mulberry32 } from '../lib/rng'
import { useAmbienceStore } from '../state/ambience'
import { useWorldStore } from '../state/world'

/**
 * Smoke over a lit fire.
 *
 * Every fireplace in the document gets a brick stack rising through the roof
 * above its hearth, and — while the fire is on — a column of puffs climbing
 * out of it and drifting east. Seen from the trail, a thread of smoke is what
 * says somebody is home, which is the same job the window glow does after dark.
 *
 * The puffs are one instanced mesh across every fireplace in the world. A puff
 * fades by *shrinking* at the end of its climb rather than by alpha, because an
 * instanced material has one opacity for everyone; a sphere dwindling into the
 * sky reads as dissolving, which is all that is asked of it. Colour follows the
 * ambience blend so the smoke is pale against a day sky and barely-there
 * against a dark one.
 */
const PUFFS_PER_FIRE = 9
/** How far a puff climbs before it is gone, and how far the wind carries it. */
const CLIMB = 2.6
const DRIFT = 0.9

const SMOKE_COLOUR = colorCorners({
  day: '#c9cdd2',
  dayRain: '#a8adb3',
  night: '#3c424c',
  nightRain: '#33383f',
})

type Stack = {
  id: string
  defaultOn: boolean
  x: number
  z: number
  /** The ceiling of the room the fire is in: where the masonry may start. */
  base: number
  top: number
}
type Puff = { stack: number; phase: number; speed: number; wobble: number; side: number }

export function ChimneySmoke() {
  const world = useWorldStore((s) => s.world)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  /**
   * One stack per fireplace: from its room's ceiling to just above the wall
   * plate, which is high enough to clear the slope of the roof it comes out of.
   */
  const stacks = useMemo<Stack[]>(() => {
    if (!world) return []
    return world.lights
      .filter((lamp) => lamp.kind === 'fireplace')
      .flatMap((lamp) => {
        const room = world.rooms.find((candidate) => candidate.id === lamp.roomId)
        if (!room) return []
        return [
          {
            id: lamp.id,
            defaultOn: lamp.defaultOn,
            x: lamp.x,
            z: lamp.z,
            base: room.elevation + room.height,
            top: room.elevation + room.height + 0.85,
          },
        ]
      })
  }, [world])

  const puffs = useMemo<Puff[]>(() => {
    const random = mulberry32(0x5a0e)
    return stacks.flatMap((_, stack) =>
      Array.from({ length: PUFFS_PER_FIRE }, () => ({
        stack,
        phase: random(),
        speed: 0.085 + random() * 0.035,
        wobble: random() * Math.PI * 2,
        side: random() * Math.PI * 2,
      })),
    )
  }, [stacks])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      size: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const node = mesh.current
    if (!node) return
    const t = clock.elapsedTime
    const ambience = useAmbienceStore.getState()
    if (material.current) mixColor(material.current.color, SMOKE_COLOUR)
    // Rain knocks smoke down; it should look sluggish and thin, not cheerful.
    const vigour = 1 - ambienceBlend.rain * 0.45

    puffs.forEach((puff, i) => {
      const stack = stacks[puff.stack]!
      const lit = ambience.isOn(stack.id, stack.defaultOn)
      const age = (t * puff.speed + puff.phase) % 1
      if (!lit) {
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.size.setScalar(0))
        node.setMatrixAt(i, scratch.matrix)
        return
      }
      scratch.position.set(
        stack.x + age * DRIFT + Math.sin(t * 0.7 + puff.wobble) * 0.1 * age,
        stack.top + age * CLIMB * vigour,
        stack.z + Math.sin(t * 0.55 + puff.side) * 0.12 * age,
      )
      // Grow through most of the climb, dwindle over the last quarter.
      const grown = 0.12 + age * 0.5
      const dying = age > 0.72 ? Math.max(0, (1 - age) / 0.28) : 1
      scratch.matrix.compose(
        scratch.position,
        scratch.quaternion,
        scratch.size.setScalar(grown * dying * vigour),
      )
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  // A hand-set bound over every column of smoke, so the mesh culls like
  // anything else instead of being drawn while you face a bookcase — the
  // instances are rewritten around fixed stacks, so the sphere never moves.
  useEffect(() => {
    const node = mesh.current
    if (!node || stacks.length === 0) return
    const box = new THREE.Box3()
    for (const stack of stacks) {
      box.expandByPoint(new THREE.Vector3(stack.x - 1, stack.top, stack.z - 1))
      box.expandByPoint(new THREE.Vector3(stack.x + DRIFT + 1, stack.top + CLIMB + 1, stack.z + 1))
    }
    node.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
  }, [puffs.length, stacks])

  /** Every stack in one geometry: masonry never moves, so one call carries it. */
  const masonry = useMemo(() => {
    if (stacks.length === 0) return null
    const parts = stacks.flatMap((stack) => {
      // From the ceiling up, rather than a fixed length down from the top: a
      // fixed 1.1 m hung a quarter of a metre *below* the ceiling of every room
      // with a fire in it, which in the cabin is a block of brick in the loft,
      // through the top of a bookcase. Lifted off the ceiling plane by a
      // centimetre as well — a box whose bottom face is exactly in that plane
      // is two surfaces at one height, and they shimmer against each other.
      const bottom = stack.base + 0.01
      const height = Math.max(0.2, stack.top - bottom)
      const shaft = new THREE.BoxGeometry(0.44, height, 0.44)
      shaft.translate(stack.x, bottom + height / 2, stack.z)
      // A cap wider than the shaft and a short crown over it: the silhouette
      // that says chimney rather than post, read mostly from the trail.
      const cap = new THREE.BoxGeometry(0.56, 0.07, 0.56)
      cap.translate(stack.x, stack.top + 0.035, stack.z)
      const crown = new THREE.BoxGeometry(0.3, 0.16, 0.3)
      crown.translate(stack.x, stack.top + 0.15, stack.z)
      return [shaft, cap, crown]
    })
    const merged = mergeGeometries(parts, false)
    parts.forEach((part) => part.dispose())
    return merged
  }, [stacks])
  useEffect(() => () => masonry?.dispose(), [masonry])

  if (stacks.length === 0 || !masonry) return null
  return (
    <group>
      {/* The stacks: masonry from just under the wall plate up past the ridge
          line near an eave. Present whether or not the fire is on — a chimney
          is architecture, not an effect. */}
      <mesh geometry={masonry} castShadow>
        <meshStandardMaterial color="#7d5f4d" roughness={1} />
      </mesh>
      <instancedMesh key={puffs.length} ref={mesh} args={[undefined, undefined, puffs.length]}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshBasicMaterial ref={material} transparent opacity={0.22} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}
