import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { between, mulberry32 } from '../lib/rng'
import { roomBounds } from '../world/derive'
import { useWorldStore } from '../state/world'

/**
 * What is out there.
 *
 * The windows used to be filled with a flat blue box standing in for daylight,
 * which is fine until you build a cabin and the whole point is the view. So:
 * ground, a lake to the north, a few hundred conifers, and hills behind them.
 *
 * It is all generated from one seed and drawn in a handful of instanced
 * meshes — five draw calls for the entire outdoors — because none of it is
 * interactive and none of it should ever compete with the books for frame
 * budget. Nothing here is collidable either: you cannot get out of the cabin
 * except onto the porch, and the porch has a railing.
 */

/** How far the ground reaches before the fog has swallowed it anyway. */
const GROUND_RADIUS = 150
const TREE_COUNT = 420
/** Nothing grows this close to the buildings. */
const CLEARING = 4.5

/**
 * The lake, and the clearing that lets you see it.
 *
 * `y` sits a few centimetres *above* the ground plane rather than below it:
 * water carved out of the ground would mean cutting a hole in the ground, and
 * at this distance a sheet laid on top is indistinguishable and free. The
 * numbers that matter are `viewX` and `viewFrom` — the corridor of cleared
 * ground running north from the cabin, without which the north window looks at
 * the backs of forty trees and the whole point of siting the cabin here is lost.
 */
const LAKE = {
  x: -4,
  z: -34,
  radiusX: 34,
  radiusZ: 21,
  y: -0.2,
  viewX: 15,
  viewFrom: -6,
}

const TRUNK = '#4a3826'
const NEEDLES = ['#2f4634', '#35503b', '#28402f', '#3d5940']

type Tree = {
  x: number
  z: number
  height: number
  spread: number
  tint: number
}

/** True where a tree would be standing in the lake, the view, or the kitchen. */
function occupied(x: number, z: number, keepOut: readonly THREE.Box2[]): boolean {
  const lx = (x - LAKE.x) / LAKE.radiusX
  const lz = (z - LAKE.z) / LAKE.radiusZ
  if (lx * lx + lz * lz < 1.15) return true
  // The sight-line from the north windows down to the water.
  if (z < LAKE.viewFrom && Math.abs(x - LAKE.x) < LAKE.viewX) return true
  for (const box of keepOut) {
    if (x > box.min.x && x < box.max.x && z > box.min.y && z < box.max.y) return true
  }
  return false
}

function growForest(keepOut: readonly THREE.Box2[]): Tree[] {
  const random = mulberry32(0x5eed)
  const trees: Tree[] = []

  // Rejection sampling in a ring: uniform in the annulus, thinned near the
  // clearing so the tree line reads as an edge rather than as a wall.
  for (let i = 0; i < TREE_COUNT * 6 && trees.length < TREE_COUNT; i++) {
    const angle = random() * Math.PI * 2
    const distance = 8 + Math.sqrt(random()) * 92
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    if (occupied(x, z, keepOut)) continue
    if (distance < 16 && random() > (distance - 8) / 12) continue

    trees.push({
      x,
      z,
      height: between(random, 5.5, 15),
      spread: between(random, 0.9, 2.1),
      tint: Math.floor(random() * NEEDLES.length),
    })
  }

  return trees
}

