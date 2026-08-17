import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { block, join } from './geometry'
import { PropModel } from './Props'
import { approach } from '../lib/ease'
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
/** The forward hold of the arms while the parcel is in them. */
const CARRY = -1.1

export function Courier() {
  const about = useAppStore((s) => s.courierAbout)
  if (!about) return null
  return <Walker />
}

function Walker() {
  // What he is carrying, read once per delivery: `courier.parcel` is set before
  // he sets off and does not change on the way, so this is mount-time state
  // rather than something the frame loop has to look at.
  const book = courier.parcel.kind === 'book'
  const group = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  /** Eased 0..1 blends, so a phase flip folds the limbs rather than snapping them. */
  const standing = useRef(0)
  const armsFree = useRef(0)

  // One geometry where nothing moves apart — torso, cap and brim are all the
  // uniform's red. The limbs hang from the origin, so a group rotation is the
  // joint; one geometry serves both sides.
  const parts = useMemo(() => {
    const cap = new THREE.CylinderGeometry(0.115, 0.115, 0.06, 10)
    cap.translate(0, 1.64, 0.01)
    return {
      jacket: join([
        block(0.42, 0.56, 0.24, 0, 1.12, 0),
        cap,
        block(0.16, 0.02, 0.1, 0, 1.62, 0.12),
      ]),
      leg: block(0.13, 0.84, 0.16, 0, -0.42, 0),
      arm: block(0.09, 0.44, 0.09, 0, -0.22, 0),
    }
  }, [])

  useEffect(
    () => () => {
      parts.jacket?.dispose()
      parts.leg.dispose()
      parts.arm.dispose()
    },
    [parts],
  )

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
        // The parcel lands, and only now: the delivery is him, not a timer.
        const shelf = useLibraryStore.getState()
        if (courier.parcel.kind === 'book') {
          // It reconciled into a box when it was indexed, which is where a new
          // book goes; he takes it back out and stands it on the ground, so
          // what you find at the steps is the paper itself.
          shelf.unshelve(courier.parcel.id)
          shelf.putDown(courier.parcel.id, { ...courier.target, open: false, spread: 0 })
        } else {
          shelf.placeProp({ kind: 'takeaway', full: true, ...courier.target })
        }
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

    // The gait. Legs swing opposed in both walk phases; the arms swing only
    // once the parcel is down — on the way in they are a shelf, not limbs.
    standing.current += ((courier.phase === 'dropping' ? 1 : 0) - standing.current) * approach(8, delta)
    armsFree.current += ((courier.phase === 'leaving' ? 1 : 0) - armsFree.current) * approach(8, delta)
    const swing = Math.sin(courier.stride) * 0.45 * (1 - standing.current)
    if (legL.current) legL.current.rotation.x = swing
    if (legR.current) legR.current.rotation.x = -swing
    // An arm opposes its own side's leg, the way a walk does.
    if (armL.current) armL.current.rotation.x = CARRY * (1 - armsFree.current) - swing * armsFree.current
    if (armR.current) armR.current.rotation.x = CARRY * (1 - armsFree.current) + swing * armsFree.current
  })

  return (
    <group ref={group}>
      {/* Legs, torso, head, cap: a courier at the distance you see him from. */}
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.09, 0.84, 0]}>
          <mesh geometry={parts.leg} castShadow>
            <meshStandardMaterial color="#3a3f46" roughness={0.9} />
          </mesh>
        </group>
      ))}
      <mesh geometry={parts.jacket} castShadow>
        <meshStandardMaterial color="#b8452e" roughness={0.8} />
      </mesh>
      {/* Arms held forward, carrying, until the drop frees them to swing. */}
      {[-1, 1].map((side) => (
        <group
          key={`arm${side}`}
          ref={side < 0 ? armL : armR}
          position={[side * 0.19, 1.32, 0]}
          rotation-x={CARRY}
        >
          <mesh geometry={parts.arm} castShadow>
            <meshStandardMaterial color="#b8452e" roughness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#d8b59a" roughness={0.9} />
      </mesh>
      {/* What he is bringing, in his hands until it is yours. */}
      <group name="parcel" position={[0, 1.02, 0.33]}>
        {book ? (
          // A book rather than a takeaway: hand-sized, and held flat the same
          // way the box is. Its own slab rather than the real book's mesh —
          // `Books` draws what is *in* the room, and this is not in it yet.
          <mesh castShadow>
            <boxGeometry args={[0.2, 0.05, 0.28]} />
            <meshStandardMaterial color="#7d3b32" roughness={0.85} />
          </mesh>
        ) : (
          <PropModel kind="takeaway" full />
        )}
      </group>
    </group>
  )
}
