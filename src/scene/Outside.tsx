import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { between, mulberry32 } from '../lib/rng'
import { PROPORTIONS, type Tree } from '../world/forest'
import {
  GROUND_RADIUS,
  GROUND_Y,
  LAKE,
  SHORE_EDGE,
  SHORE_Y,
  WATER_Y,
} from '../world/terrain'
import { useLightStore } from '../state/lights'
import { useWorldStore } from '../state/world'

/**
 * What is out there.
 *
 * The windows used to be filled with a flat blue box standing in for daylight,
 * which is fine until you build a cabin and the whole point is the view. So:
 * ground, a lake to the north, a few hundred conifers, and hills behind them.
 *
 * It is all generated from one seed and drawn in a handful of instanced
 * meshes — eight draw calls for the entire outdoors — because none of it should
 * ever compete with the books for frame budget.
 *
 * What has changed is that it is no longer only scenery. You can walk out of
 * the porch and round the water now, so where the lake is and where the trees
 * are are answers the walk controller needs as much as this file does — and
 * they therefore live in `world/terrain.ts` and `world/forest.ts`, with this
 * module reading them rather than inventing them. A shoreline you can see in
 * one place and stand in in another is the bug that arrangement prevents.
 */

const TRUNK = '#4a3826'
const BIRCH_BARK = '#cfc9ba'
const FIR_NEEDLES = ['#2f4634', '#35503b', '#28402f', '#3d5940']
const PINE_NEEDLES = ['#2c4234', '#31493c', '#263c2e']
const BIRCH_LEAVES = ['#5f7d40', '#6f8d4a', '#527239', '#7d9451']

/**
 * One instanced mesh per part: every trunk in one draw call, then one call per
 * species of canopy. Four calls for four hundred trees.
 */
function Forest({ trees }: { trees: Tree[] }) {
  const trunks = useRef<THREE.InstancedMesh>(null)
  const firs = useRef<THREE.InstancedMesh>(null)
  const pines = useRef<THREE.InstancedMesh>(null)
  const birches = useRef<THREE.InstancedMesh>(null)

  const bySpecies = useMemo(
    () => ({
      fir: trees.filter((tree) => tree.species === 'fir'),
      pine: trees.filter((tree) => tree.species === 'pine'),
      birch: trees.filter((tree) => tree.species === 'birch'),
    }),
    [trees],
  )

  // Canopy geometry per species, unit height with the base at y = 0 so an
  // instance's scale is simply (spread, canopy height, spread).
  const canopyGeometry = useMemo(() => {
    const cone = (radius: number, height: number, centreY: number) => {
      const g = new THREE.ConeGeometry(radius, height, 7)
      g.translate(0, centreY, 0)
      return g
    }
    // A fir is a stack of skirts, each overlapping the one below.
    const fir = mergeGeometries([cone(0.62, 0.5, 0.25), cone(0.48, 0.46, 0.52), cone(0.34, 0.44, 0.78)], false)!
    // A pine carries its crown at the top of a bare trunk.
    const pine = mergeGeometries([cone(0.5, 0.7, 0.35), cone(0.34, 0.42, 0.79)], false)!
    // A birch head is rounded, not conical.
    const birch = new THREE.SphereGeometry(0.5, 7, 5)
    birch.scale(1, 1.15, 1)
    birch.translate(0, 0.5, 0)
    return { fir, pine, birch }
  }, [])
  useEffect(
    () => () => {
      canopyGeometry.fir.dispose()
      canopyGeometry.pine.dispose()
      canopyGeometry.birch.dispose()
    },
    [canopyGeometry],
  )

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const turn = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()

    trees.forEach((tree, i) => {
      const shape = PROPORTIONS[tree.species]
      const trunkHeight = tree.height * shape.trunk
      position.set(tree.x, trunkHeight / 2, tree.z)
      scale.set(tree.spread * shape.girth, trunkHeight, tree.spread * shape.girth)
      matrix.compose(position, quaternion.identity(), scale)
      trunks.current?.setMatrixAt(i, matrix)
      trunks.current?.setColorAt(i, colour.set(tree.species === 'birch' ? BIRCH_BARK : TRUNK))
    })

    const palettes: Record<Tree['species'], string[]> = {
      fir: FIR_NEEDLES,
      pine: PINE_NEEDLES,
      birch: BIRCH_LEAVES,
    }
    const fill = (mesh: THREE.InstancedMesh | null, list: Tree[]) => {
      if (!mesh) return
      list.forEach((tree, i) => {
        const shape = PROPORTIONS[tree.species]
        const canopyHeight = tree.height * (1 - shape.canopyFrom)
        position.set(tree.x, tree.height * shape.canopyFrom, tree.z)
        scale.set(tree.spread, canopyHeight, tree.spread)
        matrix.compose(position, turn.setFromAxisAngle(up, tree.yaw), scale)
        mesh.setMatrixAt(i, matrix)
        const palette = palettes[tree.species]
        mesh.setColorAt(i, colour.set(palette[tree.tint % palette.length]!))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }

    if (trunks.current) {
      trunks.current.instanceMatrix.needsUpdate = true
      if (trunks.current.instanceColor) trunks.current.instanceColor.needsUpdate = true
      trunks.current.computeBoundingSphere()
    }
    fill(firs.current, bySpecies.fir)
    fill(pines.current, bySpecies.pine)
    fill(birches.current, bySpecies.birch)
  }, [trees, bySpecies, canopyGeometry])

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={firs}
        args={[canopyGeometry.fir, undefined, bySpecies.fir.length]}
        castShadow
      >
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={pines}
        args={[canopyGeometry.pine, undefined, bySpecies.pine.length]}
        castShadow
      >
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={birches}
        args={[canopyGeometry.birch, undefined, bySpecies.birch.length]}
        castShadow
      >
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
function Sky({ night }: { night: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    // Wide enough to scatter stars into at night; the day gradient does not care.
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, 0, 128)
    if (night) {
      gradient.addColorStop(0, '#0a1024')
      gradient.addColorStop(0.5, '#141d33')
      gradient.addColorStop(0.78, '#1d2536')
      gradient.addColorStop(1, '#12141c')
    } else {
      gradient.addColorStop(0, '#4d7fb5')
      gradient.addColorStop(0.45, '#9dc0dc')
      gradient.addColorStop(0.72, '#d6e4ec')
      gradient.addColorStop(1, '#e8e2d4')
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (night) {
      // A seeded scatter of stars in the upper half, brighter towards the top.
      const random = mulberry32(0x57a2)
      for (let i = 0; i < 220; i++) {
        const x = random() * canvas.width
        const y = random() * canvas.height * 0.6
        const bright = 0.35 + random() * 0.65 * (1 - y / (canvas.height * 0.6))
        ctx.fillStyle = `rgba(232, 238, 255, ${bright.toFixed(2)})`
        ctx.fillRect(x, y, random() > 0.85 ? 1.5 : 1, 1)
      }
    }

    const made = new THREE.CanvasTexture(canvas)
    made.colorSpace = THREE.SRGBColorSpace
    return made
  }, [night])
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
      <meshStandardMaterial color="#59685f" roughness={1} flatShading />
    </mesh>
  )
}

