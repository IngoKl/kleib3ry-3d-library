import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIALS, makeFloorTexture } from './materials'
import {
  FLOOR_SLAB,
  SKIRTING,
  floorSlabs,
  roomBounds,
  wallPanels,
  wallsOf,
  windowPanes,
  type Panel,
  type Slab,
} from '../world/derive'
import type { RoomSpec, Wall } from '../world/schema'
import { useWorldStore } from '../state/world'

/**
 * The building itself: floors, walls, glazing and rafters.
 *
 * Two things here are less obvious than they look. Floors are *slabs*, not
 * planes, because a loft floor is also the ceiling of the room underneath it
 * and a plane has no underside — and because a stairwell is a rectangle taken
 * out of one, which `floorSlabs` does by subtraction so that what you see and
 * what `floorAt` lets you stand on are the same geometry. And a room only
 * builds the walls it declares, so a porch is a roof on four posts rather than
 * a room with the walls turned off.
 */

/**
 * Nudge a pane just inside its reveal, so the glass does not z-fight the
 * plaster. The thin axis of the box is the one the wall faces along.
 */
function paneOf(pane: Panel): Panel {
  const [x, y, z] = pane.position
  const facesX = pane.size[0] < pane.size[2]
  return {
    position: [x, y, z],
    size: facesX ? [0.012, pane.size[1], pane.size[2]] : [pane.size[0], pane.size[1], 0.012],
  }
}

/**
 * A set of boxes as a single geometry.
 *
 * A room's shell is a dozen wall panels once its openings are cut out, plus
 * four lengths of skirting and a rafter every metre — thirty-odd meshes per
 * room, and five rooms of that was most of the frame's draw calls before any
 * books were drawn. They never move relative to each other, so they are merged
 * once per document and drawn as one.
 */
