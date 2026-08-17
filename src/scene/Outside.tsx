import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  advanceAmbience,
  ambienceBlend,
  colorCorners,
  goldenWarmth,
  mixColor,
  mixNumber,
} from './ambienceBlend'
import { between, mulberry32 } from '../lib/rng'
import { CLEARING, PROPORTIONS, occupied, type Tree } from '../world/forest'
import { roomBounds, type Bounds } from '../world/derive'
import {
  BRIDGES,
  BRIDGE_DECK,
  BRIDGE_Y,
  BROOK_BED_Y,
  BROOK_WATER_Y,
  GROUND_RADIUS,
  GROUND_Y,
  LAKE,
  PATH,
  SHORE_EDGE,
  SHORE_Y,
  STREAM,
  TRAILS,
  TRAIL_WIDTH,
  WALK_RADIUS,
  WATER_Y,
  lakePoint,
  lakeRadius,
  onTrail,
  streamWidth,
} from '../world/terrain'
import { groundMottleTexture } from './materials'
import { MOON_DIRECTION, radialGlowTexture } from './sky'
import { CloudBank, MoonGlint, SunGlow } from './SkyDressing'
import { Undergrowth } from './Undergrowth'
import { Fireflies } from './Fireflies'
import { FallingLeaves } from './FallingLeaves'
import { useAmbienceStore } from '../state/ambience'
import { useWorldStore } from '../state/world'

/**
 * What is out there.
 *
 * The alternative is a flat blue box in the windows standing in for daylight,
 * which is fine until you build a cabin and the whole point is the view. So:
 * ground, a lake to the north, a few hundred conifers, and hills behind them.
 *
 * It is all generated from seeds and drawn in a handful of instanced meshes —
 * about two dozen draw calls for the entire outdoors, dressing included —
 * because none of it should ever compete with the books for frame budget.
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
 * The canopies swaying: a few centimetres of lean, rising with height so the
 * base stays planted, phased off each instance's root so the forest moves as
 * hundreds of trees rather than one. Injected after `begin_vertex`, where
 * `transformed` is still in the unit canopy's local space.
 */