export function Outside() {
  const world = useWorldStore((s) => s.world)
  const night = useLightStore((s) => s.night)

  // The same trunks the walk controller collides with. Grown in `deriveWorld`
  // rather than here, which is what stops the forest you can see and the forest
  // you can bump into drifting apart.
  const trees = world?.trees ?? []

  return (
    <group>
      {/* The clear colour behind everything lives with the sky it has to match,
          not in App: the two changing in different frames is a visible flash. */}
      <color attach="background" args={[night ? '#0b101c' : '#9dc0dc']} />
      <Sky night={night} />
      <Hills />

      {/* The ground you now walk on, a whisker below the floor slabs so the two
          never z-fight and the reveal reads as a shadow line at the base of a
          wall rather than as a cabin standing on air. */}
      <mesh position={[0, GROUND_Y, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 48]} />
        <meshStandardMaterial color="#4a5c34" roughness={1} />
      </mesh>

      {/* A pale shore, so the water meets the grass at something. Under the
          water and over the grass: three sheets stacked centimetres apart,
          rather than a hole cut in the ground for a lake nobody swims in.
          The gaps used to be 6 cm, which was fine while the nearest you could
          get was a window; standing on the beach they read as three floating
          discs, so they are 1.5 cm now. The beach itself is walkable — the
          refusal is at the water's edge, inside it. */}
      <mesh
        position={[LAKE.x, SHORE_Y, LAKE.z]}
        rotation-x={-Math.PI / 2}
        scale={[LAKE.radiusX * SHORE_EDGE, LAKE.radiusZ * SHORE_EDGE, 1]}
      >
        <circleGeometry args={[1, 64]} />
        <meshStandardMaterial color="#8f8266" roughness={1} />
      </mesh>

      {/* The lake. Smooth and a little metallic, which at this distance is all
          that separates water from a green field of a different colour. */}
      <mesh
        position={[LAKE.x, WATER_Y, LAKE.z]}
        rotation-x={-Math.PI / 2}
        scale={[LAKE.radiusX, LAKE.radiusZ, 1]}
      >
        <circleGeometry args={[1, 64]} />
        <meshStandardMaterial color="#3f6076" roughness={0.12} metalness={0.55} />
      </mesh>

      <Forest trees={trees} />

      {/* Haze, which is what makes a hundred metres of forest read as distance
          rather than as a lot of cones. Thin enough not to fog the room. At
          night it thickens a little and goes dark, which is what darkness at a
          distance actually looks like. */}
      <fogExp2 attach="fog" args={night ? ['#101624', 0.0105] : ['#c3d2dd', 0.0085]} />
    </group>
  )
}
