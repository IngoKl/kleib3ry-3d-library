import { useLayoutEffect, useRef } from 'react'
import type * as THREE from 'three'
import { sceneRefs } from './refs'
import { useWorldStore } from '../state/world'
import { SITTABLE, type DerivedFurniture } from '../world/derive'

/**
 * Furniture, built from boxes and cylinders rather than shipped as models.
 *
 * The same reasoning as the floor texture: the repo stays text, the proportions
 * stay legible, and a chair is a few numbers you can argue with. Nothing here is
 * detailed enough to inspect closely — it is meant to read correctly at the
 * distance you actually see it from, which is standing up, across a room.
 */

const CLOTH = '#7a5a4a'
const CLOTH_DARK = '#6a4c3e'
const OAK = '#8a6039'
const WOOL = '#8c6f58'
const BRASS = '#b08d57'
const SHADE = '#f2e3c4'
const CARD = '#b9915f'
const CARD_DARK = '#a07a4b'

function Armchair() {
  return (
    <group>
      {/* seat, back, two arms — a wing chair reduced to its four masses */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.16, 0.74]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.62, -0.31]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.62, 0.16]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      <mesh position={[-0.35, 0.55, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.28, 0.72]} />
        <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
      </mesh>
      <mesh position={[0.35, 0.55, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.28, 0.72]} />
        <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
      </mesh>
      {/* a seat cushion, slightly proud, so the seat is not a slab */}
      <mesh position={[0, 0.5, 0.02]} castShadow>
        <boxGeometry args={[0.7, 0.1, 0.66]} />
        <meshStandardMaterial color={CLOTH} roughness={1} />
      </mesh>
      {[-0.3, 0.3].map((x) =>
        [-0.28, 0.28].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.16, z]} castShadow>
            <boxGeometry args={[0.07, 0.32, 0.07]} />
            <meshStandardMaterial color={OAK} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Footstool() {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.14, 0.38]} />
        <meshStandardMaterial color={CLOTH} roughness={1} />
      </mesh>
      {[-0.17, 0.17].map((x) =>
        [-0.13, 0.13].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.12, z]} castShadow>
            <boxGeometry args={[0.05, 0.24, 0.05]} />
            <meshStandardMaterial color={OAK} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function SideTable() {
  return (
    <group>
      <mesh position={[0, 0.54, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.035, 0.44]} />
        <meshStandardMaterial color={OAK} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.26, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, 0.53, 12]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.19, 0.2, 0.03, 16]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
    </group>
  )
}

function Rug({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      <mesh position={[0, 0.006, 0]} receiveShadow>
        <boxGeometry args={[width, 0.012, depth]} />
        <meshStandardMaterial color={WOOL} roughness={1} />
      </mesh>
      {/* a border, so it reads as a rug rather than as a stain on the floor */}
      <mesh position={[0, 0.013, 0]} receiveShadow>
        <boxGeometry args={[width - 0.22, 0.002, depth - 0.22]} />
        <meshStandardMaterial color="#9d8064" roughness={1} />
      </mesh>
    </group>
  )
}

function FloorLamp() {
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.17, 0.04, 16]} />
        <meshStandardMaterial color={BRASS} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 1.4, 10]} />
        <meshStandardMaterial color={BRASS} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.28, 20, 1, true]} />
        <meshStandardMaterial color={SHADE} roughness={1} side={2} />
      </mesh>
      {/* The bulb. Short range: a reading lamp lights a chair, not a room. */}
      <pointLight position={[0, 1.44, 0]} intensity={5} distance={4.2} color="#ffd9a0" />
    </group>
  )
}

/** An open moving box, flaps folded out. */
function MovingBox({ width, depth }: { width: number; depth: number }) {
  const height = 0.36
  const wall = 0.014
  return (
    <group>
      <mesh position={[0, wall / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={CARD_DARK} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`x${side}`}
          position={[(side * (width - wall)) / 2, height / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`z${side}`}
          position={[0, height / 2, (side * (depth - wall)) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {/* flaps, folded down the outside */}
      {[-1, 1].map((side) => (
        <mesh
          key={`flap${side}`}
          position={[0, height - 0.06, (side * (depth + 0.02)) / 2]}
          rotation-x={side * 0.5}
          castShadow
        >
          <boxGeometry args={[width * 0.98, 0.16, wall]} />
          <meshStandardMaterial color={CARD_DARK} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

function Piece({ item }: { item: DerivedFurniture }) {
  const body = (() => {
    switch (item.kind) {
      case 'armchair':
        return <Armchair />
      case 'footstool':
        return <Footstool />
      case 'sidetable':
        return <SideTable />
      case 'rug':
        return <Rug width={item.width} depth={item.depth} />
      case 'floorlamp':
        return <FloorLamp />
      case 'box':
        return <MovingBox width={item.width} depth={item.depth} />
    }
  })()

  return (
    <group
      position={[item.x, 0, item.z]}
      rotation-y={item.rotationY}
      // Carried on the group so a hit on any of the chair's several meshes
      // resolves to the piece of furniture, not to an arm or a leg.
      userData={{ furnitureId: item.id }}
    >
      {body}
    </group>
  )
}

export function Furniture() {
  const world = useWorldStore((s) => s.world)
  const seats = useRef<THREE.Group>(null)
  const boxes = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    sceneRefs.seats = seats.current
    sceneRefs.boxes = boxes.current
    return () => {
      sceneRefs.seats = null
      sceneRefs.boxes = null
    }
  }, [world])

  if (!world) return null

  const sittable = world.furniture.filter((item) => SITTABLE.has(item.kind))
  const movingBoxes = world.furniture.filter((item) => item.kind === 'box')
  const rest = world.furniture.filter(
    (item) => !SITTABLE.has(item.kind) && item.kind !== 'box',
  )

  return (
    <group>
      {rest.map((item) => (
        <Piece key={`${item.roomId}:${item.id}`} item={item} />
      ))}

      {/* Kept in their own groups so the crosshair can raycast only the things
          worth pointing at, rather than every rug and table leg in the room. */}
      <group ref={seats}>
        {sittable.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} />
        ))}
      </group>

      <group ref={boxes}>
        {movingBoxes.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} />
        ))}
      </group>
    </group>
  )
}
