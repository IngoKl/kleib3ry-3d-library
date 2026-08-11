import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { makeBookGeometry, makeBookMaterial } from './bookMaterial'
import { ASSIGNABLE_SLOTS, FIRST_ASSIGNABLE, makeBookAtlas } from './spineAtlas'
import { packBoxes } from '../world/boxes'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'
import { coverImageFor, onCoverReady, peekCoverColour, peekCoverImage } from '../state/covers'

/**
 * The books in the moving boxes: everything not yet unpacked, plus whatever an
 * edit displaced. Pointable and takeable, exactly like a shelved book, because
 * putting them away is the whole point of them being visible.
 *
 * They lie in a stack with their **covers up and their spines out**, printed
 * from the same atlas the shelves use — a box of anonymous coloured slabs is
 * something you can only rummage in, and finding the book you want is the thing
 * you are doing here. A box holds more than it can show, so what you see is the
 * top of the pile; browsing moves that slice down through the rest.
 */
const HIGHLIGHT = new THREE.Color('#e6d3a6')
const WHITE = new THREE.Color('#ffffff')
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
/** How far a focused book lifts out of the pile. */
const LIFT = 0.03
/**
 * Laid on its side: the front board turns to face the ceiling and the printed
 * spine ends up along the edge of the stack, which is how a pile of books in a
 * box actually reads.
 */
const LAID_FLAT = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2)

export function BoxedBooks() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const boxes = useLibraryStore((s) => s.boxes)
  const dims = useLibraryStore((s) => s.dims)
  const byId = useLibraryStore((s) => s.byId)
  const held = useAppStore((s) => s.held)
  const offsets = useAppStore((s) => s.boxOffsets)
  const setBoxViews = useAppStore((s) => s.setBoxViews)

  const packing = useMemo(
    () => (world ? packBoxes(world, boxes, (id) => dims.get(id), offsets) : null),
    [world, boxes, dims, offsets],
  )
  const placed = packing?.placed ?? []

  const atlas = useMemo(() => makeBookAtlas(), [])
  useEffect(() => () => atlas.dispose(), [atlas])

  // Rounded up in chunks so the value (and the remount it forces) only changes
  // when a pile actually outgrows it — a memo keyed on emptiness froze this at
  // the first non-empty size and hid every book past it.
  const capacity = Math.max(32, Math.ceil((placed.length + 32) / 64) * 64)

  const geometry = useMemo(() => {
    const base = makeBookGeometry()
    base.setAttribute(
      'aUvRect',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
    )
    return base
  }, [capacity])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => makeBookMaterial(atlas), [atlas])
  useEffect(() => () => material.dispose(), [material])

  const lift = useRef<Float32Array>(new Float32Array(0))
  /** Which atlas cell each instance got, or -1 for none. */
  const slotOf = useRef<Int16Array>(new Int16Array(0))

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
    const item = placed[i]
    const { matrix, position, quaternion, scale, colour, hidden } = scratch

    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    position.set(item.x, item.y + amount * LIFT, item.z)
    quaternion.setFromAxisAngle(Y_AXIS, item.rotationY).multiply(LAID_FLAT)
    scale.set(item.size[0], item.size[1], item.size[2])
    matrix.compose(position, quaternion, held === item.id ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    // A printed cell already carries the cloth colour, so a printed instance
    // has to be white or the artwork would be tinted twice.
    const printed = (slotOf.current[i] ?? -1) >= 0
    colour.copy(printed ? WHITE : new THREE.Color(item.colour))
    if (amount > 0.001) colour.lerp(HIGHLIGHT, amount * 0.5)
    mesh.setColorAt(i, colour)
  }

  /**
   * Print every book on show, up to the atlas.
   *
   * No distance culling and no recycling, unlike the shelves: what a box shows
   * is a hundred books at most and only changes when you browse or move one, so
   * the whole visible pile fits the atlas at once and is redrawn when it
   * changes rather than on a per-frame budget.
   */
  const print = () => {
    const mesh = meshRef.current
    if (!mesh) return
    const rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute

    slotOf.current = new Int16Array(capacity).fill(-1)
    let cell = 0
    for (let i = 0; i < capacity; i++) {
      const item = placed[i]
      if (!item || cell >= ASSIGNABLE_SLOTS) {
        const blank = atlas.blank
        rects.setXYZW(i, blank[0], blank[1], blank[2], blank[3])
        continue
      }

      const book = byId.get(item.id)
      atlas.draw(cell + FIRST_ASSIGNABLE, {
        title: book?.title ?? '',
        author: book?.author ?? null,
        colour: peekCoverColour(item.id) ?? item.colour,
        thickness: item.size[0],
        cover: peekCoverImage(item.id) ?? null,
      })
      // Ask for the artwork the first time a book surfaces in a box. Covers up
      // is only worth anything if the covers actually arrive.
      if (book) coverImageFor(book)
      const rect = atlas.rect(cell + FIRST_ASSIGNABLE)
      rects.setXYZW(i, rect[0], rect[1], rect[2], rect[3])
      slotOf.current[i] = cell
      cell += 1
    }

    atlas.commit()
    rects.needsUpdate = true
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    lift.current = new Float32Array(capacity)
    print()
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.boxedBooks = mesh
    sceneRefs.boxedIds = placed.map((item) => item.id)
    sceneRefs.boxedOwners = placed.map((item) => item.boxId)
    return () => {
      sceneRefs.boxedBooks = null
      sceneRefs.boxedIds = []
      sceneRefs.boxedOwners = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, placed])

  // Picking a book up (or putting one back) only hides or shows its instance;
  // repainting the whole box atlas for that was a ~15 MB texture re-upload and
  // a visible hitch on every grab.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held])

  // What each box is showing, for the panel and for browsing.
  useLayoutEffect(() => {
    if (packing) setBoxViews(packing.views)
  }, [packing, setBoxViews])

  // A cover that finishes loading changes both the board and the binding, so
  // whatever is on show has to be drawn again.
  useEffect(() => {
    const listener = () => print()
    onCoverReady.add(listener)
    return () => {
      onCoverReady.delete(listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, capacity, geometry, atlas])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || placed.length === 0) return
    const focused = useAppStore.getState().focusedBook
    const rate = Math.min(1, delta * 10)
    let dirty = false

    for (let i = 0; i < placed.length; i++) {
      const want = placed[i]!.id === focused ? 1 : 0
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
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      castShadow
      receiveShadow
    />
  )
}
