import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { approach } from '../lib/ease'
import { useShelfTransforms } from './transforms'
import { ASSIGNABLE_SLOTS, FIRST_ASSIGNABLE, makeBookAtlas } from './spineAtlas'
import { makeBookGeometry, makeBookMaterial } from './bookMaterial'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { coverImageFor, onCoverReady, peekCoverColour, peekCoverImage } from '../state/covers'

/**
 * How far a focused book slides out, and how far it then turns.
 *
 * A book on a shelf stands spine-out, so its cover is against its neighbour and
 * cannot be seen at all. Looking at one therefore draws it out far enough to
 * clear the books either side and turns it to present its front board — which
 * is the only way a cover is visible on a shelf without laying the whole
 * library out face-first.
 */
const PULL = 0.085
/** Far enough that a book has cleared its neighbours before it starts turning. */
const DRAW_OUT = 0.2
const PRESENT_ANGLE = Math.PI * 0.46
const HIGHLIGHT = new THREE.Color('#e6d3a6')
const WHITE = new THREE.Color('#ffffff')

const Z_AXIS = new THREE.Vector3(0, 0, 1)

/** Beyond this a printed spine is smaller than a few pixels; do not spend a cell. */
const PRINT_RANGE = 4.2
/** Reassign cells this often, in frames. */
const REPRINT_EVERY = 6
/**
 * At most this many cells are drawn per pass. Turning on the spot can invalidate
 * every cell at once, and printing 255 spines in one frame is a visible hitch —
 * spreading it over a few passes fills the shelf in over a fifth of a second,
 * which reads as the room resolving rather than as a stall.
 */
const REPRINTS_PER_PASS = 24

