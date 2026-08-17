import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { approach } from '../lib/ease'
import { hashId } from '../data/dimensions'
import { FIRST_ASSIGNABLE, makeBookAtlas } from './spineAtlas'
import { makeBookGeometry, makeBookMaterial } from './bookMaterial'
import { useAppStore } from '../state/store'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'

/**
 * The tapes in the crate beside the television, printed through the books' atlas
 * machinery — which is not a shortcut: a cassette is a thin box with a printed
 * spine and a label on one face, exactly what `spineAtlas` draws. Its own small
 * grid, though; see the atlas below.
 *
 * Arranged like the records, for the same reason: a tape's place in the crate is
 * not worth storing, so each crate takes a slice of `video/` in folder order.
 */

/** A VHS cassette, a shade over life size like everything else in here. */
const THICKNESS = 0.031
const HEIGHT = 0.234
const DEPTH = 0.129
const GAP = 0.004
/** How far the tapes stand off the bottom of the crate. */
const FLOOR = 0.04
/** Leaned back, so the spine tips towards somebody standing over the crate. */
const LEAN = -0.14
const LEAN_AXIS = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)

/** Cassette plastics: black, and four other things that are nearly black. */
const SHELLS = ['#26262a', '#1e1f21', '#2c2724', '#22262b', '#2a2426']

type Filed = {
  id: string
  crate: string
  x: number
  y: number
  z: number
  rotationY: number
  title: string
  series: string | null
  colour: string
}

export function Tapes() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const tapes = useVideoStore((s) => s.tapes)
  // Subscribed rather than peeked: a tape in the machine or in your hand is out
  // of the crate, and the instances must follow the moment either changes.
  const playing = useVideoStore((s) => s.playing)
  const heldTape = useAppStore((s) => s.heldTape)

  const filed = useMemo<Filed[]>(() => {
    if (!world || tapes.length === 0) return []
    const crates = world.furniture.filter((item) => item.kind === 'tapecrate')
    if (crates.length === 0) return []

    const out: Filed[] = []
    let cursor = 0

    for (const crate of crates) {
      // Filling along the crate's width, spine out, exactly like a shelf of
      // books — which is how tapes stand in a box of tapes.
      const usable = crate.width - 0.05
      const slots = Math.max(1, Math.floor(usable / (THICKNESS + GAP)))
      const cos = Math.cos(crate.rotationY)
      const sin = Math.sin(crate.rotationY)

      for (let slot = 0; slot < slots && cursor < tapes.length; slot++, cursor++) {
        const tape = tapes[cursor]!
        const localX = -usable / 2 + (slot + 0.5) * (THICKNESS + GAP)
        const hash = hashId(tape.id)

        out.push({
          id: tape.id,
          crate: crate.id,
          x: crate.x + localX * cos,
          y: crate.y + FLOOR + HEIGHT / 2,
          z: crate.z - localX * sin,
          rotationY: crate.rotationY,
          title: tape.title,
          series: tape.series,
          colour: SHELLS[hash % SHELLS.length]!,
        })
      }
    }

    return out
  }, [world, tapes])

  // Rounded up to a block, so the mesh is not rebuilt for every tape moved.
  const blocks = Math.ceil((filed.length + 4) / 16)
  const capacity = useMemo(() => Math.max(16, blocks * 16), [blocks])

  /**
   * A dozen tapes gets a sixteen-cell atlas rather than the shelves'
   * eighty-eight: same drawing, a sixteenth of the texture the frame pays for.
   */
  const atlas = useMemo(() => makeBookAtlas({ columns: 4, rows: 4 }), [])
  const geometry = useMemo(() => makeBookGeometry(), [])
  const material = useMemo(() => makeBookMaterial(atlas), [atlas])
  useEffect(
    () => () => {
      atlas.dispose()
      geometry.dispose()
      material.dispose()
    },
    [atlas, geometry, material],
  )

  /** How far each tape is drawn up out of the crate, 0 to 1. */
  const lift = useRef<Float32Array>(new Float32Array(0))
  const liftOwner = useRef<unknown>(null)

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      lean: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const item = filed[i]
    const { matrix, position, quaternion, lean, scale, colour, hidden } = scratch
    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    const away =
      useVideoStore.getState().playing === item.id ||
      useAppStore.getState().heldTape === item.id

    position.set(item.x, item.y + amount * 0.06, item.z)
    quaternion.setFromAxisAngle(UP, item.rotationY)
    quaternion.multiply(lean.setFromAxisAngle(LEAN_AXIS, LEAN))
    scale.set(THICKNESS, HEIGHT, DEPTH)
    matrix.compose(position, quaternion, away ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    // The printed cell carries the shell colour, so the instance stays white or
    // the label is tinted twice. The focused tape lifts and brightens.
    colour.setScalar(1 + amount * 0.3)
    mesh.setColorAt(i, colour)
  }

  // No cell recycling: a crate holds a dozen or two and the grid fifteen, so
  // anything past it stays plain plastic rather than stealing a visible cell.
  useLayoutEffect(() => {
    let rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute | undefined
    if (!rects || rects.count !== capacity) {
      rects = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
      geometry.setAttribute('aUvRect', rects)
    }
    const uvRect = rects.array as Float32Array
    for (let i = 0; i < capacity; i++) {
      const item = filed[i]
      const slot = item && i < atlas.assignable ? FIRST_ASSIGNABLE + i : null
      if (item && slot !== null) {
        atlas.draw(slot, {
          title: item.title,
          author: item.series,
          colour: item.colour,
          // A cassette spine is narrower than any book's, so the atlas would
          // shrink the title to nothing. Told it is thicker, it stays readable.
          thickness: 0.024,
          cover: null,
        })
      }
      const rect = slot !== null ? atlas.rect(slot) : atlas.blank
      uvRect.set(rect, i * 4)
    }
    atlas.commit()
    rects.needsUpdate = true
  }, [capacity, filed, atlas, geometry])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    if (lift.current.length !== capacity || liftOwner.current !== filed) {
      lift.current = new Float32Array(capacity)
      liftOwner.current = filed
    }
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.tapes = mesh
    sceneRefs.tapeIds = filed.map((item) => item.id)
    sceneRefs.tapeCrates = filed.map((item) => item.crate)
    return () => {
      sceneRefs.tapes = null
      sceneRefs.tapeIds = []
      sceneRefs.tapeCrates = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, filed, playing, heldTape])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || filed.length === 0) return
    const focused = useAppStore.getState().focusedTape
    const rate = approach(10, delta)
    let dirty = false

    for (let i = 0; i < filed.length; i++) {
      const want = filed[i]!.id === focused ? 1 : 0
      const current = lift.current[i] ?? 0
      if (Math.abs(want - current) < 0.001) {
        if (current !== want) {
          lift.current[i] = want
          write(mesh, i)
          dirty = true
        }
        continue
      }
      lift.current[i] = current + (want - current) * rate
      write(mesh, i)
      dirty = true
    }

    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    // Receives but does not cast, like the shelved books: inside a crate there
    // is nothing for the shadow to fall on, and a caster still costs the pass.
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      receiveShadow
    />
  )
}