function merge(panels: readonly Panel[]): THREE.BufferGeometry | null {
  if (panels.length === 0) return null
  const parts = panels.map((panel) => {
    const box = new THREE.BoxGeometry(...panel.size)
    box.translate(...panel.position)
    return box
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  return merged
}

/** One merged pile of boxes, in one material. */
function Shell({
  panels,
  color,
  roughness = 0.95,
}: {
  panels: readonly Panel[]
  color: string
  roughness?: number
}) {
  const geometry = useMemo(() => merge(panels), [panels])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={0} />
    </mesh>
  )
}

/**
 * One floor rectangle, as a slab with an underside.
 *
 * The texture is shared across the whole room and offset per slab, so the
 * boards run continuously across a stairwell rather than restarting at every
 * cut — which is what gives away a floor built out of pieces.
 */
function FloorSlab({ slab, texture }: { slab: Slab; texture: THREE.Texture }) {
  const width = slab.maxX - slab.minX
  const depth = slab.maxZ - slab.minZ
  const map = useMemo(() => {
    const own = texture.clone()
    own.needsUpdate = true
    own.repeat.set(width / 2.4, depth / 2.4)
    own.offset.set(slab.minX / 2.4, -slab.maxZ / 2.4)
    return own
  }, [texture, width, depth, slab.minX, slab.maxZ])
  useEffect(() => () => map.dispose(), [map])

  return (
    <mesh
      position={[(slab.minX + slab.maxX) / 2, slab.y - FLOOR_SLAB / 2, (slab.minZ + slab.maxZ) / 2]}
      receiveShadow
      castShadow
    >
      <boxGeometry args={[width, FLOOR_SLAB, depth]} />
      <meshStandardMaterial map={map} roughness={0.62} metalness={0} />
    </mesh>
  )
}

/** Where the skirting runs along one wall of a room. */
function skirtingFor(room: RoomSpec, wall: Wall): Panel {
  const bounds = roomBounds(room)
  const [cx, cz] = room.origin
  const [width, depth] = room.size
  const y = room.elevation + SKIRTING.height / 2
  switch (wall) {
    case 'north':
      return { position: [cx, y, bounds.minZ + 0.01], size: [width, SKIRTING.height, SKIRTING.depth] }
    case 'south':
      return { position: [cx, y, bounds.maxZ - 0.01], size: [width, SKIRTING.height, SKIRTING.depth] }
    case 'west':
      return { position: [bounds.minX + 0.01, y, cz], size: [SKIRTING.depth, SKIRTING.height, depth] }
    case 'east':
      return { position: [bounds.maxX - 0.01, y, cz], size: [SKIRTING.depth, SKIRTING.height, depth] }
  }
}

/**
 * Rafters across the ceiling, and corner posts where a room is missing walls.
 *
 * Both are timber, so they merge into the same mesh. A porch is a roof with
 * nothing holding it up, which reads as a bug rather than as architecture;
 * four posts is the whole fix.
 */
function timberOf(room: RoomSpec): Panel[] {
  const [cx, cz] = room.origin
  const [width, depth] = room.size
  const panels: Panel[] = []

  if (room.ceiling) {
    const spacing = 1.15
    const count = Math.max(1, Math.round(depth / spacing) - 1)
    for (let i = 0; i < count; i++) {
      const z = cz + ((i + 1) / (count + 1) - 0.5) * depth
      panels.push({
        position: [cx, room.elevation + room.height - 0.13, z],
        size: [width, 0.16, 0.11],
      })
    }

    if (room.walls.length < 4) {
      const bounds = roomBounds(room)
      const inset = 0.09
      for (const [x, z] of [
        [bounds.minX + inset, bounds.minZ + inset],
        [bounds.maxX - inset, bounds.minZ + inset],
        [bounds.minX + inset, bounds.maxZ - inset],
        [bounds.maxX - inset, bounds.maxZ - inset],
      ] as [number, number][]) {
        panels.push({
          position: [x, room.elevation + room.height / 2, z],
          size: [0.14, room.height, 0.14],
        })
      }
    }
  }

  return panels
}

function Room({ room }: { room: RoomSpec }) {
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const [width, depth] = room.size
  const [cx, cz] = room.origin

  // The floor is almost always seen at a grazing angle, which is the case
  // isotropic mipmapping handles worst. Anisotropy is effectively free here.
  const floorTexture = useMemo(() => {
    const texture = makeFloorTexture(width, depth, room.floor)
    texture.anisotropy = maxAnisotropy
    return texture
  }, [width, depth, room.floor, maxAnisotropy])
  useEffect(() => () => floorTexture.dispose(), [floorTexture])

  // Boards overhead as well as underfoot: a plaster lid on a timber room was
  // the one surface still insisting this was a gallery.
  const ceilingTexture = useMemo(() => {
    if (!room.ceiling) return null
    const texture = makeFloorTexture(width, depth, 'ceiling')
    texture.anisotropy = maxAnisotropy
    return texture
  }, [width, depth, room.ceiling, maxAnisotropy])
  useEffect(() => () => ceilingTexture?.dispose(), [ceilingTexture])

  const walls = wallsOf(room)
  const panels = useMemo(() => walls.flatMap((wall) => wallPanels(room, wall)), [room, walls])
  const panes = useMemo(() => windowPanes(room).map(paneOf), [room])
  const slabs = useMemo(() => floorSlabs(room), [room])
  const timber = useMemo(() => timberOf(room), [room])
  const skirting = useMemo(
    () => (room.outdoor ? [] : walls.map((wall) => skirtingFor(room, wall))),
    [room, walls],
  )

  return (
    <group>
      {slabs.map((slab, i) => (
        <FloorSlab key={`floor-${i}`} slab={slab} texture={floorTexture} />
      ))}

      {room.ceiling && ceilingTexture && (
        <mesh position={[cx, room.elevation + room.height, cz]} rotation-x={Math.PI / 2} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial map={ceilingTexture} roughness={0.92} />
        </mesh>
      )}
      <Shell panels={panels} color={MATERIALS.wall} />
      <Shell panels={timber} color={MATERIALS.timber} roughness={0.87} />
      <Shell panels={skirting} color={MATERIALS.skirting} roughness={0.7} />

      {/* Real glass now that there is a forest to look at through it. Thin,
          barely tinted, and deliberately *not* a transmissive material: that
          costs a whole extra render pass per frame, which is a lot to pay for
          a pane you are meant to look straight through. */}
      {panes.map((pane, i) => (
        <mesh key={`pane-${i}`} position={pane.position}>
          <boxGeometry args={pane.size} />
          <meshStandardMaterial
            color="#dbe9f2"
            transparent
            opacity={0.13}
            roughness={0.08}
            metalness={0.1}
            depthWrite={false}
          />
        </mesh>
      ))}

    </group>
  )
}

/** Every room in the world document. */
export function Rooms() {
  const world = useWorldStore((s) => s.world)
  if (!world) return null
  return (
    <group>
      {world.rooms.map((room) => (
        <Room key={room.id} room={room} />
      ))}
    </group>
  )
}