const SWAY_GLSL = /* glsl */ `
{
  vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float phase = root.x * 0.37 + root.z * 0.53;
  float lean = max(transformed.y, 0.0);
  float wave = sin(uTime * 0.8 + phase) + 0.55 * sin(uTime * 1.9 + phase * 1.7);
  transformed.x += wave * 0.045 * lean * lean;
  transformed.z += wave * 0.03 * lean * lean * sin(phase);
}
`

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

  // One clock for every canopy: the three materials share this object, so a
  // single write per frame sways the whole forest.
  const sway = useMemo(() => ({ value: 0 }), [])
  useFrame((s) => {
    sway.value = s.clock.elapsedTime
  })

  // The depth material is deliberately left unpatched: canopy shadows holding
  // still under a ~10 cm sway is imperceptible.
  const canopyMaterials = useMemo(() => {
    const make = () => {
      const material = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = sway
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`)
      }
      return material
    }
    return { fir: make(), pine: make(), birch: make() }
  }, [sway])
  useEffect(
    () => () => {
      canopyMaterials.fir.dispose()
      canopyMaterials.pine.dispose()
      canopyMaterials.birch.dispose()
    },
    [canopyMaterials],
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
    const turn = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()

    // Per-tree squash and shade, seeded through the yaw the tree already
    // carries so trunk and canopy agree without another field — an ellipse and
    // a touch of light are what break "the same tree stamped 420 times".
    const squash = (tree: Tree) => 1 + 0.12 * Math.sin(tree.yaw * 5)
    const shade = (tree: Tree) => 0.92 + 0.16 * (0.5 + 0.5 * Math.sin(tree.yaw * 9.3))

    trees.forEach((tree, i) => {
      const shape = PROPORTIONS[tree.species]
      const trunkHeight = tree.height * shape.trunk
      const girth = tree.spread * shape.girth
      const oval = squash(tree)
      position.set(tree.x, trunkHeight / 2, tree.z)
      scale.set(girth * oval, trunkHeight, girth / oval)
      matrix.compose(position, turn.setFromAxisAngle(up, tree.yaw), scale)
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
        const oval = squash(tree)
        position.set(tree.x, tree.height * shape.canopyFrom, tree.z)
        scale.set(tree.spread * oval, canopyHeight, tree.spread / oval)
        matrix.compose(position, turn.setFromAxisAngle(up, tree.yaw), scale)
        mesh.setMatrixAt(i, matrix)
        const palette = palettes[tree.species]
        mesh.setColorAt(i, colour.set(palette[tree.tint % palette.length]!).multiplyScalar(shade(tree)))
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
        args={[canopyGeometry.fir, canopyMaterials.fir, bySpecies.fir.length]}
        castShadow
      />
      <instancedMesh
        ref={pines}
        args={[canopyGeometry.pine, canopyMaterials.pine, bySpecies.pine.length]}
        castShadow
      />
      <instancedMesh
        ref={birches}
        args={[canopyGeometry.birch, canopyMaterials.birch, bySpecies.birch.length]}
        castShadow
      />
    </group>
  )
}

/**
 * The ground disc with a swell on its rim.
 *
 * Flat across everything that walks or stands — `terrainAt` refuses steps past
 * 96 m and the forest grows to about 100, so displacement is pinned to zero
 * through both — then rising into a low undulation towards the rim, which is
 * what stops the horizon under the mist reading as the edge of a perfect
 * circle. Collision is untouched: the swell starts where you cannot go.
 */
function groundGeometry(segments = 48): THREE.BufferGeometry {
  // Flat out to the walk, and for a few metres past it where the last trees
  // stand; the swell is entirely beyond both, so growing the valley is a matter
  // of the two radii and nothing here has to be re-tuned by hand.
  const flat = WALK_RADIUS + 10
  const rings = [WALK_RADIUS, ...[0, 1, 2, 3, 4].map((i) => flat + ((GROUND_RADIUS - flat) * i) / 4)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  // The three sines sum to at most 1.95; scaled so the rim reaches ±2.2 m.
  const amplitude = 2.2 / 1.95
  const swell = (r: number, a: number) =>
    smooth(Math.max(0, (r - flat) / (GROUND_RADIUS - flat))) *
    amplitude *
    (Math.sin(3 * a + 1.2) + 0.6 * Math.sin(5 * a + 4.0) + 0.35 * Math.sin(8 * a + 2.4))

  const positions: number[] = [0, 0, 0]
  for (const r of rings) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(Math.cos(a) * r, swell(r, a), Math.sin(a) * r)
    }
  }

  // Planar UVs in world metres, so the mottle neither cares about ring count
  // nor stretches over the swell.
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push(positions[i]! / 300 + 0.5, positions[i + 2]! / 300 + 0.5)
  }

  const indices: number[] = []
  // Centre fan out to the first ring; centre, next, current points the face up.
  for (let i = 0; i < segments; i++) indices.push(0, 1 + ((i + 1) % segments), 1 + i)
  for (let ring = 0; ring < rings.length - 1; ring++) {
    const inner = 1 + ring * segments
    const outer = inner + segments
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments
      indices.push(inner + i, outer + next, outer + i)
      indices.push(inner + i, inner + next, outer + next)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * One sheet of the lake, as a triangle fan round the shoreline the walk
 * controller refuses steps at.
 *
 * Built from `lakePoint` rather than from a scaled circle because the outline
 * has a wobble on it now: a circle geometry scaled to the ellipse would draw
 * the compass-drawing lake while `lakeRadius` walked you to the organic one,
 * and the two disagreeing at the water's edge is exactly the bug the terrain
 * module exists to prevent. `r` is in shoreline units — 1 is the water,
 * `SHORE_EDGE` is the sand under it.
 */
function lakeSheet(r: number, segments = 96): THREE.BufferGeometry {
  const positions = new Float32Array((segments + 1) * 3)
  const normals = new Float32Array((segments + 1) * 3)
  const uvs = new Float32Array((segments + 1) * 2)
  positions[0] = LAKE.x
  positions[2] = LAKE.z
  for (let i = 0; i < segments; i++) {
    const [x, z] = lakePoint((i / segments) * Math.PI * 2, r)
    positions[(i + 1) * 3] = x
    positions[(i + 1) * 3 + 2] = z
  }
  for (let i = 0; i <= segments; i++) normals[i * 3 + 1] = 1
  // Planar UVs in world metres, so the ripple texture neither stretches with
  // the wobbled outline nor cares how many segments the fan has.
  for (let i = 0; i <= segments; i++) {
    uvs[i * 2] = positions[i * 3]! / 8
    uvs[i * 2 + 1] = positions[i * 3 + 2]! / 8
  }

  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    // Centre, next, current — this winding is what points the face up.
    indices.push(0, 1 + ((i + 1) % segments), 1 + i)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * A tileable normal map for the water, synthesised rather than shipped.
 *
 * A handful of integer-frequency waves summed over the tile — integer so the
 * edges meet — then differentiated into normals. Scrolling this across the lake
 * is what turns a static sheet into water; the amplitude of the effect lives in
 * `normalScale`, which the frame loop raises when it rains.
 */
function makeWaterNormals(size = 128): THREE.CanvasTexture {
  const waves: readonly (readonly [number, number, number, number])[] = [
    [1, 2, 1.0, 0.0],
    [3, 1, 0.6, 1.7],
    [2, 5, 0.4, 3.1],
    [5, 3, 0.3, 4.2],
    [7, 6, 0.22, 0.9],
  ]
  const heightAt = (x: number, y: number) => {
    let h = 0
    for (const [fx, fy, amplitude, phase] of waves)
      h += amplitude * Math.sin(((fx * x + fy * y) / size) * Math.PI * 2 + phase)
    return h
  }

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const strength = 1.4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength
      const inv = 1 / Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      image.data[i] = (-dx * inv * 0.5 + 0.5) * 255
      image.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255
      image.data[i + 2] = (inv * 0.5 + 0.5) * 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/**
 * The gradient's stops at each corner of the weather, top of the dome first.
 * Every corner has the same four offsets so a stop can be lerped against its
 * opposite number as day fades to night or the rain comes over.
 */
const SKY_OFFSETS = [0, 0.45, 0.72, 1] as const
const SKY_STOPS = [
  colorCorners({ day: '#4d7fb5', dayRain: '#5d6771', night: '#0a1024', nightRain: '#141721' }),
  colorCorners({ day: '#9dc0dc', dayRain: '#7e8892', night: '#141d33', nightRain: '#181c26' }),
  colorCorners({ day: '#d6e4ec', dayRain: '#9aa3aa', night: '#1d2536', nightRain: '#1b1f29' }),
  colorCorners({ day: '#e8e2d4', dayRain: '#adb2b0', night: '#12141c', nightRain: '#191c22' }),
]

/**
 * Where each stop leans during the golden hour, strongest at the horizon —
 * dusk lives where the sun is going down, and the zenith stays cool.
 */
const GOLDEN_SKY = ['#5a5f8a', '#c08a68', '#e8a05c', '#e8955a'].map((c) => new THREE.Color(c))
const GOLDEN_SKY_STRENGTH = [0.15, 0.3, 0.55, 0.7] as const


/**
 * The stars, as a point cloud on the inside of the dome rather than pixels in
 * the sky canvas. The canvas is 256 px stretched over the whole horizon, so a
 * star painted into it smeared into a dash; a point stays a couple of pixels
 * wherever on the dome it sits, and each one twinkles on its own phase. Faded
 * in with the dark and back out under cloud, because what a rainy night takes
 * off a clear one is the stars, not more brightness — and the whole cloud is
 * hidden by day, so it costs nothing while the sun is up.
 */
const STAR_COUNT = 750

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aTint;
  uniform float uPixel;
  varying float vPhase;
  varying float vSpeed;
  varying vec3 vTint;
  void main() {
    vPhase = aPhase;
    vSpeed = aSpeed;
    vTint = aTint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixel;
  }
`

const STAR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying float vPhase;
  varying float vSpeed;
  varying vec3 vTint;
  void main() {
    // A soft round dot, not the square a bare point is.
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.12, d);
    // The sparkle: each star breathes on its own phase and rate.
    float twinkle = 0.68 + 0.32 * sin(uTime * vSpeed + vPhase);
    gl_FragColor = vec4(vTint, uAlpha * disc * twinkle);
  }
`

function Stars() {
  const points = useRef<THREE.Points>(null)

  const { geometry, material } = useMemo(() => {
    const random = mulberry32(0x57a2)
    const positions = new Float32Array(STAR_COUNT * 3)
    const sizes = new Float32Array(STAR_COUNT)
    const phases = new Float32Array(STAR_COUNT)
    const speeds = new Float32Array(STAR_COUNT)
    const tints = new Float32Array(STAR_COUNT * 3)

    // Between the moon (radius + 28) and the dome (+ 40), so the disc draws
    // over the stars behind it and the dome never clips them.
    const radius = GROUND_RADIUS + 36
    const cool = new THREE.Color('#e8eeff')
    const warm = new THREE.Color('#ffe7c4')
    const blue = new THREE.Color('#cfe0ff')
    const tint = new THREE.Color()

    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform over the dome above the treeline: a uniform y on a sphere is a
      // uniform area, so the zenith is no denser than the horizon.
      const y = 0.05 + random() * 0.95
      const azimuth = random() * Math.PI * 2
      const flat = Math.sqrt(1 - y * y)
      positions[i * 3] = Math.cos(azimuth) * flat * radius
      positions[i * 3 + 1] = y * radius
      positions[i * 3 + 2] = Math.sin(azimuth) * flat * radius

      // Tiny, with a scatter of brighter ones — the handful you notice first.
      const bright = random()
      sizes[i] = bright > 0.94 ? between(random, 2.6, 3.4) : between(random, 1.1, 2.2)
      phases[i] = random() * Math.PI * 2
      speeds[i] = between(random, 0.5, 2.2)

      const pick = random()
      tint.copy(pick < 0.72 ? cool : pick < 0.88 ? blue : warm)
      // Fainter stars are fainter, not smaller: brightness carries the depth.
      tint.multiplyScalar(0.45 + 0.55 * bright)
      tints[i * 3] = tint.r
      tints[i * 3 + 1] = tint.g
      tints[i * 3 + 2] = tint.b
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3))

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uPixel: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    return { geometry, material }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(({ clock, gl }) => {
    const node = points.current
    if (!node) return
    const alpha = ambienceBlend.night * (1 - ambienceBlend.rain)
    node.visible = alpha > 0.02
    if (!node.visible) return
    material.uniforms.uTime!.value = clock.elapsedTime
    material.uniforms.uAlpha!.value = alpha
    material.uniforms.uPixel!.value = gl.getPixelRatio()
  })

  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      visible={false}
      frustumCulled={false}
    />
  )
}

/**
 * A sky dome rather than a flat clear colour, so there is a horizon to see the
 * hills against. Drawn on the inside of a sphere with a gradient baked into a
 * small canvas — cheaper than a shader and easier to argue with. The canvas is
 * repainted per frame *only while the ambience is fading*, so day into night is
 * a dusk rather than a cut; a settled sky costs nothing.
 */
function Sky() {
  const night = useAmbienceStore((s) => s.night)
  const rain = useAmbienceStore((s) => s.rain)
  const moonRef = useRef<THREE.MeshBasicMaterial>(null)
  const haloRef = useRef<THREE.MeshBasicMaterial>(null)

  const sky = useMemo(() => {
    const canvas = document.createElement('canvas')
    // Only a vertical gradient lives here; the stars are a point cloud now.
    canvas.width = 256
    canvas.height = 128
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return { canvas, ctx: canvas.getContext('2d')!, texture }
  }, [])
  useEffect(() => () => sky.texture.dispose(), [sky])

  // A soft radial glow behind the moon's disc, drawn once.
  const halo = useMemo(
    () =>
      radialGlowTexture(64, [
        [0, 'rgba(214, 226, 248, 0.8)'],
        [0.4, 'rgba(190, 205, 235, 0.28)'],
        [1, 'rgba(190, 205, 235, 0)'],
      ]),
    [],
  )
  useEffect(() => () => halo.dispose(), [halo])

  const paint = (colour: THREE.Color) => {
    const { canvas, ctx, texture } = sky
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    // Golden hour: derived from the same two numbers the repaint check
    // watches, so a settled sky still repaints only when night or rain moves.
    const warmth = goldenWarmth()
    SKY_OFFSETS.forEach((offset, i) => {
      mixColor(colour, SKY_STOPS[i]!)
      colour.lerp(GOLDEN_SKY[i]!, GOLDEN_SKY_STRENGTH[i]! * warmth)
      gradient.addColorStop(offset, `#${colour.getHexString()}`)
    })
    ctx.globalAlpha = 1
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
  }

  // Repaint only when the blend has actually moved since the last paint.
  const painted = useRef({ night: -1, rain: -1 })
  const scratch = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const at = painted.current
    if (at.night !== ambienceBlend.night || at.rain !== ambienceBlend.rain) {
      at.night = ambienceBlend.night
      at.rain = ambienceBlend.rain
      paint(scratch)
    }
    const moonlight = ambienceBlend.night * (1 - ambienceBlend.rain * 0.85)
    if (moonRef.current) {
      moonRef.current.opacity = moonlight
      moonRef.current.visible = moonlight > 0.02
    }
    if (haloRef.current) {
      haloRef.current.opacity = moonlight * 0.55
      haloRef.current.visible = moonlight > 0.02
    }
  })

  // Painted before the first frame so the dome never renders black.
  useLayoutEffect(() => {
    painted.current = { night: ambienceBlend.night, rain: ambienceBlend.rain }
    paint(scratch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, rain, sky])

  const moonAt = useMemo(() => MOON_DIRECTION.clone().multiplyScalar(GROUND_RADIUS + 25), [])
  const haloAt = useMemo(() => MOON_DIRECTION.clone().multiplyScalar(GROUND_RADIUS + 28), [])
  const faceIn = (mesh: THREE.Mesh | null) => mesh?.lookAt(0, 0, 0)

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GROUND_RADIUS + 40, 24, 16]} />
        <meshBasicMaterial map={sky.texture} toneMapped={false} side={THREE.BackSide} fog={false} />
      </mesh>
      {/* The halo first and further out, so the disc draws over it. */}
      <mesh position={haloAt} ref={faceIn}>
        <circleGeometry args={[19, 20]} />
        <meshBasicMaterial
          ref={haloRef}
          map={halo}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <mesh position={moonAt} ref={faceIn}>
        <circleGeometry args={[6.5, 24]} />
        <meshBasicMaterial
          ref={moonRef}
          color="#e9edf6"
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <Stars />
    </group>
  )
}

