import { useMemo } from 'react'
import { roomBounds } from '../world/derive'
import type { RoomSpec } from '../world/schema'
import { useWorldStore } from '../state/world'

/**
 * Daylight through the windows plus warm interior fill, per room.
 *
 * Only one directional light casts shadows, for the whole world: a shadow map
 * per room would eat the frame budget the books need, and a single sun angled
 * across the library reads as one building rather than several.
 */

/** Ceiling fixtures roughly every this many metres, in each direction. */
const FIXTURE_SPACING = 3.4

function RoomLights({ room }: { room: RoomSpec }) {
  const [cx, cz] = room.origin
  const [width, depth] = room.size

  const fixtures = useMemo(() => {
    const across = Math.max(1, Math.round(width / FIXTURE_SPACING))
    const along = Math.max(1, Math.round(depth / FIXTURE_SPACING))
    const points: [number, number][] = []
    for (let i = 0; i < across; i++) {
      for (let j = 0; j < along; j++) {
        points.push([
          cx + ((i + 0.5) / across - 0.5) * width,
          cz + ((j + 0.5) / along - 0.5) * depth,
        ])
      }
    }
    return points
  }, [cx, cz, width, depth])

  return (
    <>
      {/* Warm ceiling fixtures. Intensity is in candela and falls off with the
          square of distance, so these numbers are larger than they look: at the
          ~2.4 m from ceiling to shelf face, 8 cd arrives as roughly 1.4. */}
      {fixtures.map(([x, z], i) => (
        <pointLight
          key={i}
          position={[x, room.height - 0.4, z]}
          intensity={8}
          distance={12}
          color="#ffd9a8"
        />
      ))}

      {/* Soft bounce off the reveal of each window, back into the room. */}
      {room.openings
        .filter((opening) => opening.kind === 'window')
        .map((opening, i) => {
          const bounds = roomBounds(room)
          const y = opening.sill + opening.height / 2
          const inset = 0.8
          const position: [number, number, number] =
            opening.wall === 'north'
              ? [cx + opening.at, y, bounds.minZ + inset]
              : opening.wall === 'south'
                ? [cx + opening.at, y, bounds.maxZ - inset]
                : opening.wall === 'west'
                  ? [bounds.minX + inset, y, cz + opening.at]
                  : [bounds.maxX - inset, y, cz + opening.at]
          return (
            <pointLight
              key={`win-${i}`}
              position={position}
              intensity={4}
              distance={9}
              color="#dceaf6"
            />
          )
        })}
    </>
  )
}

export function Lighting() {
  const world = useWorldStore((s) => s.world)

  /** One shadow camera wide enough to cover every room in the document. */
  const extent = useMemo(() => {
    if (!world || world.rooms.length === 0) {
      return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, height: 3.2 }
    }
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let height = 0
    for (const room of world.rooms) {
      const b = roomBounds(room)
      minX = Math.min(minX, b.minX)
      maxX = Math.max(maxX, b.maxX)
      minZ = Math.min(minZ, b.minZ)
      maxZ = Math.max(maxZ, b.maxZ)
      height = Math.max(height, room.height)
    }
    return { minX, maxX, minZ, maxZ, height }
  }, [world])

  const spanX = extent.maxX - extent.minX
  const spanZ = extent.maxZ - extent.minZ
  const midX = (extent.minX + extent.maxX) / 2
  const midZ = (extent.minZ + extent.maxZ) / 2
  const radius = Math.hypot(spanX, spanZ) / 2 + 2

  return (
    <>
      {/* Shelves face into the room with their backs to the walls, so they see
          almost none of the window light. Without a generous ambient floor the
          spines read as black and the library is unbrowsable. */}
      <ambientLight intensity={0.38} />
      <hemisphereLight args={['#dceaf6', '#7a5f42', 0.45]} />

      <directionalLight
        position={[midX - spanX * 0.3, extent.height + radius * 0.8, extent.minZ - radius * 0.6]}
        target-position={[midX, 0, midZ]}
        intensity={2.4}
        color="#fff2dd"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={extent.height + 2}
        shadow-camera-bottom={-2}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 3 + 20}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />

      {world?.rooms.map((room) => <RoomLights key={room.id} room={room} />)}
    </>
  )
}
