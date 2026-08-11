import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHand } from './hand'
import { sceneRefs } from './refs'
import { drawing, endStroke, extendStroke, startStroke } from './board'
import { inkAt } from '../data/inks'
import { useLibraryStore } from '../state/library'
import { roomHasKeyboard, useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * Writing on a whiteboard, and the marker in hand while you do it.
 *
 * Hold the left mouse button and the line follows the crosshair. Its own file
 * rather than `Player.tsx` because it is the one input that is continuous
 * rather than a one-shot verb.
 */

/** How far the crosshair reaches to write, in metres. */
const REACH = 2.6

export function Drawing() {
  const camera = useThree((s) => s.camera)
  const held = useAppStore((s) => s.heldMarker)
  const ink = useAppStore((s) => s.markerInk)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const centre = useMemo(() => new THREE.Vector2(0, 0), [])
  const local = useMemo(() => new THREE.Vector3(), [])
  const down = useRef(false)
  const group = useRef<THREE.Group>(null)
  const hand = useMemo(makeHand, [])

  /** Write the finished line into the layout: one entry, one debounced save. */
  const commit = () => {
    const done = endStroke()
    if (done) useLibraryStore.getState().drawOn(done.boardId, done.stroke)
  }

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button === 0) down.current = true
    }
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return
      down.current = false
      commit()
    }
    // Losing the window mid-stroke would leave the button stuck down.
    const onBlur = () => {
      if (!down.current) return
      down.current = false
      commit()
    }

    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Putting the marker away mid-stroke keeps the line rather than losing it.
  useEffect(() => {
    if (held !== null) return
    down.current = false
    commit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held])

  useFrame((_, delta) => {
    const node = group.current
    if (node) {
      const { quaternion, forward, right, up } = hand.follow(camera, delta)
      node.position
        .copy(camera.position)
        .addScaledVector(forward, 0.42)
        .addScaledVector(right, 0.2)
        .addScaledVector(up, down.current ? -0.14 : -0.2)
      node.quaternion.copy(quaternion)
      node.rotateY(-0.7)
      node.rotateZ(-0.5)
    }

    if (held === null || !down.current) return
    const app = useAppStore.getState()
    if (app.mode !== 'walk' || !roomHasKeyboard()) return

    const boards = sceneRefs.boards
    if (!boards) return
    raycaster.setFromCamera(centre, camera)
    raycaster.far = REACH
    const hit = raycaster.intersectObject(boards, true)[0]
    if (!hit) return

    // The piece's group carries the id and the transform, so one inverse turns
    // a world hit into board space — u across, v up — on any wall in any room.
    let piece: THREE.Object3D | null = hit.object
    while (piece && piece.userData.furnitureId === undefined) piece = piece.parent
    const boardId = piece?.userData.furnitureId as string | undefined
    if (!piece || !boardId) return

    const board = useWorldStore.getState().world?.furniture.find((item) => item.id === boardId)
    if (!board) return

    piece.worldToLocal(local.copy(hit.point))
    const u = local.x / board.width + 0.5
    const v = local.y / board.height + 0.5
    if (u < 0 || u > 1 || v < 0 || v > 1) return

    // Crossing to another board finishes the line rather than spanning the gap.
    if (drawing.boardId === boardId) extendStroke(u, v)
    else {
      commit()
      startStroke(boardId, ink, u, v)
    }
  })

  if (held === null) return null

  return (
    <group ref={group}>
      <mesh castShadow>
        <cylinderGeometry args={[0.011, 0.011, 0.1, 10]} />
        <meshStandardMaterial color={inkAt(ink)} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.062, 0]} castShadow>
        <cylinderGeometry args={[0.013, 0.013, 0.04, 10]} />
        <meshStandardMaterial color="#2a2724" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.062, 0]}>
        <coneGeometry args={[0.009, 0.03, 8]} />
        <meshStandardMaterial color="#efeae0" roughness={0.9} />
      </mesh>
    </group>
  )
}