/**
 * The trail between the two buildings: worn earth, laid on top of the grass.
 *
 * One quad per leg plus a disc at each bend, merged into a single geometry. The
 * discs are what make a corner read as a corner rather than as two planks with a
 * notch bitten out of the inside of the turn.
 *
 * Drawn a centimetre over the ground for the same reason the beach is: three
 * sheets stacked centimetres apart beats cutting a hole in a circle you can walk
 * on. It is scenery only — the ground under it is walkable because it is ground,
 * not because there is a path on it.
 */
function Trail() {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const half = TRAIL_WIDTH / 2

    for (const line of TRAILS) {
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = line[i - 1]!
        const [bx, bz] = line[i]!
        const length = Math.hypot(bx - ax, bz - az)
        if (length < 1e-6) continue
        const strip = new THREE.PlaneGeometry(TRAIL_WIDTH, length)
        strip.rotateX(-Math.PI / 2)
        // The plane's local +Y runs along the leg once it is laid flat, so the
        // turn is measured from +Z.
        strip.rotateY(-Math.atan2(bx - ax, bz - az))
        strip.translate((ax + bx) / 2, 0, (az + bz) / 2)
        parts.push(strip)
      }

      for (const [x, z] of line) {
        const cap = new THREE.CircleGeometry(half, 10)
        cap.rotateX(-Math.PI / 2)
        cap.translate(x, 0, z)
        parts.push(cap)
      }
    }

    const merged = mergeGeometries(parts, false)
    parts.forEach((part) => part.dispose())
    return merged
  }, [])
  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, GROUND_Y + 0.012, 0]} receiveShadow>
      <meshStandardMaterial color="#6d6047" roughness={1} />
    </mesh>
  )
}

