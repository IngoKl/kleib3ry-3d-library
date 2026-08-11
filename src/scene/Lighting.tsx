import { useMemo } from 'react'
import { FurnitureLights } from './Furniture'
import { roomBounds } from '../world/derive'
import type { RoomSpec } from '../world/schema'
import { useLightStore } from '../state/lights'
import { useWorldStore } from '../state/world'

/**
 * Daylight through the windows plus warm interior fill — or moonlight, because
 * night is a switch now and a library is somewhere you want to be after dark.
 *
 * Only one directional light casts shadows, for the whole world: a shadow map
 * per room would eat the frame budget the books need, and a single sun angled
 * across the library reads as one building rather than several. At night the
 * same light is the moon, low and cold, so the shadow path never changes shape.
 *
 * The lamps themselves are no longer invented per room — they are furniture in
 * `library.json`, and switching one off is a thing you can do. What is left
 * here is the light that has no fitting: the sun, the sky, and the wash coming
 * back off a window reveal. A room that declares no lamps at all still gets one
 * soft fixture, so that a map somebody is halfway through writing is not pitch
 * dark while they write it.
 *
 * Every intensity in here has been argued down once already: the first pass
 * left hot pools under the pendants and sun stripes you could read by, which
 * is a stage set rather than an afternoon.
 */

function RoomFill({ room, unlit, night }: { room: RoomSpec; unlit: boolean; night: boolean }) {
  const [cx, cz] = room.origin
  const bounds = roomBounds(room)

  return (
    <>
      {unlit && !room.outdoor && (
        <pointLight
          position={[cx, room.elevation + room.height - 0.5, cz]}
          intensity={3.6}
          distance={Math.hypot(room.size[0], room.size[1]) + 2}
          color="#ffd9a8"
        />
      )}

      {/* Soft bounce off the reveal of each window, back into the room. An
          unglazed opening — a balustrade, a porch railing — is not a window and
          does not light anything. At night the same wash goes cold and faint:
          moonlight on the reveal rather than sky. */}
      {room.openings
        .filter((opening) => opening.kind === 'window' && opening.glazed)
        .map((opening, i) => {
          const y = room.elevation + opening.sill + opening.height / 2
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
              intensity={night ? 1.0 : 2.8}
              distance={night ? 7 : 9}
              color={night ? '#5c6478' : '#dceaf6'}
            />
          )
        })}
    </>
  )
}

export function Lighting() {
  const world = useWorldStore((s) => s.world)
  const night = useLightStore((s) => s.night)

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
      height = Math.max(height, room.elevation + room.height)
    }
    return { minX, maxX, minZ, maxZ, height }
  }, [world])

  /** Rooms with no lamp of their own, which get a fallback fixture. */
  const unlit = useMemo(() => {
    if (!world) return new Set<string>()
    const lit = new Set(world.lights.map((lamp) => lamp.roomId))
    return new Set(world.rooms.map((room) => room.id).filter((id) => !lit.has(id)))
  }, [world])

  const spanX = extent.maxX - extent.minX
  const spanZ = extent.maxZ - extent.minZ
  const midX = (extent.minX + extent.maxX) / 2
  const midZ = (extent.minZ + extent.maxZ) / 2
  const radius = Math.hypot(spanX, spanZ) / 2 + 5

  return (
    <>
      {/* Shelves face into the room with their backs to the walls, so they see
          almost none of the window light. Without a generous ambient floor the
          spines read as black and the library is unbrowsable — which is also
          why night does not go truly dark: the ambient floor stays generous
          and *warm*, so the dark is lamplight fading into shadow rather than
          black corners with hot pools between them. */}
      {/* The daytime fill is warm and a notch lower than it used to be: even
          white light at office levels is what made the cabin read as a meeting
          room. The sun below carries more of the day instead. */}
      <ambientLight intensity={night ? 0.34 : 0.38} color={night ? '#a8967e' : '#fdf2e0'} />
      <hemisphereLight
        args={night ? ['#41465c', '#33291e', 0.45] : ['#cfdff0', '#8a6f4c', 0.5]}
      />

      {/* Low and to the north-west, which is where the lake is: afternoon
          light coming in through the big window rather than noon overhead. At
          night the same light is the moon over the same lake. */}
      <directionalLight
        position={[midX - spanX * 0.5, extent.height + radius * 0.55, extent.minZ - radius * 0.7]}
        target-position={[midX, 0, midZ]}
        intensity={night ? 0.35 : 1.9}
        color={night ? '#b4c4e2' : '#ffe6c2'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        // Square and generous. The frustum is in the *light's* view space, so a
        // box sized to the building's plan does not cover the building once the
        // sun is off-axis — and the edge of the shadow map is a hard vertical
        // seam of brightness straight up the middle of the room.
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 3 + 20}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />

      {world?.rooms.map((room) => (
        <RoomFill key={room.id} room={room} unlit={unlit.has(room.id)} night={night} />
      ))}
      <FurnitureLights />
    </>
  )
}
