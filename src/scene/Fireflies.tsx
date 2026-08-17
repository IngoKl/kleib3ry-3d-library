import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend } from './ambienceBlend'
import { between, mulberry32 } from '../lib/rng'
import type { Bounds } from '../world/derive'
import { occupied } from '../world/forest'
import { GROUND_Y, lakePoint } from '../world/terrain'
import { useSettings } from '../state/settings'

/**
 * Fireflies on a clear night: most along the shore band where the open ground
 * is, the rest scattered through the near meadow. One instanced mesh wandering
 * seeded lissajous paths, exactly like the dust motes indoors — and blinking
 * by *scale*, because the swarm shares one material and one opacity. The whole
 * mesh gates itself off by day and in rain, the way the stars do.
 */

const SHORE_FLIES = 28
const MEADOW_FLIES = 16

type Fly = {
  x: number
  y: number
  z: number
  /** Wander phases and rates, one lissajous per axis. */
  px: number
  py: number
  pz: number
  sx: number
  sy: number
  sz: number
  blinkPhase: number
  blinkSpeed: number
  gatePhase: number
  gateSpeed: number
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function Fireflies({ keepOut }: { keepOut: readonly Bounds[] }) {
  const low = useSettings((s) => s.lowPerformance)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  const flies = useMemo<Fly[]>(() => {
    const random = mulberry32(0xf1fe)
    const anchors: [number, number][] = []
    for (let i = 0; i < SHORE_FLIES; i++) {
      anchors.push(lakePoint(random() * Math.PI * 2, between(random, 1.05, 1.3)))
    }
    for (let i = 0; i < 200 && anchors.length < SHORE_FLIES + MEADOW_FLIES; i++) {
      const angle = random() * Math.PI * 2
      const distance = 12 + Math.sqrt(random()) * 28
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (occupied(x, z, keepOut)) continue
      anchors.push([x, z])
    }
    return anchors.map(([x, z]) => ({
      x,
      y: GROUND_Y + between(random, 0.35, 1.3),
      z,
      px: random() * Math.PI * 2,
      py: random() * Math.PI * 2,
      pz: random() * Math.PI * 2,
      sx: between(random, 0.13, 0.3),
      sy: between(random, 0.1, 0.22),
      sz: between(random, 0.13, 0.3),
      blinkPhase: random() * Math.PI * 2,
      blinkSpeed: between(random, 2.4, 4.6),
      gatePhase: random() * Math.PI * 2,
      gateSpeed: between(random, 0.25, 0.5),
    }))
  }, [keepOut])

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
    const paint = material.current
    if (!node || !paint) return
    const glow = ambienceBlend.night * (1 - ambienceBlend.rain)
    node.visible = glow > 0.03
    if (!node.visible) return
    paint.opacity = 0.9 * glow

    const t = clock.elapsedTime
    flies.forEach((fly, i) => {
      scratch.position.set(
        fly.x + Math.sin(t * fly.sx * Math.PI + fly.px) * 0.6,
        fly.y + Math.sin(t * fly.sy * Math.PI + fly.py) * 0.22,
        fly.z + Math.sin(t * fly.sz * Math.PI + fly.pz) * 0.6,
      )
      // A short shaped pulse, and a much slower gate for the long dark spells.
      const pulse = smoothstep(0.55, 0.85, 0.5 + 0.5 * Math.sin(t * fly.blinkSpeed + fly.blinkPhase))
      const spell = smoothstep(0.3, 0.55, 0.5 + 0.5 * Math.sin(t * fly.gateSpeed + fly.gatePhase))
      scratch.matrix.compose(
        scratch.position,
        scratch.quaternion,
        scratch.size.setScalar(pulse * spell),
      )
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  // A hand-set bound over the anchors plus their wander, so the swarm culls
  // like anything else — the instances never leave it.
  useEffect(() => {
    const node = mesh.current
    if (!node || flies.length === 0) return
    const box = new THREE.Box3()
    for (const fly of flies) {
      box.expandByPoint(new THREE.Vector3(fly.x - 0.7, fly.y - 0.4, fly.z - 0.7))
      box.expandByPoint(new THREE.Vector3(fly.x + 0.7, fly.y + 0.4, fly.z + 0.7))
    }
    node.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
  }, [flies])

  if (low || flies.length === 0) return null
  return (
    <instancedMesh
      key={flies.length}
      ref={mesh}
      args={[undefined, undefined, flies.length]}
      visible={false}
    >
      {/* A speck with faces, like the dust motes: at a centimetre nobody can
          tell, and nothing turns to face the camera. */}
      <octahedronGeometry args={[0.012, 0]} />
      <meshBasicMaterial
        ref={material}
        color="#d9ffa3"
        transparent
        toneMapped={false}
        depthWrite={false}
      />
    </instancedMesh>
  )
}