/**
 * One sheet of the brook: the ribbon its centre line sweeps out, widened by
 * `extra` — 0 for the water, a little more for the gravel under it.
 *
 * A quad per leg and a disc at each bend, exactly like the trail, because a
 * corner made of two quads alone has a notch bitten out of the inside of the
 * turn. The width comes from `streamWidth`, so what is drawn is the same brook
 * the walk controller refuses to step into.
 */
function streamSheet(extra: number): THREE.BufferGeometry {
  const lengths = [0]
  for (let i = 1; i < STREAM.length; i++) {
    lengths.push(
      lengths[i - 1]! + Math.hypot(STREAM[i]![0] - STREAM[i - 1]![0], STREAM[i]![1] - STREAM[i - 1]![1]),
    )
  }
  const total = lengths[lengths.length - 1]!
  const halfAt = (i: number) => streamWidth(lengths[i]! / total) / 2 + extra

  const parts: THREE.BufferGeometry[] = []
  for (let i = 1; i < STREAM.length; i++) {
    const [ax, az] = STREAM[i - 1]!
    const [bx, bz] = STREAM[i]!
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) continue
    const nx = -dz / length
    const nz = dx / length
    const ha = halfAt(i - 1)
    const hb = halfAt(i)

    const strip = new THREE.BufferGeometry()
    strip.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          ax + nx * ha, 0, az + nz * ha,
          ax - nx * ha, 0, az - nz * ha,
          bx + nx * hb, 0, bz + nz * hb,
          bx - nx * hb, 0, bz - nz * hb,
        ]),
        3,
      ),
    )
    strip.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    )
    strip.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2))
    strip.setIndex([0, 2, 1, 1, 2, 3])
    parts.push(strip)
  }

  for (let i = 0; i < STREAM.length; i++) {
    const bend = new THREE.CircleGeometry(halfAt(i), 10)
    bend.rotateX(-Math.PI / 2)
    bend.translate(STREAM[i]![0], 0, STREAM[i]![1])
    parts.push(bend)
  }

  const merged = mergeGeometries(parts, false)!
  parts.forEach((part) => part.dispose())
  // Planar UVs in world metres, at the lake's own scale — so the ripple runs
  // straight out of the brook and into the water it joins.
  const position = merged.getAttribute('position')
  const uv = merged.getAttribute('uv')
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / 8, position.getZ(i) / 8)
  return merged
}

