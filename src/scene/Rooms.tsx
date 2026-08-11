import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { MATERIALS, makeFloorTexture } from './materials'
import {
  SKIRTING,
  WALLS,
  roomBounds,
  wallPanels,
  windowPanes,
  type Panel,
} from '../world/derive'
import type { RoomSpec } from '../world/schema'
import { useWorldStore } from '../state/world'

/**
 * Nudge a pane just outside its wall, so the sky behind it does not z-fight the
 * plaster. The thin axis of the box is the one the wall faces along.
 */
function outsideOf(pane: Panel, cx: number, cz: number): [number, number, number] {
  const [x, y, z] = pane.position
  const facesX = pane.size[0] < pane.size[2]
  return facesX
    ? [x + Math.sign(x - cx) * 0.06, y, z]
    : [x, y, z + Math.sign(z - cz) * 0.06]
}

/** A wall panel or floor slab, straight from the derived geometry. */
function Box({ panel, color }: { panel: Panel; color: string }) {
  return (
    <mesh position={panel.position} castShadow receiveShadow>
      <boxGeometry args={panel.size} />
      <meshStandardMaterial color={color} roughness={0.95} metalness={0} />
    </mesh>
  )
}

function Room({ room }: { room: RoomSpec }) {
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const [width, depth] = room.size
  const [cx, cz] = room.origin

  // The floor is almost always seen at a grazing angle, which is the case
  // isotropic mipmapping handles worst. Anisotropy is effectively free here.
  const floorTexture = useMemo(() => {
    const texture = makeFloorTexture(width, depth)
    texture.anisotropy = maxAnisotropy
    return texture
  }, [width, depth, maxAnisotropy])
  useEffect(() => () => floorTexture.dispose(), [floorTexture])

  const panels = useMemo(() => WALLS.flatMap((wall) => wallPanels(room, wall)), [room])
  const panes = useMemo(() => windowPanes(room), [room])
  const bounds = roomBounds(room)

  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floorTexture} roughness={0.62} metalness={0} />
      </mesh>

      <mesh position={[cx, room.height, cz]} rotation-x={Math.PI / 2} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={MATERIALS.ceiling} roughness={1} />
      </mesh>

      {panels.map((panel, i) => (
        <Box key={`wall-${i}`} panel={panel} color={MATERIALS.wall} />
      ))}

      {/* Daylight behind each opening — a stand-in for an exterior until there
          is one. Pushed just outside the glass so it does not z-fight the wall. */}
      {panes.map((pane, i) => (
        <mesh key={`pane-${i}`} position={outsideOf(pane, cx, cz)}>
          <boxGeometry args={pane.size} />
          <meshBasicMaterial color={MATERIALS.daylight} toneMapped={false} />
        </mesh>
      ))}

      {/* Skirting, run as four unbroken lengths. A door interrupts it in
          reality, but at ankle height in a doorway you will never look. */}
      <mesh position={[cx, SKIRTING.height / 2, bounds.minZ + 0.01]} receiveShadow>
        <boxGeometry args={[width, SKIRTING.height, SKIRTING.depth]} />
        <meshStandardMaterial color={MATERIALS.skirting} roughness={0.7} />
      </mesh>
      <mesh position={[cx, SKIRTING.height / 2, bounds.maxZ - 0.01]} receiveShadow>
        <boxGeometry args={[width, SKIRTING.height, SKIRTING.depth]} />
        <meshStandardMaterial color={MATERIALS.skirting} roughness={0.7} />
      </mesh>
      <mesh position={[bounds.minX + 0.01, SKIRTING.height / 2, cz]} receiveShadow>
        <boxGeometry args={[SKIRTING.depth, SKIRTING.height, depth]} />
        <meshStandardMaterial color={MATERIALS.skirting} roughness={0.7} />
      </mesh>
      <mesh position={[bounds.maxX - 0.01, SKIRTING.height / 2, cz]} receiveShadow>
        <boxGeometry args={[SKIRTING.depth, SKIRTING.height, depth]} />
        <meshStandardMaterial color={MATERIALS.skirting} roughness={0.7} />
      </mesh>
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