export function Books() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const camera = useThree((s) => s.camera)
  const packed = useLibraryStore((s) => s.packed)
  const dims = useLibraryStore((s) => s.dims)
  const byId = useLibraryStore((s) => s.byId)
  const transforms = useShelfTransforms()

  const atlas = useMemo(() => makeBookAtlas(), [])
  useEffect(() => () => atlas.dispose(), [atlas])

  // Instance capacity has to be fixed at construction, so allocate headroom and
  // hide the unused tail rather than rebuilding the mesh whenever a book moves.
  // Plain arithmetic, no memo: the rounding is what keeps the value (and so the
  // remount) stable. A memo keyed on emptiness froze the capacity at the first
  // non-empty size, and every book past it was silently invisible.
  const capacity = Math.max(64, Math.ceil((packed.length + 64) / 256) * 256)

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

  const resolved = useMemo(
    () =>
      packed.flatMap((book) => {
        const shelf = transforms[book.shelf]
        const size = dims.get(book.id)
        // A world reload can land a frame before the layout rebuild does; drop
        // rather than throw on a shelf that has just stopped existing.
        if (!shelf || !size) return []
        return [
          {
            id: book.id,
            position: new THREE.Vector3(book.localX, book.localY, book.localZ).applyMatrix4(
              shelf.matrix,
            ),
            quaternion: shelf.quaternion
              .clone()
              .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, book.lean)),
            scale: new THREE.Vector3(size.thickness, size.height, size.depth),
            outward: shelf.outward,
            colour: new THREE.Color(size.colour),
            thickness: size.thickness,
            depth: size.depth,
          },
        ]
      }),
    [packed, dims, transforms],
  )

  const pull = useRef<Float32Array>(new Float32Array(0))
  /** How far each book is drawn out to show its cover, 0 to 1. */
  const show_ = useRef<Float32Array>(new Float32Array(0))
  /** Which atlas cell each instance is using, or -1 for the blank one. */
  const slotOf = useRef<Int16Array>(new Int16Array(0))
  /** Which book currently owns each cell, so a redraw only happens on a change. */
  const cellOwner = useRef<string[]>([])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      turn: new THREE.Quaternion(),
      axis: new THREE.Vector3(0, 1, 0),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const item = resolved[i]
    const { matrix, position, colour, hidden } = scratch

    if (!item) {
      matrix.compose(scratch.position.set(0, -100, 0), new THREE.Quaternion(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const held = useAppStore.getState().held === item.id
    const amount = pull.current[i] ?? 0
    const show = show_.current[i] ?? 0

    // A glance slides a book out a little; drawing it out takes it fully clear
    // of the shelf and only then turns it, so even a thin book cannot sweep
    // through its neighbours on the way round.
    position
      .copy(item.position)
      .addScaledVector(item.outward, amount * PULL + show * (DRAW_OUT + item.depth / 2))

    const turned = Math.max(0, (show - 0.45) / 0.55)
    scratch.quaternion.copy(item.quaternion)
    if (turned > 0.001) {
      scratch.turn.setFromAxisAngle(scratch.axis, -PRESENT_ANGLE * turned)
      scratch.quaternion.multiply(scratch.turn)
    }

    matrix.compose(position, scratch.quaternion, held ? hidden : item.scale)
    mesh.setMatrixAt(i, matrix)

    // A printed cell already carries the cloth colour, so the instance colour
    // has to be white or it would tint the artwork twice.
    const printed = (slotOf.current[i] ?? -1) >= 0
    colour.copy(printed ? WHITE : item.colour)
    if (amount > 0.001) colour.lerp(HIGHLIGHT, amount * 0.4)
    mesh.setColorAt(i, colour)
  }

  const rewriteAll = () => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }

  useLayoutEffect(() => {
    pull.current = new Float32Array(capacity)
    show_.current = new Float32Array(capacity)
    slotOf.current = new Int16Array(capacity).fill(-1)
    cellOwner.current = new Array(ASSIGNABLE_SLOTS).fill('')

    // Everything starts on the blank cell, which is plain white, so an unprinted
    // book looks exactly as it did before any of this.
    const rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute
    const blank = atlas.blank
    for (let i = 0; i < capacity; i++) rects.setXYZW(i, blank[0], blank[1], blank[2], blank[3])
    rects.needsUpdate = true

    sceneRefs.books = meshRef.current
    // Instance i is resolved[i], which is not packed[i] when a shelf has just
    // vanished from under a book, so the raycaster needs the mapping.
    sceneRefs.bookIds = resolved.map((item) => item.id)
    rewriteAll()
    return () => {
      sceneRefs.books = null
      sceneRefs.bookIds = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, resolved, geometry, atlas])

  const held = useAppStore((s) => s.held)
  useEffect(rewriteAll, [held]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A cover that has finished loading changes both the front board and the
   * colour of the binding, so the cell has to be drawn again.
   *
   * Only if the book *has* a cell. Covers are warmed for the whole library in
   * the background now, which means artwork arrives for books nowhere near you
   * — and giving up a cell for one of those would mean the atlas churning
   * quietly for minutes while you stand still. A book with no cell will be
   * drawn with its cover the first time it earns one.
   */
  useEffect(() => {
    const listener = (id: string) => {
      if (cellOwner.current.includes(id)) sceneRefs.spineDirty.add(id)
    }
    onCoverReady.add(listener)
    return () => {
      onCoverReady.delete(listener)
    }
  }, [])

  /**
   * Hand out atlas cells to whatever is close enough to read, nearest first.
   *
   * Books that keep their cell are left alone, so standing still costs nothing
   * and walking costs only the cells that actually changed hands.
   */
  const frame = useRef(0)
  const reprint = () => {
    const mesh = meshRef.current
    if (!mesh) return
    const rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute
    const camPos = camera.position

    // A cover that has arrived since this book was printed changes its colour,
    // so give up its cell and let it be drawn again below.
    if (sceneRefs.spineDirty.size > 0) {
      for (let cell = 0; cell < ASSIGNABLE_SLOTS; cell++) {
        if (sceneRefs.spineDirty.has(cellOwner.current[cell]!)) cellOwner.current[cell] = ''
      }
      sceneRefs.spineDirty.clear()
    }

    const near: { index: number; distance: number }[] = []
    for (let i = 0; i < resolved.length; i++) {
      const distance = resolved[i]!.position.distanceTo(camPos)
      if (distance <= PRINT_RANGE) near.push({ index: i, distance })
    }
    near.sort((a, b) => a.distance - b.distance)
    const wanted = near.slice(0, ASSIGNABLE_SLOTS)

    const keep = new Set(wanted.map((entry) => resolved[entry.index]!.id))
    const free: number[] = []
    for (let cell = 0; cell < ASSIGNABLE_SLOTS; cell++) {
      const owner = cellOwner.current[cell]!
      if (owner === '' || !keep.has(owner)) {
        if (owner !== '') cellOwner.current[cell] = ''
        free.push(cell)
      }
    }

    const owned = new Map<string, number>()
    for (let cell = 0; cell < ASSIGNABLE_SLOTS; cell++) {
      const owner = cellOwner.current[cell]!
      if (owner !== '') owned.set(owner, cell)
    }

    let dirty = false
    let drawn = 0
    const assigned = new Set<number>()

    for (const entry of wanted) {
      const item = resolved[entry.index]!
      let cell = owned.get(item.id)
      if (cell === undefined) {
        if (drawn >= REPRINTS_PER_PASS) continue
        const next = free.pop()
        if (next === undefined) continue
        cell = next
        drawn += 1
        cellOwner.current[cell] = item.id
        const book = byId.get(item.id)
        atlas.draw(cell + FIRST_ASSIGNABLE, {
          title: book?.title ?? '',
          author: book?.author ?? null,
          // The book's own cover if it has been read, otherwise the stand-in
          // colour derived from its id.
          colour: peekCoverColour(item.id) ?? `#${item.colour.getHexString()}`,
          thickness: item.thickness,
          cover: peekCoverImage(item.id) ?? null,
        })
        // Ask for the artwork if this is the first time this book has been
        // close enough to matter. Rate-limited inside, because for a PDF this
        // means rasterising its first page.
        if (book) coverImageFor(book)
      }
      assigned.add(entry.index)
      if (slotOf.current[entry.index] !== cell) {
        slotOf.current[entry.index] = cell
        const r = atlas.rect(cell + FIRST_ASSIGNABLE)
        rects.setXYZW(entry.index, r[0], r[1], r[2], r[3])
        write(mesh, entry.index)
        dirty = true
      }
    }

    // Anything that lost its cell goes back to plain cloth.
    for (let i = 0; i < resolved.length; i++) {
      if (assigned.has(i) || slotOf.current[i] === -1) continue
      slotOf.current[i] = -1
      const b = atlas.blank
      rects.setXYZW(i, b[0], b[1], b[2], b[3])
      write(mesh, i)
      dirty = true
    }

    if (drawn > 0) atlas.commit()
    sceneRefs.printedSpines = assigned.size
    sceneRefs.spinesReprinted += drawn

    if (dirty) {
      rects.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    frame.current += 1
    if (frame.current % REPRINT_EVERY === 0) reprint()

    const { focusedBook: focused, drawn } = useAppStore.getState()
    const rate = approach(10, delta)
    const showRate = approach(5, delta)
    let dirty = false

    for (let i = 0; i < resolved.length; i++) {
      const id = resolved[i]!.id
      const wantPull = id === focused ? 1 : 0
      const wantShow = id === drawn ? 1 : 0
      const pulled = pull.current[i] ?? 0
      const shown = show_.current[i] ?? 0

      const movingPull = Math.abs(wantPull - pulled) >= 0.001
      const movingShow = Math.abs(wantShow - shown) >= 0.001
      if (!movingPull && !movingShow) {
        if (pulled !== wantPull || shown !== wantShow) {
          pull.current[i] = wantPull
          show_.current[i] = wantShow
          write(mesh, i)
          dirty = true
        }
        continue
      }
      if (movingPull) pull.current[i] = pulled + (wantPull - pulled) * rate
      if (movingShow) show_.current[i] = shown + (wantShow - shown) * showRate
      write(mesh, i)
      dirty = true
    }

    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    // Books receive shadow but do not cast: hundreds of casters would dominate
    // the shadow pass, and inside a compartment there is nothing to cast onto.
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      receiveShadow
    />
  )
}