/**
 * The plank over the brook: a deck with a rail either side, one merged
 * geometry for however many crossings the valley has.
 *
 * Built from the same `BRIDGES` the walk controller stands you on, turned to
 * the flow rather than to a compass point, because a bridge that is not square
 * to the water is a bridge with a corner in it.
 */
function bridgeGeometry(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  for (const bridge of BRIDGES) {
    const turn = new THREE.Matrix4().compose(
      new THREE.Vector3(bridge.x, 0, bridge.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.atan2(bridge.dx, bridge.dz),
      ),
      new THREE.Vector3(1, 1, 1),
    )
    const add = (
      size: [number, number, number],
      at: [number, number, number],
    ) => {
      const box = new THREE.BoxGeometry(...size)
      box.translate(...at)
      box.applyMatrix4(turn)
      parts.push(box)
    }

    const span = bridge.reach * 2
    // The deck's top face is the floor `terrainAt` hands back, so the box hangs
    // below that number rather than being centred on it.
    add([span, 0.09, BRIDGE_DECK * 2], [0, BRIDGE_Y - 0.045, 0])
    for (const side of [-1, 1]) {
      add([span, 0.07, 0.07], [0, BRIDGE_Y + 0.52, side * (BRIDGE_DECK - 0.06)])
      for (const end of [-1, 1]) {
        add(
          [0.09, 0.56, 0.09],
          [end * (bridge.reach - 0.22), BRIDGE_Y + 0.28, side * (BRIDGE_DECK - 0.06)],
        )
      }
    }
  }
  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  return merged
}

/**
 * The brook, and the plank over it.
 *
 * The same three-sheet trick the beach uses — gravel over the grass, water over
 * the gravel — rather than a channel cut into a disc you have to be able to walk
 * on. It shares the lake's material, so the water running in is the water it
 * runs into: one scrolling ripple, and it goes grey in the rain with everything
 * else without a second thing to remember.
 */
function Stream({ water }: { water: THREE.Material }) {
  const bed = useMemo(() => streamSheet(0.5), [])
  const surface = useMemo(() => streamSheet(0), [])
  const planks = useMemo(() => bridgeGeometry(), [])
  useEffect(
    () => () => {
      bed.dispose()
      surface.dispose()
      planks?.dispose()
    },
    [bed, surface, planks],
  )

  return (
    <group>
      <mesh geometry={bed} position={[0, BROOK_BED_Y, 0]} receiveShadow>
        <meshStandardMaterial color="#8a7f66" roughness={1} />
      </mesh>
      <mesh geometry={surface} material={water} position={[0, BROOK_WATER_Y, 0]} />
      {planks && (
        <mesh geometry={planks} receiveShadow>
          <meshStandardMaterial color="#6f5636" roughness={0.9} flatShading />
        </mesh>
      )}
    </group>
  )
}

