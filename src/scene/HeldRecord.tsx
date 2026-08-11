import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../state/store'
import { useMediaStore } from '../state/media'
import { makeSleeveTexture, sleeveArtFor } from './recordAtlas'

/** Sleeve size in hand — the same 12" square it is in the crate. */
const SLEEVE = 0.315
const THICKNESS = 0.004

/**
 * The record currently in hand, carried flat against the chest the way a
 * sleeve is actually carried. Rides the camera each frame like `HeldBook`; the
 * artwork is the same composed sleeve the atlas prints, at full resolution.
 */
export function HeldRecord() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const heldRecord = useAppStore((s) => s.heldRecord)
  const track = useMediaStore((s) =>
    heldRecord ? s.tracks.find((t) => t.id === heldRecord) : undefined,
  )

  const cover = useMemo(
    () => (track ? makeSleeveTexture(sleeveArtFor(track)) : null),
    [track],
  )
  useEffect(() => () => cover?.dispose(), [cover])

  const drift = useRef(0)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return

    drift.current += delta

    camera.getWorldDirection(forward.current)
    right.current.crossVectors(forward.current, camera.up).normalize()
    up.current.crossVectors(right.current, forward.current).normalize()

    node.position
      .copy(camera.position)
      .addScaledVector(forward.current, 0.5)
      .addScaledVector(right.current, 0.24)
      .addScaledVector(up.current, -0.22)

    node.quaternion.copy(camera.quaternion)
    node.rotateY(-0.5 + Math.sin(drift.current * 0.6) * 0.04)
    node.rotateX(0.12 + Math.sin(drift.current * 0.45) * 0.02)
  })

  if (!track || !cover) return null

  return (
    <group ref={group}>
      <mesh castShadow>
        <boxGeometry args={[SLEEVE, SLEEVE, THICKNESS]} />
        <meshStandardMaterial color="#221c17" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, THICKNESS / 2 + 0.0008]}>
        <planeGeometry args={[SLEEVE * 0.99, SLEEVE * 0.99]} />
        <meshStandardMaterial map={cover} roughness={0.72} />
      </mesh>
    </group>
  )
}
