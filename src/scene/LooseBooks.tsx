import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { shove, stepBody, supportFrom, type Body } from './drop'
import { peekPage, pageTexture, releaseBook } from '../state/pages'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'
import { PLAYER_RADIUS, player } from '../state/player'
import type { LoosePlacement } from '../services/types'

/**
 * Books that are neither shelved nor boxed: put down on a table, or dropped on
 * the floor.
 *
 * The simulation lives here rather than in the store because it runs per frame
 * and a book settling must not re-render React thirty times a second; the store
 * is told once, when it comes to rest. That is also why the saved placement is
 * where a book *stopped*, not where it was let go of — reloading the library
 * should not replay a drop.
 */

/** How close you have to be to kick one out of the way. */
const KICK_RADIUS = PLAYER_RADIUS + 0.12
const HIGHLIGHT = new THREE.Color('#e6d3a6')
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** A book left open, drawn as a spread rather than as a closed block. */
function OpenBook({ id, at }: { id: string; at: LoosePlacement }) {
  const size = useLibraryStore((s) => s.dims.get(id))
  const [, redraw] = useState(0)

  // Leaf `spread` shows pages 2s and 2s+1, exactly as the reader numbers them.
  const left = 2 * at.spread
  const right = 2 * at.spread + 1

  useEffect(() => {
    let cancelled = false
    void Promise.all([pageTexture(id, left), pageTexture(id, right)]).then(() => {
      if (!cancelled) redraw((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [id, left, right])

  // The pages are only worth keeping while the book is still lying open.
  useEffect(() => () => releaseBook(id), [id])

  if (!size) return null
  const page = size.depth
  const height = size.height
  const board = size.thickness / 2

  const faces = [
    { map: peekPage(id, left), x: -page / 2 },
    { map: peekPage(id, right), x: page / 2 },
  ]

  return (
    <group position={[at.x, at.y, at.z]} rotation-y={at.yaw} userData={{ bookId: id }}>
      {/* The two halves of the block, laid flat and open. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * page) / 2, board / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[page, board, height]} />
          <meshStandardMaterial color={size.colour} roughness={0.7} />
        </mesh>
      ))}
      {faces.map((face, i) => (
        <mesh key={i} position={[face.x, board + 0.0015, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[page * 0.96, height * 0.96]} />
          {face.map ? (
            <meshStandardMaterial map={face.map} roughness={0.95} />
          ) : (
            <meshStandardMaterial color="#efe8d8" roughness={1} />
          )}
        </mesh>
      ))}
    </group>
  )
}

export function LooseBooks() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const openGroup = useRef<THREE.Group>(null)
  const world = useWorldStore((s) => s.world)
  const loose = useLibraryStore((s) => s.loose)
  const dims = useLibraryStore((s) => s.dims)
  const held = useAppStore((s) => s.held)

  /** Closed books go in the instanced mesh; open ones are their own group. */
  const closed = useMemo(
    () => Object.entries(loose).filter(([id, at]) => !at.open && dims.has(id)),
    [loose, dims],
  )
  const opened = useMemo(
    () => Object.entries(loose).filter(([, at]) => at.open),
    [loose],
  )

  const capacity = useMemo(
    () => Math.max(32, Math.ceil((closed.length + 16) / 32) * 32),
    // Only the bucket matters; growing the mesh for every book put down would
    // rebuild it constantly.
    [Math.ceil((closed.length + 16) / 32)],
  )

  /**
   * The live simulation, keyed by book id.
   *
   * Seeded from the saved placement — which is always a resting one — so a book
   * that was on the table at shutdown is on the table at startup rather than
   * falling onto it again.
   */
  const bodies = useRef(new Map<string, Body>())
  const support = useMemo(() => (world ? supportFrom(world) : null), [world])

  /**
   * Bring the simulation in line with the saved placements.
   *
   * Called from the layout effect *before* the instance matrices are written,
   * not from an effect of its own. A book put straight down on a table is
   * seeded at rest, and a body at rest is never touched again by the frame
   * loop — so if its matrix has not been written by the time it settles into
   * being ignored, it is simply never drawn.
   */
  const reseed = () => {
    const live = bodies.current
    for (const [id, at] of closed) {
      const existing = live.get(id)
      // A placement that moved under us — a reload, or a book put down
      // somewhere else — wins over whatever the simulation thought.
      if (!existing || Math.hypot(existing.x - at.x, existing.z - at.z) > 0.5) {
        live.set(id, { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, yaw: at.yaw, spin: 0, resting: true })
      }
    }
    for (const id of [...live.keys()]) {
      if (!closed.some(([other]) => other === id)) live.delete(id)
    }
  }

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const entry = closed[i]
    const { matrix, position, quaternion, scale, colour, hidden } = scratch
    if (!entry) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const [id] = entry
    const size = dims.get(id)!
    const body = bodies.current.get(id)
    if (!body) return

    position.set(body.x, body.y, body.z)
    quaternion.setFromAxisAngle(Y_AXIS, body.yaw)
    // Lying flat: cover up, spine along Z, thickness the short axis.
    scale.set(size.depth, size.thickness, size.height)
    matrix.compose(position, quaternion, held === id ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    colour.set(size.colour)
    if (useAppStore.getState().focusedBook === id) colour.lerp(HIGHLIGHT, 0.45)
    mesh.setColorAt(i, colour)
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    reseed()
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.looseBooks = mesh
    sceneRefs.looseIds = closed.map(([id]) => id)
    sceneRefs.openBooks = openGroup.current
    return () => {
      sceneRefs.looseBooks = null
      sceneRefs.looseIds = []
      sceneRefs.openBooks = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, closed, held, dims])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || !support || closed.length === 0) return

    const nudge = useLibraryStore.getState().nudge
    let dirty = false

    for (let i = 0; i < closed.length; i++) {
      const [id] = closed[i]!
      const size = dims.get(id)
      const body = bodies.current.get(id)
      if (!size || !body) continue

      // Kick it out of the way if you are standing on it. Only ever done to a
      // book at rest: one already in flight has somewhere it is going.
      let current = body
      if (current.resting && held !== id) {
        const feet = Math.abs(current.y - player.floor)
        if (feet < 0.5) current = shove(current, player, KICK_RADIUS, player.speed)
      }

      const wasResting = current.resting
      current = stepBody(current, size.thickness, delta, support)
      bodies.current.set(id, current)

      if (!wasResting || current !== body) {
        write(mesh, i)
        dirty = true
      }
      // Write down where it stopped, once, rather than every frame of the fall.
      if (!wasResting && current.resting) {
        nudge(id, { x: current.x, y: current.y, z: current.z, yaw: current.yaw, open: false, spread: 0 })
      }
    }

    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh
        key={capacity}
        ref={meshRef}
        args={[undefined, undefined, capacity]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.72} metalness={0} />
      </instancedMesh>

      {/* Open books are their own meshes rather than instances, so they get
          their own group for the crosshair to find them in. */}
      <group ref={openGroup}>
        {opened.map(([id, at]) => (
          <OpenBook key={id} id={id} at={at} />
        ))}
      </group>
    </group>
  )
}