/** Low ridges beyond the lake, to stop the horizon being a straight line. */
function Hills() {
  const hills = useMemo(() => {
    const random = mulberry32(0xb17c)
    return Array.from({ length: 9 }, (_, i) => {
      const angle = Math.PI + ((i + 0.5) / 9 - 0.5) * 2.6
      // Out past the walk, in proportion to the disc, so a bigger valley does
      // not leave its own horizon standing in the middle of it.
      const distance = between(random, GROUND_RADIUS * 0.7, GROUND_RADIUS * 0.9)
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

/** One piece of outdoor set dressing, ready to become an instance. */
export type Placed = {
  x: number
  y: number
  z: number
  scale: [number, number, number]
  yaw: number
  tilt?: number
  colour: string
}

/** Fill an instanced mesh's matrices and colours in one pass. */
export function place(mesh: THREE.InstancedMesh | null, items: readonly Placed[]) {
  if (!mesh) return
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Euler()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const colour = new THREE.Color()
  items.forEach((item, i) => {
    position.set(item.x, item.y, item.z)
    rotation.set(item.tilt ?? 0, item.yaw, 0)
    scale.set(...item.scale)
    matrix.compose(position, quaternion.setFromEuler(rotation), scale)
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, colour.set(item.colour))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
}

const ROCK_GREYS = ['#7b7d76', '#6b6e69', '#868881', '#5f625e']
const REED_GREENS = ['#5d7038', '#6c7d3e', '#8a8a4e', '#7a6f3d']
const PAD_GREENS = ['#3e6034', '#48703c', '#365a30']

/**
 * The water's edge dressed: rocks half in the shallows, clumps of reeds, and
 * lily pads drifting near the shore.
 *
 * Everything sits in shoreline units off `lakePoint`, so it follows the
 * wobbled outline the same way the beach does. It all stands at or inside the
 * waterline — where the walk controller already refuses to go — which is why
 * none of it needs a collider. Three instanced meshes, three draw calls.
 */
function Shoreline() {
  const rocks = useRef<THREE.InstancedMesh>(null)
  const reeds = useRef<THREE.InstancedMesh>(null)
  const pads = useRef<THREE.InstancedMesh>(null)

  // A pad lies flat on the water, so its disc is turned flat once, here —
  // instance matrices only spin it about Y.
  const padGeometry = useMemo(() => {
    const disc = new THREE.CircleGeometry(0.22, 8)
    disc.rotateX(-Math.PI / 2)
    return disc
  }, [])
  useEffect(() => () => padGeometry.dispose(), [padGeometry])

  const dressing = useMemo(() => {
    const random = mulberry32(0x1a4e)
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!

    // Rocks at the waterline, half sunk, in loose runs rather than evenly
    // spaced — a few stretches of shore get a group and the rest stay bare.
    const rock: Placed[] = []
    for (let i = 0; i < 9; i++) {
      const around = random() * Math.PI * 2
      const run = 1 + Math.floor(random() * 3)
      for (let j = 0; j < run; j++) {
        const angle = around + (random() - 0.5) * 0.22
        const [x, z] = lakePoint(angle, between(random, 0.975, 1.045))
        if (onTrail(x, z)) continue
        const size = between(random, 0.16, 0.42)
        rock.push({
          x,
          y: GROUND_Y + size * 0.18,
          z,
          scale: [size, size * between(random, 0.5, 0.75), size * between(random, 0.7, 1.1)],
          yaw: random() * Math.PI * 2,
          colour: pick(ROCK_GREYS),
        })
      }
    }

    // Reeds in clumps standing in the shallows, leaning every which way.
    const reed: Placed[] = []
    for (let i = 0; i < 14; i++) {
      const around = random() * Math.PI * 2
      const [cx, cz] = lakePoint(around, between(random, 0.955, 1.0))
      const count = 6 + Math.floor(random() * 6)
      for (let j = 0; j < count; j++) {
        const height = between(random, 0.55, 1.15)
        reed.push({
          x: cx + (random() - 0.5) * 1.6,
          y: WATER_Y + height / 2 - 0.06,
          z: cz + (random() - 0.5) * 1.6,
          scale: [1, height, 1],
          yaw: random() * Math.PI * 2,
          tilt: (random() - 0.5) * 0.22,
          colour: pick(REED_GREENS),
        })
      }
    }

    // Lily pads well inside the waterline, where nobody can reach them.
    const pad: Placed[] = []
    for (let i = 0; i < 26; i++) {
      const [x, z] = lakePoint(random() * Math.PI * 2, between(random, 0.62, 0.93))
      const size = between(random, 0.45, 1.1)
      pad.push({
        x,
        y: WATER_Y + 0.006,
        z,
        scale: [size, 1, size],
        yaw: random() * Math.PI * 2,
        colour: pick(PAD_GREENS),
      })
    }

    return { rock, reed, pad }
  }, [])

  useLayoutEffect(() => {
    place(rocks.current, dressing.rock)
    place(reeds.current, dressing.reed)
    place(pads.current, dressing.pad)
  }, [dressing])

  return (
    <group>
      <instancedMesh ref={rocks} args={[undefined, undefined, dressing.rock.length]} receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={reeds} args={[undefined, undefined, dressing.reed.length]}>
        <cylinderGeometry args={[0.008, 0.022, 1, 4]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={pads} args={[padGeometry, undefined, dressing.pad.length]}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
    </group>
  )
}

/**
 * Boulders and stumps scattered through the forest — the ground floor of the
 * tree line, so the woods read as a place rather than as cones on a lawn.
 *
 * Grown with the same `occupied` test as the trees, so nothing lands on the
 * shore path, the trail, the view corridor or a building. Small enough to step
 * over, which is why they are scenery rather than solids — the trunks are the
 * things you walk into out here.
 */
function Erratics({ keepOut }: { keepOut: readonly Bounds[] }) {
  const boulders = useRef<THREE.InstancedMesh>(null)
  const stumps = useRef<THREE.InstancedMesh>(null)

  const strewn = useMemo(() => {
    const random = mulberry32(0x0c7a)
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!

    const boulder: Placed[] = []
    for (let i = 0; i < 200 && boulder.length < 22; i++) {
      const angle = random() * Math.PI * 2
      const distance = 12 + Math.sqrt(random()) * 70
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (occupied(x, z, keepOut) || lakeRadius(x, z) < PATH.to + 0.06) continue
      const size = between(random, 0.28, 0.85)
      boulder.push({
        x,
        y: GROUND_Y + size * 0.25,
        z,
        scale: [size, size * between(random, 0.55, 0.8), size * between(random, 0.75, 1.15)],
        yaw: random() * Math.PI * 2,
        colour: pick(ROCK_GREYS),
      })
    }

    const stump: Placed[] = []
    for (let i = 0; i < 120 && stump.length < 10; i++) {
      const angle = random() * Math.PI * 2
      const distance = 14 + Math.sqrt(random()) * 60
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (occupied(x, z, keepOut) || lakeRadius(x, z) < PATH.to + 0.06) continue
      const height = between(random, 0.22, 0.42)
      stump.push({
        x,
        y: GROUND_Y + height / 2,
        z,
        scale: [between(random, 0.16, 0.3), height, between(random, 0.16, 0.3)],
        yaw: random() * Math.PI * 2,
        colour: '#5c4a33',
      })
    }

    return { boulder, stump }
  }, [keepOut])

  useLayoutEffect(() => {
    place(boulders.current, strewn.boulder)
    place(stumps.current, strewn.stump)
  }, [strewn])

  return (
    <group>
      <instancedMesh
        ref={boulders}
        args={[undefined, undefined, strewn.boulder.length]}
        castShadow
        receiveShadow
      >
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={stumps} args={[undefined, undefined, strewn.stump.length]} castShadow>
        <cylinderGeometry args={[1, 1.18, 1, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}

/**
 * A few birds circling over the lake by day.
 *
 * Each is two dark triangles making a gull's "V", flapped by scaling the V
 * flat and open again — which at a hundred metres is exactly what a wingbeat
 * looks like, and costs one instanced draw call for the flock. They fade out
 * with dusk and with rain rather than blinking off.
 */
const FLOCK: readonly { radius: number; height: number; speed: number; phase: number }[] = [
  { radius: 0.42, height: 7.5, speed: 0.14, phase: 0.0 },
  { radius: 0.55, height: 9.2, speed: 0.11, phase: 2.4 },
  { radius: 0.48, height: 8.3, speed: 0.17, phase: 4.4 },
]

function Birds() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const geometry = useMemo(() => {
    const wing = new Float32Array([
      // Left wing: body leading edge to raised tip.
      0, 0, 0.16, 0, 0, -0.1, -0.62, 0.2, 0.02,
      // Right wing, mirrored, wound to face up as well.
      0, 0, -0.1, 0, 0, 0.16, 0.62, 0.2, 0.02,
    ])
    const made = new THREE.BufferGeometry()
    made.setAttribute('position', new THREE.BufferAttribute(wing, 3))
    made.computeVertexNormals()
    return made
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      up: new THREE.Vector3(0, 1, 0),
      scale: new THREE.Vector3(),
    }),
    [],
  )

  // The flock never leaves the air over the lake, so it culls on a hand-set
  // sphere there rather than being drawn while you face a bookcase.
  useEffect(() => {
    if (!mesh.current) return
    mesh.current.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(LAKE.x, WATER_Y + 8.5, LAKE.z),
      Math.max(LAKE.radiusX, LAKE.radiusZ) * 0.6 + 6,
    )
  }, [])

  useFrame(({ clock }) => {
    const node = mesh.current
    const paint = material.current
    if (!node || !paint) return

    const fade = (1 - ambienceBlend.night) * (1 - ambienceBlend.rain)
    paint.opacity = fade * 0.9
    node.visible = fade > 0.03
    if (!node.visible) return

    const t = clock.elapsedTime
    FLOCK.forEach((bird, i) => {
      const angle = bird.phase + t * bird.speed
      const rx = LAKE.radiusX * bird.radius
      const rz = LAKE.radiusZ * bird.radius
      scratch.position.set(
        LAKE.x + Math.cos(angle) * rx,
        WATER_Y + bird.height + Math.sin(t * 0.31 + bird.phase) * 0.9,
        LAKE.z + Math.sin(angle) * rz,
      )
      // Facing along the velocity of the circle it flies.
      const yaw = Math.atan2(-Math.sin(angle) * rx, Math.cos(angle) * rz)
      scratch.quaternion.setFromAxisAngle(scratch.up, yaw)
      const flap = 0.2 + Math.abs(Math.sin(t * (4.6 + i * 0.7) + bird.phase)) * 0.9
      scratch.scale.set(1, flap, 1)
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, FLOCK.length]}>
      <meshBasicMaterial
        ref={material}
        color="#2b2f33"
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

/** The corners the frame loop stretches the outdoors between. */
const BACKGROUND = colorCorners({
  day: '#9dc0dc',
  dayRain: '#818b93',
  night: '#0b101c',
  nightRain: '#171a21',
})
const FOG_COLOUR = colorCorners({
  day: '#c3d2dd',
  dayRain: '#8d969c',
  night: '#101624',
  nightRain: '#161a21',
})
const FOG_DENSITY = { day: 0.0085, dayRain: 0.019, night: 0.0105, nightRain: 0.018 }
/** The amber dusk leans the air towards, pre-parsed once. */
const GOLDEN_BACKGROUND = new THREE.Color('#d99a6a')
const GOLDEN_FOG = new THREE.Color('#cf9670')
const WATER_COLOUR = colorCorners({
  day: '#3f6076',
  dayRain: '#4b5a63',
  night: '#22344a',
  nightRain: '#2c3540',
})
const WATER_ROUGHNESS = { day: 0.12, dayRain: 0.62, night: 0.1, nightRain: 0.62 }
const WATER_METALNESS = { day: 0.55, dayRain: 0.2, night: 0.6, nightRain: 0.2 }

/**
 * A bank of mist where the ground runs out: an open cylinder round the edge of
 * the world wearing a vertical fade, coloured to whatever the fog is. It is
 * what makes the horizon a soft line of atmosphere rather than the rim of a
 * disc — the geometric edge is still there, but nobody ever sees it.
 */
function MistRing() {
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const fade = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    // The canvas's top row is the cylinder's top: clear above, mist below.
    const gradient = ctx.createLinearGradient(0, 0, 0, 64)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.4)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.85)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 2, 64)
    const texture = new THREE.CanvasTexture(canvas)
    return texture
  }, [])
  useEffect(() => () => fade.dispose(), [fade])

  const colour = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const paint = material.current
    if (!paint) return
    paint.color.copy(mixColor(colour, FOG_COLOUR))
    paint.opacity = 0.55 + ambienceBlend.rain * 0.25
  })

  return (
    <mesh position={[0, GROUND_Y + 6, 0]}>
      <cylinderGeometry args={[GROUND_RADIUS - 28, GROUND_RADIUS - 28, 18, 48, 1, true]} />
      <meshBasicMaterial
        ref={material}
        map={fade}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

export function Outside() {
  const world = useWorldStore((s) => s.world)
  const night = useAmbienceStore((s) => s.night)
  const rain = useAmbienceStore((s) => s.rain)

  const scene = useThree((s) => s.scene)
  const background = useRef<THREE.Color | null>(null)
  const fog = useRef<THREE.FogExp2 | null>(null)

  // Set directly on the scene: as JSX children of this group, `attach` would
  // write `group.fog`/`group.background`, which the renderer never reads.
  useEffect(() => {
    const clear = new THREE.Color('#9dc0dc')
    const haze = new THREE.FogExp2('#c3d2dd', 0.0085)
    scene.background = clear
    scene.fog = haze
    background.current = clear
    fog.current = haze
    return () => {
      if (scene.background === clear) scene.background = null
      if (scene.fog === haze) scene.fog = null
      background.current = null
      fog.current = null
    }
  }, [scene])

  const ripples = useMemo(() => makeWaterNormals(), [])
  useEffect(() => () => ripples.dispose(), [ripples])

  // One material for every body of water in the valley, made here rather than
  // declared inside the lake's mesh: the brook is the same water, and sharing
  // it is what keeps the two the same colour, the same weather and the same
  // ripple without a second thing to advance per frame.
  const waterMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3f6076',
        roughness: 0.12,
        metalness: 0.55,
        normalMap: ripples,
        normalScale: new THREE.Vector2(0.3, 0.3),
      }),
    [ripples],
  )
  useEffect(() => () => waterMaterial.dispose(), [waterMaterial])

  // ~5 m per tile across the 300 m disc. The texture is a module singleton and
  // only the ground reads it, so setting its repeat here is not a fight.
  const groundTexture = useMemo(() => {
    const mottle = groundMottleTexture()
    mottle.repeat.set(60, 60)
    return mottle
  }, [])

  /**
   * The one place the ambience blend advances, plus everything this component
   * colours by it: the clear colour, the fog and the lake. Advancing and
   * reading in the same component keeps the sky and the ground the same
   * evening; the other readers (`Sky`, the lights) are at most a frame behind,
   * which nothing can see.
   */
  useFrame(({ clock }, delta) => {
    advanceAmbience(night, rain, delta)

    // The same warmth the sky stops lean by, so the air matches the dome.
    const warmth = goldenWarmth()
    if (background.current)
      mixColor(background.current, BACKGROUND).lerp(GOLDEN_BACKGROUND, warmth * 0.35)
    if (fog.current) {
      mixColor(fog.current.color, FOG_COLOUR).lerp(GOLDEN_FOG, warmth * 0.3)
      fog.current.density = mixNumber(FOG_DENSITY)
    }

    mixColor(waterMaterial.color, WATER_COLOUR)
    waterMaterial.roughness = mixNumber(WATER_ROUGHNESS)
    waterMaterial.metalness = mixNumber(WATER_METALNESS)
    // The ripples drift diagonally, faster and choppier in the rain.
    const t = clock.elapsedTime
    ripples.offset.set(t * 0.012, t * 0.0085)
    const chop = 0.3 + ambienceBlend.rain * 0.9
    waterMaterial.normalScale.set(chop, chop)
  })

  // The same trunks the walk controller collides with. Grown in `deriveWorld`
  // rather than here, which is what stops the forest you can see and the forest
  // you can bump into drifting apart.
  const trees = world?.trees ?? []

  // The water and the sand, cut once from the walkable outline.
  const water = useMemo(() => lakeSheet(1), [])
  const shore = useMemo(() => lakeSheet(SHORE_EDGE), [])
  const ground = useMemo(() => groundGeometry(), [])
  useEffect(
    () => () => {
      water.dispose()
      shore.dispose()
      ground.dispose()
    },
    [water, shore, ground],
  )

  // The same margin the forest keeps off the buildings, for the ground litter.
  const keepOut = useMemo(
    () =>
      (world?.rooms ?? []).map((room) => {
        const bounds = roomBounds(room)
        return {
          minX: bounds.minX - CLEARING,
          maxX: bounds.maxX + CLEARING,
          minZ: bounds.minZ - CLEARING,
          maxZ: bounds.maxZ + CLEARING,
        }
      }),
    [world],
  )

  return (
    <group>
      {/* The clear colour and the haze live with the sky they have to match —
          set on the scene in the effect above, faded by the frame loop. The
          haze is what makes a hundred metres of forest read as distance rather
          than as a lot of cones; at night it thickens a little and goes dark. */}
      <Sky />
      {/* The sun's bloom, the clouds and the moon's glint on the water: the
          day pieces and the night pieces gate each other off, so the three
          calls are never all live at once. */}
      <SunGlow />
      <CloudBank />
      <MoonGlint />
      <Hills />
      <MistRing />
      <Birds />

      {/* The ground you now walk on, a whisker below the floor slabs so the two
          never z-fight and the reveal reads as a shadow line at the base of a
          wall rather than as a cabin standing on air. The mottle is multiplied
          under the colour — meadow, not baize. */}
      <mesh geometry={ground} position={[0, GROUND_Y, 0]} receiveShadow>
        <meshStandardMaterial color="#4a5c34" roughness={1} map={groundTexture} />
      </mesh>

      <Trail />

      {/* A pale shore, so the water meets the grass at something. Under the
          water and over the grass: three sheets stacked centimetres apart,
          rather than a hole cut in the ground for a lake nobody swims in.
          The gaps are 1.5 cm: any wider and they read as three floating discs
          from the beach. The beach itself is walkable — the refusal is at the
          water's edge, inside it. */}
      <mesh geometry={shore} position={[0, SHORE_Y, 0]}>
        <meshStandardMaterial color="#8f8266" roughness={1} />
      </mesh>

      {/* The lake. Smooth and a little metallic, which at this distance is all
          that separates water from a green field of a different colour — and
          rough and grey in the rain, because what a shower does to a lake is
          take the reflection off it. The scrolling normal map is what keeps it
          from being a painted floor: water moves, even from the porch. */}
      <mesh geometry={water} material={waterMaterial} position={[0, WATER_Y, 0]} />

      {/* The brook coming down the east side of the houses to join it. */}
      <Stream water={waterMaterial} />

      <Shoreline />
      <Erratics keepOut={keepOut} />
      <Undergrowth keepOut={keepOut} />

      <Forest trees={trees} />
      <Fireflies keepOut={keepOut} />
      <FallingLeaves />

    </group>
  )
}
