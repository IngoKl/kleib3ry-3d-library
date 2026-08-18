import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { makeHand } from './hand'
import { PropModel } from './Props'
import { useAppStore } from '../state/store'

/**
 * Riding the camera like the held record, low and to the right — where a hand
 * mostly carrying something else would keep it.
 */
export function HeldProp() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const heldProp = useAppStore((s) => s.heldProp)

  const drift = useRef(0)
  const hand = useMemo(makeHand, [])

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return
    drift.current += delta

    const { quaternion, forward, right, up } = hand.follow(camera, delta)
    node.position
      .copy(camera.position)
      .addScaledVector(forward, 0.42)
      .addScaledVector(right, 0.2)
      .addScaledVector(up, -0.26)
    node.quaternion.copy(quaternion)
    node.rotateY(-0.35 + Math.sin(drift.current * 0.55) * 0.04)
    node.rotateX(Math.sin(drift.current * 0.4) * 0.02)
  })

  if (!heldProp) return null

  return (
    <group ref={group}>
      <PropModel kind={heldProp.kind} full={heldProp.full} />
    </group>
  )
}
