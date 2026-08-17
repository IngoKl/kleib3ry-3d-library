import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend, colorCorners, goldenWarmth, mixColor } from './ambienceBlend'
import { between, mulberry32 } from '../lib/rng'
import { MOON_DIRECTION, SUN_DIRECTION, radialGlowTexture } from './sky'
import { GROUND_RADIUS, LAKE, WATER_Y } from '../world/terrain'
import { useSettings } from '../state/settings'

/**
 * The rest of the sky: the sun's glow by day, a few banks of cloud, and the
 * moon's glint on the lake by night. Its own module rather than more of `Sky`
 * because none of it touches the gradient canvas — each piece is a quad or an
 * instanced sheet faded by the same ambience blend. Three draw calls, and the
 * night pieces gate themselves off entirely by day (and vice versa).
 */

const SUN_CORE = new THREE.Color('#ffffff')
const SUN_SUNSET = new THREE.Color('#ff9a4d')

/**
 * The sun as a bloom rather than a disc: a hard-edged circle at this distance
 * reads as a sticker, and the glow is what windows and water actually get from
 * it. It reddens with `goldenWarmth`, so the dusk the sky gradient passes
 * through has a source hanging in it.
 */
export function SunGlow() {
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const glow = useMemo(
    () =>
      radialGlowTexture(128, [
        [0.06, 'rgba(255, 248, 230, 0.95)'],
        [0.35, 'rgba(255, 224, 168, 0.35)'],
        [1, 'rgba(255, 224, 168, 0)'],
      ]),
    [],
  )
  useEffect(() => () => glow.dispose(), [glow])

  const at = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(GROUND_RADIUS + 26), [])

  useFrame(() => {
    const paint = material.current
    if (!paint) return
    const daylight = (1 - ambienceBlend.night) * (1 - ambienceBlend.rain * 0.9)
    paint.opacity = daylight
    paint.visible = daylight > 0.02
    paint.color.copy(SUN_CORE).lerp(SUN_SUNSET, goldenWarmth())
  })

  return (
    <mesh position={at} ref={(mesh) => mesh?.lookAt(0, 0, 0)}>
      <circleGeometry args={[22, 24]} />
      <meshBasicMaterial
        ref={material}
        map={glow}
        transparent
        opacity={0}
        toneMapped={false}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

const CLOUD_COLOUR = colorCorners({
  day: '#ffffff',
  dayRain: '#8f979e',
  night: '#2a3040',
  nightRain: '#1d2128',
})

/** A few soft blobs overlapped once into one canvas every bank shares. */
function cloudTexture(): THREE.CanvasTexture {
  const random = mulberry32(0xc10d)
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const blobs = 3 + Math.floor(random() * 2)
  for (let i = 0; i < blobs; i++) {
    const x = between(random, 34, 94)
    const y = between(random, 24, 40)
    const r = between(random, 16, 30)
    const gradient = ctx.createRadialGradient(x, y, r / 8, x, y, r)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 64)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const azimuthOf = (direction: THREE.Vector3) => Math.atan2(direction.z, direction.x)
const SUN_AZIMUTH = azimuthOf(SUN_DIRECTION)
const MOON_AZIMUTH = azimuthOf(MOON_DIRECTION)

const angleGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return Math.min(d, Math.PI * 2 - d)
}

/**
 * A handful of cloud banks on the dome, greying over in rain and near-black at
 * night. One instanced mesh of quads faced at the centre, matrices baked once;
 * the whole group creeps round the sky slower than anyone can watch. They are
 * seeded clear of the sun's and moon's azimuths, so neither disc ever rises
 * behind a permanent cloud.
 */
export function CloudBank() {
  const low = useSettings((s) => s.lowPerformance)
  const count = low ? 3 : 6
  const group = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const puff = useMemo(() => cloudTexture(), [])
  useEffect(() => () => puff.dispose(), [puff])

  // Always six grown, so low-performance keeps the same first three.
  const banks = useMemo(() => {
    const random = mulberry32(0xc10d)
    const list: { azimuth: number; elevation: number; width: number; height: number }[] = []
    for (let i = 0; i < 200 && list.length < 6; i++) {
      const azimuth = random() * Math.PI * 2
      if (angleGap(azimuth, SUN_AZIMUTH) < 0.3 || angleGap(azimuth, MOON_AZIMUTH) < 0.3) continue
      list.push({
        azimuth,
        elevation: between(random, 0.25, 0.6),
        width: between(random, 28, 55),
        height: between(random, 10, 18),
      })
    }
    return list
  }, [])

  useLayoutEffect(() => {
    const node = mesh.current
    if (!node) return
    const dummy = new THREE.Object3D()
    banks.slice(0, count).forEach((bank, i) => {
      const radius = GROUND_RADIUS + 32
      const flat = Math.cos(bank.elevation) * radius
      dummy.position.set(
        Math.cos(bank.azimuth) * flat,
        Math.sin(bank.elevation) * radius,
        Math.sin(bank.azimuth) * flat,
      )
      dummy.lookAt(0, 0, 0)
      dummy.scale.set(bank.width, bank.height, 1)
      dummy.updateMatrix()
      node.setMatrixAt(i, dummy.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  }, [banks, count])

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.0025
    const paint = material.current
    if (!paint) return
    mixColor(paint.color, CLOUD_COLOUR)
    paint.opacity = (0.5 + ambienceBlend.rain * 0.25) * (1 - ambienceBlend.night * 0.85)
  })

  return (
    <group ref={group}>
      {/* Culling is off — the banks ring the whole dome, and fog would grey
          them to nothing at this radius, like the dome itself. */}
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={material}
          map={puff}
          transparent
          toneMapped={false}
          depthWrite={false}
          fog={false}
        />
      </instancedMesh>
    </group>
  )
}

/**
 * The moon's glint: a streak of cool light lying on the water, long axis aimed
 * at the moon, breathing slightly. Additive — it is light on the lake, not a
 * decal — and fog-free, because fogged additive would lay a grey rectangle on
 * the water instead.
 */
export function MoonGlint() {
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const glow = useMemo(
    () =>
      radialGlowTexture(64, [
        [0, 'rgba(207, 216, 238, 0.9)'],
        [0.45, 'rgba(186, 199, 228, 0.3)'],
        [1, 'rgba(186, 199, 228, 0)'],
      ]),
    [],
  )
  useEffect(() => () => glow.dispose(), [glow])

  // Laid flat once here, so the mesh only carries position, yaw and stretch.
  const sheet = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1)
    plane.rotateX(-Math.PI / 2)
    return plane
  }, [])
  useEffect(() => () => sheet.dispose(), [sheet])

  const pose = useMemo(() => {
    const towards = new THREE.Vector2(MOON_DIRECTION.x, MOON_DIRECTION.z).normalize()
    return {
      position: new THREE.Vector3(
        LAKE.x + towards.x * 10,
        WATER_Y + 0.004,
        LAKE.z + towards.y * 10,
      ),
      yaw: Math.atan2(towards.x, towards.y),
    }
  }, [])

  useFrame(({ clock }) => {
    const paint = material.current
    if (!paint) return
    const shine =
      ambienceBlend.night *
      (1 - ambienceBlend.rain) *
      0.32 *
      (0.9 + 0.1 * Math.sin(clock.elapsedTime * 0.7))
    paint.opacity = shine
    paint.visible = shine > 0.02
  })

  return (
    <mesh geometry={sheet} position={pose.position} rotation-y={pose.yaw} scale={[3.2, 1, 24]}>
      <meshBasicMaterial
        ref={material}
        map={glow}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}