/** One instanced mesh per part of a tree: trunks in one, canopies in the other. */
function Forest({ trees }: { trees: Tree[] }) {
  const trunks = useRef<THREE.InstancedMesh>(null)
  const canopies = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()

    trees.forEach((tree, i) => {
      const trunkHeight = tree.height * 0.42
      position.set(tree.x, trunkHeight / 2, tree.z)
      scale.set(tree.spread * 0.16, trunkHeight, tree.spread * 0.16)
      matrix.compose(position, quaternion, scale)
      trunks.current?.setMatrixAt(i, matrix)

      // The canopy overlaps the trunk, which is what stops a conifer looking
      // like a lollipop on a stick.
      const canopyHeight = tree.height * 0.78
      position.set(tree.x, trunkHeight * 0.55 + canopyHeight / 2, tree.z)
      scale.set(tree.spread, canopyHeight, tree.spread)
      matrix.compose(position, quaternion, scale)
      canopies.current?.setMatrixAt(i, matrix)
      canopies.current?.setColorAt(i, colour.set(NEEDLES[tree.tint]!))
    })

    if (trunks.current) {
      trunks.current.instanceMatrix.needsUpdate = true
      trunks.current.computeBoundingSphere()
    }
    if (canopies.current) {
      canopies.current.instanceMatrix.needsUpdate = true
      if (canopies.current.instanceColor) canopies.current.instanceColor.needsUpdate = true
      canopies.current.computeBoundingSphere()
    }
  }, [trees])

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
        <meshStandardMaterial color={TRUNK} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, trees.length]} castShadow>
        <coneGeometry args={[0.5, 1, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}

/**
 * A sky dome rather than a flat clear colour, so there is a horizon to see the
 * hills against. Drawn on the inside of a sphere with a two-stop gradient baked
 * into a 2x64 canvas — cheaper than a shader and easier to argue with.
 */
function Sky() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, 0, 128)
    gradient.addColorStop(0, '#4d7fb5')
    gradient.addColorStop(0.45, '#9dc0dc')
    gradient.addColorStop(0.72, '#d6e4ec')
    gradient.addColorStop(1, '#e8e2d4')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 2, 128)
    const made = new THREE.CanvasTexture(canvas)
    made.colorSpace = THREE.SRGBColorSpace
    return made
  }, [])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh>
      <sphereGeometry args={[GROUND_RADIUS + 40, 24, 16]} />
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.BackSide} fog={false} />
    </mesh>
  )
}

/** Low ridges beyond the lake, to stop the horizon being a straight line. */
function Hills() {
  const hills = useMemo(() => {
    const random = mulberry32(0xb17c)
    return Array.from({ length: 9 }, (_, i) => {
      const angle = Math.PI + ((i + 0.5) / 9 - 0.5) * 2.6
      const distance = between(random, 105, 135)
      return {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        radius: between(random, 28, 55),
        height: between(random, 14, 34),
      }
    })
  }, [])

  // Merged: nine ridges is nine draw calls for something that never moves and
  // is never looked at closely.
  const geometry = useMemo(() => {
    const parts = hills.map((hill) => {
      const cone = new THREE.ConeGeometry(hill.radius, hill.height, 9)
      cone.translate(hill.x, hill.height / 2 - 3, hill.z)
      return cone
    })
    const merged = mergeGeometries(parts, false)
    parts.forEach((part) => part.dispose())
    return merged
  }, [hills])
  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#5b6b70" roughness={1} flatShading />
    </mesh>
  )
}

export function Outside() {
  const world = useWorldStore((s) => s.world)

  /** Trees keep out of every room's footprint, plus a margin to walk in. */
  const keepOut = useMemo(() => {
    if (!world) return []
    return world.rooms.map((room) => {
      const b = roomBounds(room)
      return new THREE.Box2(
        new THREE.Vector2(b.minX - CLEARING, b.minZ - CLEARING),
        new THREE.Vector2(b.maxX + CLEARING, b.maxZ + CLEARING),
      )
    })
  }, [world])

  const trees = useMemo(() => growForest(keepOut), [keepOut])

  return (
    <group>
      <Sky />
      <Hills />

      {/* The ground, a whisker below the cabin floor so the two never z-fight. */}
      <mesh position={[0, -0.32, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 48]} />
        <meshStandardMaterial color="#4c5a3a" roughness={1} />
      </mesh>

      {/* A pale shore, so the water meets the grass at something. Under the
          water and over the grass: three sheets stacked centimetres apart,
          rather than a hole cut in the ground for a lake nobody swims in. */}
      <mesh
        position={[LAKE.x, -0.26, LAKE.z]}
        rotation-x={-Math.PI / 2}
        scale={[LAKE.radiusX + 2.6, LAKE.radiusZ + 2.6, 1]}
      >
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial color="#8f8266" roughness={1} />
      </mesh>

      {/* The lake. Smooth and a little metallic, which at this distance is all
          that separates water from a green field of a different colour. */}
      <mesh
        position={[LAKE.x, LAKE.y, LAKE.z]}
        rotation-x={-Math.PI / 2}
        scale={[LAKE.radiusX, LAKE.radiusZ, 1]}
      >
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial color="#3f6076" roughness={0.12} metalness={0.55} />
      </mesh>

      <Forest trees={trees} />

      {/* Haze, which is what makes a hundred metres of forest read as distance
          rather than as a lot of cones. Thin enough not to fog the room. */}
      <fogExp2 attach="fog" args={['#c3d2dd', 0.0085]} />
    </group>
  )
}
