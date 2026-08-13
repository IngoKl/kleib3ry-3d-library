import { useLayoutEffect, useRef } from 'react'
import type * as THREE from 'three'
import { sceneRefs } from './refs'
import { useLibraryStore } from '../state/library'
import type { PropKind } from '../services/types'

/**
 * The small things standing about the room: the coffee cup, the cans, the
 * takeaway boxes. Real meshes rather than instances — there are a dozen of
 * them at most, and each is three or four boxes and cylinders.
 *
 * The models are shared with `HeldProp`, so the can in your hand is the can
 * you set down. Every model's origin is its base, which is what lets a prop
 * stand on whatever surface its stored `y` names.
 */

const PORCELAIN = '#e6e4dd'
const COFFEE = '#40251a'
const CAN = '#a8402f'
const CAN_LID = '#b8bcb6'
const CARD = '#b9915f'
const CARD_DARK = '#a07a4b'

function Cup({ full }: { full: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.038, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.036, 0.03, 0.076, 12]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.35} />
      </mesh>
      {/* The handle: a ring on the side, the way a mug actually reads. */}
      <mesh position={[0.042, 0.04, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.018, 0.005, 6, 10]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.4} />
      </mesh>
      {/* What is in it. An empty cup shows its own glaze instead. */}
      <mesh position={[0, 0.069, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.004, 12]} />
        <meshStandardMaterial color={full ? COFFEE : '#dedbd2'} roughness={full ? 0.3 : 0.5} />
      </mesh>
    </group>
  )
}

function Can() {
  return (
    <group>
      <mesh position={[0, 0.057, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.029, 0.029, 0.106, 12]} />
        <meshStandardMaterial color={CAN} roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.112, 0]} castShadow>
        <cylinderGeometry args={[0.026, 0.029, 0.008, 12]} />
        <meshStandardMaterial color={CAN_LID} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* The tab, off-centre the way a pulled one sits. */}
      <mesh position={[0.006, 0.117, 0]}>
        <boxGeometry args={[0.014, 0.002, 0.008]} />
        <meshStandardMaterial color={CAN_LID} roughness={0.35} metalness={0.7} />
      </mesh>
    </group>
  )
}

function Takeaway({ full }: { full: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.055, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.26, 0.11, 0.2]} />
        <meshStandardMaterial color={CARD} roughness={1} />
      </mesh>
      {full ? (
        // Closed and waiting, with the lid seam scored across the top.
        <mesh position={[0, 0.111, 0]}>
          <boxGeometry args={[0.252, 0.004, 0.03]} />
          <meshStandardMaterial color={CARD_DARK} roughness={1} />
        </mesh>
      ) : (
        // Eaten: the flaps stand open, which is how an empty box sits.
        [-1, 1].map((side) => (
          <mesh
            key={side}
            position={[0, 0.135, side * 0.093]}
            rotation-x={side * 1.1}
            castShadow
          >
            <boxGeometry args={[0.25, 0.004, 0.1]} />
            <meshStandardMaterial color={CARD_DARK} roughness={1} />
          </mesh>
        ))
      )}
    </group>
  )
}

/** The headlamp, lying where it was left: the strap coiled flat, the lamp on it. */
function HeadlampAtRest() {
  return (
    <group>
      <mesh position={[0, 0.012, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[0.05, 0.011, 6, 14]} />
        <meshStandardMaterial color="#5a4632" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.028, -0.045]} rotation-x={-0.25} castShadow>
        <boxGeometry args={[0.056, 0.04, 0.036]} />
        <meshStandardMaterial color="#3c4043" roughness={0.55} />
      </mesh>
      {/* The lens, catching a little light even off. */}
      <mesh position={[0, 0.032, -0.024]} rotation-x={Math.PI / 2 - 0.25}>
        <cylinderGeometry args={[0.015, 0.015, 0.006, 12]} />
        <meshStandardMaterial color="#efe6c8" roughness={0.25} />
      </mesh>
    </group>
  )
}

/** One prop, by kind. Shared between the room, the hand, and the porch table. */
export function PropModel({ kind, full }: { kind: PropKind; full: boolean }) {
  switch (kind) {
    case 'cup':
      return <Cup full={full} />
    case 'can':
      return <Can />
    case 'takeaway':
      return <Takeaway full={full} />
    case 'headlamp':
      return <HeadlampAtRest />
  }
}

export function Props() {
  const props = useLibraryStore((s) => s.props)
  const group = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    sceneRefs.props = group.current
    return () => {
      sceneRefs.props = null
    }
  }, [props])

  return (
    <group ref={group}>
      {Object.entries(props).map(([id, prop]) => (
        <group
          key={id}
          position={[prop.x, prop.y, prop.z]}
          rotation-y={prop.yaw}
          // On the group, so a hit on the handle resolves to the cup.
          userData={{ propId: id }}
        >
          <PropModel kind={prop.kind} full={prop.full} />
        </group>
      ))}
    </group>
  )
}
