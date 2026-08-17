import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergePanels } from './geometry'
import { ambienceBlend } from './ambienceBlend'
import { sceneRefs } from './refs'
import { MATERIALS, makeFloorTexture, wallWashTexture } from './materials'
import { useAmbienceStore } from '../state/ambience'
import {
  FLOOR_SLAB,
  SKIRTING,
  WALL,
  floorSlabs,
  openingPanels,
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
const merge = mergePanels

/** One merged pile of boxes, in one material. */
function Shell({
  panels,
  color,
  roughness = 0.95,
  map,
  userData,
}: {
  panels: readonly Panel[]
  color: string
  roughness?: number
  /** Multiplied under `color` — a near-white wash, not a palette of its own. */
  map?: THREE.Texture
  /** Marks a shell as something the crosshair may treat as a wall. */
  userData?: Record<string, unknown>
}) {
  const geometry = useMemo(() => merge(panels), [panels])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <mesh geometry={geometry} userData={userData} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={0} map={map ?? null} />
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
function FloorSlab({
  slab,
  texture,
  bias = 0,
}: {
  slab: Slab
  texture: THREE.Texture
  bias?: number
}) {
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
      position={[
        (slab.minX + slab.maxX) / 2,
        slab.y - FLOOR_SLAB / 2 + bias,
        (slab.minZ + slab.maxZ) / 2,
      ]}
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

/**
 * Joinery round the openings: frames, mullions and sills for the glazed
 * windows, architraves for the doors. A hole cut straight through plaster
 * reads as a render; a window is a window because timber surrounds it. All of
 * it is boxes in the timber material, so it joins the rafters' merge and
 * costs no draw call. Every piece stands proud of both wall faces by more
 * than the pane's ±0.006 nudge, so glass and frame never fight for pixels.
 */
const TRIM = 0.045
const ARCHITRAVE = 0.07
/**
 * How far the door trim laps over its opening, and under its own head. Flush,
 * an architrave's faces land exactly on the reveal `wallPanels` leaves and on
 * its own head's ends — coplanar, co-facing, and flickering the height of the
 * doorway. `paneOf`'s nudge, at a door, and far too small to narrow anything.
 */
const LAP = 0.01

function trimOf(room: RoomSpec): Panel[] {
  const panels: Panel[] = []
  for (const { panel, opening } of openingPanels(room)) {
    const [x, y, z] = panel.position
    const runsX = panel.size[0] > panel.size[2]
    const w = runsX ? panel.size[0] : panel.size[2]
    const h = panel.size[1]
    /** A box at (du along the wall, dy up), centred on the wall's own plane. */
    const box = (du: number, dy: number, su: number, sy: number, sn: number): Panel =>
      runsX
        ? { position: [x + du, y + dy, z], size: [su, sy, sn] }
        : { position: [x, y + dy, z + du], size: [sn, sy, su] }

    if (opening.kind === 'window' && opening.glazed) {
      const s = TRIM
      const t = WALL + 0.02
      panels.push(box(-(w - s) / 2, 0, s, h, t))
      panels.push(box((w - s) / 2, 0, s, h, t))
      panels.push(box(0, (h - s) / 2, w, s, t))
      // One vertical mullion and one horizontal muntin: four lites is enough
      // to say sash without drawing a glazing catalogue.
      panels.push(box(0, 0, s, h, t))
      panels.push(box(0, 0, w, s, t))
      // The sill, sunk a hair into the apron so the two never share a face.
      panels.push(box(0, -(h - 0.035) / 2 - 0.002, w + 0.08, 0.035, WALL + 0.06))
    } else if (opening.kind === 'door') {
      const a = ARCHITRAVE
      const t = WALL + 0.024
      // Two legs stopped under a head that crosses the whole width. Each laps
      // its neighbour rather than butting it flush — see `LAP`.
      panels.push(box(-(w + a - LAP) / 2, -LAP / 2, a + LAP, h - LAP, t))
      panels.push(box((w + a - LAP) / 2, -LAP / 2, a + LAP, h - LAP, t))
      panels.push(box(0, (h + a - LAP) / 2, w + 2 * a, a + LAP, t))
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
  // See the note where the slabs render: sub-millimetre, downward only.
  const slabBias = useMemo(() => {
    let sum = 0
    for (let i = 0; i < room.id.length; i++) sum = (sum + room.id.charCodeAt(i)) % 7
    return -sum * 0.0004
  }, [room.id])
  const timber = useMemo(() => [...timberOf(room), ...trimOf(room)], [room])
  const skirting = useMemo(
    () => (room.outdoor ? [] : walls.map((wall) => skirtingFor(room, wall))),
    [room, walls],
  )

  return (
    <group>
      {slabs.map((slab, i) => (
        // Flush-abutted rooms extend coplanar slabs under the shared doorway
        // (the porch against the cabin), and the two faces fight for pixels in
        // the threshold. A hair of per-room bias, deterministic off the id and
        // far below anything a foot or an eye can measure, settles the fight.
        <FloorSlab key={`floor-${i}`} slab={slab} texture={floorTexture} bias={slabBias} />
      ))}

      {room.ceiling && ceilingTexture && (
        <mesh position={[cx, room.elevation + room.height, cz]} rotation-x={Math.PI / 2} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial map={ceilingTexture} roughness={0.92} />
        </mesh>
      )}
      {/* Marked, so the raycast that looks for somewhere to pin a page can tell
          a wall from the floor and the rafters it is merged alongside. Plaster
          is the only surface in the building anybody sticks anything to. */}
      <Shell
        panels={panels}
        color={MATERIALS.wall}
        map={wallWashTexture()}
        userData={{ wall: room.id }}
      />
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

      <WindowGlow room={room} panes={panes} />
    </group>
  )
}

/**
 * Lamplight in the glass after dark.
 *
 * At night a lit room's windows should be the warmest thing on the hillside —
 * the view of the cabin from across the lake is the whole reward for walking
 * there. One additive wash over the room's panes, merged to a single draw
 * call; its strength follows the ambience blend and whether any lamp in the
 * room is actually on, read per frame rather than subscribed, so switching a
 * lamp off fades the windows with it.
 */
function WindowGlow({ room, panes }: { room: RoomSpec; panes: readonly Panel[] }) {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)

  // The panes, inflated a little past the glass so the glow sits over both
  // faces and spills a touch onto the reveal.
  const geometry = useMemo(
    () =>
      merge(
        panes.map((pane) => ({
          position: pane.position,
          size: [pane.size[0] + 0.02, pane.size[1] + 0.01, pane.size[2] + 0.02] as [
            number,
            number,
            number,
          ],
        })),
      ),
    [panes],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])

  const world = useWorldStore((s) => s.world)
  const lampIds = useMemo(
    () => world?.lights.filter((lamp) => lamp.roomId === room.id) ?? [],
    [world, room.id],
  )

  useFrame(() => {
    const paint = material.current
    const node = mesh.current
    if (!paint || !node) return
    const ambience = useAmbienceStore.getState()
    const lit = lampIds.some((lamp) => ambience.isOn(lamp.id, lamp.defaultOn))
    // A dark room's glass still catches a trace of moonlit sky; a lit one glows.
    const strength = ambienceBlend.night * (1 - ambienceBlend.rain * 0.3) * (lit ? 0.3 : 0.05)
    paint.opacity = strength
    node.visible = strength > 0.01
  })

  if (!geometry) return null
  return (
    <mesh ref={mesh} geometry={geometry} visible={false}>
      <meshBasicMaterial
        ref={material}
        color="#ffd9a0"
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/** Every room in the world document. */
export function Rooms() {
  const world = useWorldStore((s) => s.world)
  const group = useRef<THREE.Group>(null)

  // Published whole rather than as a group of just the wall meshes: the shells
  // are merged per room and per material, so pulling the walls into a group of
  // their own would mean a second traversal of the same geometry. The raycast
  // filters on `userData.wall` instead — see `Interaction`.
  useLayoutEffect(() => {
    sceneRefs.walls = group.current
    return () => {
      sceneRefs.walls = null
    }
  }, [world])

  if (!world) return null
  return (
    <group ref={group}>
      {world.rooms.map((room) => (
        <Room key={room.id} room={room} />
      ))}
    </group>
  )
}
