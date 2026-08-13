import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { PropModel } from './Props'
import { courier } from '../state/courier'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { terrainAt } from '../world/terrain'

/**
 * The delivery courier, drawn only while a delivery is under way — the meshes
 * unmount when he is gone, so an idle library pays nothing for him. He walks a
 * straight lane out of the trees (see `state/courier.ts`), stands at the steps
 * for a moment, puts the box down, and walks back the way he came. No
 * collision: he is on the grass the whole way, and a courier stuck on a
 * planter is a worse story than one who brushes past it.
 */
const WALK_SPEED = 1.5

export function Courier() {
  const about = useAppStore((s) => s.courierAbout)
  if (!about) return null
  return <Walker />
}

function Walker() {
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const node = group.current
    if (!node || !courier.active) return

    const goal =
      courier.phase === 'leaving'
        ? courier.from
        : { x: courier.target.x, z: courier.target.z }
    const dx = goal.x - courier.x
    const dz = goal.z - courier.z
    const away = Math.hypot(dx, dz)

    if (courier.phase === 'dropping') {
      courier.pause -= delta
      // Face the house while the box goes down.
      courier.yaw = courier.target.yaw + Math.PI
      if (courier.pause <= 0) {
        // The box lands, and only now: the delivery is him, not a timer.
        useLibraryStore.getState().placeProp({ kind: 'takeaway', full: true, ...courier.target })
        useAppStore.setState({ ordering: false })
        courier.carrying = false
        courier.phase = 'leaving'
      }
    } else if (away < 0.3) {
      if (courier.phase === 'coming') {
        courier.phase = 'dropping'
        courier.pause = 1.2
      } else {
        // Back into the trees, gone.
        courier.active = false
        useAppStore.getState().setCourierAbout(false)
        return
      }
    } else {
      const step = Math.min(away, WALK_SPEED * delta)
      courier.x += (dx / away) * step
      courier.z += (dz / away) * step
      courier.yaw = Math.atan2(dx, dz)
      courier.stride += step * 6
      const ground = terrainAt(courier.x, courier.z)
      if (ground !== null) courier.y += (ground - courier.y) * Math.min(1, delta * 10)
    }

    node.position.set(courier.x, courier.y + Math.abs(Math.sin(courier.stride)) * 0.03, courier.z)
    node.rotation.y = courier.yaw
    // The box rides his hands, so it is drawn only while he carries it.
    const parcel = node.getObjectByName('parcel')
    if (parcel) parcel.visible = courier.carrying
  })

  return (
    <group ref={group}>
      {/* Legs, torso, head, cap: a courier at the distance you see him from. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.09, 0.42, 0]} castShadow>
          <boxGeometry args={[0.13, 0.84, 0.16]} />
          <meshStandardMaterial color="#3a3f46" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 1.12, 0]} castShadow>
        <boxGeometry args={[0.42, 0.56, 0.24]} />
        <meshStandardMaterial color="#b8452e" roughness={0.8} />
      </mesh>
      {/* Arms held forward, carrying. */}
      {[-1, 1].map((side) => (
        <mesh key={`arm${side}`} position={[side * 0.19, 1.08, 0.2]} rotation-x={-1.1} castShadow>
          <boxGeometry args={[0.09, 0.44, 0.09]} />
          <meshStandardMaterial color="#b8452e" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#d8b59a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.64, 0.01]}>
        <cylinderGeometry args={[0.115, 0.115, 0.06, 10]} />
        <meshStandardMaterial color="#b8452e" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.62, 0.12]}>
        <boxGeometry args={[0.16, 0.02, 0.1]} />
        <meshStandardMaterial color="#b8452e" roughness={0.8} />
      </mesh>
      {/* The food, in his hands until it is yours. */}
      <group name="parcel" position={[0, 1.02, 0.33]}>
        <PropModel kind="takeaway" full />
      </group>
    </group>
  )
}
