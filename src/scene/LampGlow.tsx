import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend } from './ambienceBlend'
import { radialGlowTexture } from './sky'
import { approach } from '../lib/ease'
import { useAmbienceStore } from '../state/ambience'
import { useWorldStore } from '../state/world'

/**
 * A real bloom is a render pass over the whole frame; a bulb needs only a soft
 * additive quad turned to face you. One instanced mesh carries a halo per lamp,
 * fire and fairy-light bulb, swelling after dark because glare is a night-time
 * fact. Kept in Low Performance Mode: one draw call, and most of what makes a
 * lit lamp read as lit.
 */

type Glow = {
  /** The switch this halo obeys — every bulb on a string shares one. */
  id: string
  defaultOn: boolean
  x: number
  y: number
  z: number
  radius: number
  colour: string
  /** Fires breathe; bulbs hold steady. */
  fire: boolean
}

/** Module singleton, like the wall wash: every halo shares one upload. */
let glow: THREE.CanvasTexture | null = null
function glowTexture(): THREE.CanvasTexture {
  if (!glow) {
    glow = radialGlowTexture(64, [
      [0, 'rgba(255, 217, 160, 0.9)'],
      [0.4, 'rgba(255, 217, 160, 0.28)'],
      [1, 'rgba(255, 217, 160, 0)'],
    ])
  }
  return glow
}

export function LampGlow() {
  const world = useWorldStore((s) => s.world)
  const mesh = useRef<THREE.InstancedMesh>(null)

  const glows = useMemo<Glow[]>(() => {
    if (!world) return []
    const out: Glow[] = []
    for (const lamp of world.lights) {
      if (lamp.kind === 'floorlamp' || lamp.kind === 'pendant') {
        out.push({
          id: lamp.id,
          defaultOn: lamp.defaultOn,
          x: lamp.x,
          y: lamp.y,
          z: lamp.z,
          radius: 0.55,
          colour: '#ffffff',
          fire: false,
        })
      } else if (lamp.kind === 'fireplace' || lamp.kind === 'campfire') {
        out.push({
          id: lamp.id,
          defaultOn: lamp.defaultOn,
          x: lamp.x,
          y: lamp.y,
          z: lamp.z,
          radius: 0.9,
          colour: '#ff9346',
          fire: true,
        })
      }
    }
    // On the same catenary the string draws, recomputed rather than shared so
    // the glow needs nothing of the mesh.
    for (const piece of world.furniture) {
      if (piece.kind !== 'fairylights') continue
      const sag = piece.size?.[1] ?? 0.18
      const bulbs = Math.max(4, Math.round(piece.width / 0.26))
      const cos = Math.cos(piece.rotationY)
      const sin = Math.sin(piece.rotationY)
      for (let i = 0; i < bulbs; i++) {
        const t = (i / (bulbs - 1)) * 2 - 1
        const along = (t * piece.width) / 2
        out.push({
          id: piece.id,
          defaultOn: piece.on ?? true,
          x: piece.x + along * cos,
          y: piece.y - sag * (1 - t * t) - 0.035,
          z: piece.z - along * sin,
          radius: 0.09,
          colour: '#ffcf82',
          fire: false,
        })
      }
    }
    return out
  }, [world])

  /** Per-instance 0..1, eased in the frame loop so a switch fades, not snaps. */
  const eased = useMemo(() => new Float32Array(glows.length), [glows])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      size: new THREE.Vector3(),
    }),
    [],
  )

  // Colour and bound once per world: the tints never change, and the halos are
  // rewritten around fixed fittings, so the sphere never moves either.
  useLayoutEffect(() => {
    const node = mesh.current
    if (!node || glows.length === 0) return
    const colour = new THREE.Color()
    const box = new THREE.Box3()
    glows.forEach((entry, i) => {
      node.setColorAt(i, colour.set(entry.colour))
      box.expandByPoint(new THREE.Vector3(entry.x - 1, entry.y - 1, entry.z - 1))
      box.expandByPoint(new THREE.Vector3(entry.x + 1, entry.y + 1, entry.z + 1))
    })
    if (node.instanceColor) node.instanceColor.needsUpdate = true
    node.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
  }, [glows])

  useFrame(({ camera, clock }, delta) => {
    const node = mesh.current
    if (!node) return
    const t = clock.elapsedTime
    const ambience = useAmbienceStore.getState()
    const step = approach(6, delta)
    const dark = 0.9 + ambienceBlend.night * 0.35
    // Billboarded by copying the camera's own rotation: cheaper than a lookAt
    // per instance, and a screen-aligned quad is exactly what bloom is.
    scratch.quaternion.copy(camera.quaternion)

    glows.forEach((entry, i) => {
      const want = ambience.isOn(entry.id, entry.defaultOn) ? 1 : 0
      const level = eased[i]! + (want - eased[i]!) * step
      eased[i] = Math.abs(want - level) < 0.01 ? want : level
      const breathe = entry.fire ? 1 + Math.sin(t * 1.7) * 0.08 : 1
      scratch.position.set(entry.x, entry.y, entry.z)
      scratch.matrix.compose(
        scratch.position,
        scratch.quaternion,
        scratch.size.setScalar(entry.radius * eased[i]! * dark * breathe),
      )
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  if (glows.length === 0) return null
  return (
    <instancedMesh key={glows.length} ref={mesh} args={[undefined, undefined, glows.length]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={glowTexture()}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
