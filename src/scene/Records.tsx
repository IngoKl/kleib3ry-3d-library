import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { approach } from '../lib/ease'
import { hashId } from '../data/dimensions'
import {
  ASSIGNABLE_SLOTS,
  FIRST_ASSIGNABLE,
  makeSleeveAtlas,
  makeSleeveGeometry,
  makeSleeveMaterial,
  sleeveArtFor,
  SLEEVE_SIZE,
  SLEEVE_THICKNESS,
  type SleeveArt,
} from './recordAtlas'
import { useLibraryStore } from '../state/library'
import { useMediaStore } from '../state/media'
import { useAppStore, type CrateView } from '../state/store'
import { useWorldStore } from '../state/world'
import type { IndexedTrack } from '../services/types'
import type { DerivedFurniture } from '../world/derive'

/**
 * The records: filed in the crates, or lying wherever you left one.
 *
 * Records are *dealt* rather than arranged. Every crate takes a slice of the
 * music folder in its own order, so adding a file to `music/` puts it on the
 * shelf and nothing has to be written down for a few hundred sleeves to have
 * somewhere to be. What is written down is only what you have had an opinion
 * about: a record carried to another crate stays in that crate, and a record set
 * down on a table stays on the table. Both live in `books.json` beside the book
 * layout — see `state/library.ts` — and both are one entry rather than an
 * ordering, because unlike a shelf a crate has no order worth keeping.
 *
 * A crate is dealt *more records than it can stand up*, exactly as a moving box
 * holds more books than it can pile on top: the deal gives every record a crate,
 * and the crate stands up one crateful of them at a time. Riffling (`,` and `.`)
 * moves which crateful that is and draws one sleeve out face-on, which is the
 * only way seventy sleeves four millimetres apart are something you can read.
 *
 * One instanced mesh for the lot, filed and loose together, printed from a
 * sleeve atlas the same way the books are printed from the spine atlas.
 */

const SLEEVE = SLEEVE_SIZE
const THICKNESS = SLEEVE_THICKNESS
/** How much air is left between two filed sleeves. */
const GAP = 0.0035
const LEAN_AXIS = new THREE.Vector3(1, 0, 0)
const WHITE = new THREE.Color('#ffffff')

/**
 * A crate has a centre divider, so records file into two bays either side of
 * it rather than through it — which also stops a full crate reading as one
 * solid slab.
 */
const BAY_X = 0.215

/** How far in front of the crate the sleeve you have riffled to stands. */
const DRAW_OUT = 0.1
/** …and how far up out of it, clear of the rim. */
const DRAW_UP = 0.1
/** Tipped back, so its face turns up towards somebody stood over the crate. */
const DRAW_LEAN = -0.5

type Filed = {
  id: string
  /** The crate it is filed in, or null for one lying about the room. */
  crate: string | null
  x: number
  y: number
  z: number
  /** Where it stands when it is the one drawn out: in front of the crate. */
  outX: number
  outZ: number
  rotationY: number
  /** Radians of lean back against the crate, varied so a bay is not a slab. */
  lean: number
  /** True for a record set down on a surface: sleeve flat, face up. */
  flat: boolean
  /** How deep into its bay it stands. Decides which sleeves are worth printing. */
  depth: number
  /** True for the one sleeve the riffle has drawn out of this crate. */
  browsed: boolean
  art: SleeveArt
  /** Its own card colour, for a sleeve with no atlas cell to print from. */
  card: THREE.Color
}

/** One crate and everything dealt into it — more than it can stand up at once. */
type Crateful = {
  crate: DerivedFurniture
  records: IndexedTrack[]
  /** Sleeves per bay, so twice this is a crateful. */
  perBay: number
  /** The depth records file into, inside the crate's walls. */
  usable: number
}

export function Records() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const tracks = useMediaStore((s) => s.tracks)
  // Subscribed rather than peeked: the record on the deck and the one in your
  // hand are out of their crate, and their instances have to follow suit the
  // moment either changes — not the next time the crosshair happens to move.
  const playing = useMediaStore((s) => s.playing)
  const heldRecord = useAppStore((s) => s.heldRecord)
  const crateOffsets = useAppStore((s) => s.crateOffsets)
  const setCrateDeal = useAppStore((s) => s.setCrateDeal)
  const filedRecords = useLibraryStore((s) => s.filedRecords)
  const looseRecords = useLibraryStore((s) => s.looseRecords)

  /**
   * Deal the collection into whatever crates the room has, in document order,
   * and put the ones you have moved where you put them.
   *
   * A record you filed by hand claims its crate first; the rest fill whatever is
   * left, in folder order. That ordering matters: without it, a record filed into
   * a full crate would be pushed straight back out by the deal, and putting one
   * away would look like it had not gone in.
   *
   * Every record ends up in a crate, however many there are of them — a crate
   * takes a *share* of the collection rather than only what it can show, so
   * nothing is left with nowhere to be. Which of a crate's records are standing
   * in it is decided below, and does not change the deal.
   */
  const deal = useMemo(() => {
    const crates: Crateful[] = []
    const loose: Filed[] = []
    const dealt: Record<string, string> = {}
    if (!world || tracks.length === 0) return { crates, loose, dealt }

    const placed = new Set<string>()

    // Records lying on tables and counters. Face up, turned the way you were
    // standing, resting a hair above whatever they were set down on.
    for (const track of tracks) {
      const at = looseRecords[track.id]
      if (!at) continue
      placed.add(track.id)
      const art = sleeveArtFor(track)
      loose.push({
        id: track.id,
        crate: null,
        x: at.x,
        y: at.y,
        z: at.z,
        outX: at.x,
        outZ: at.z,
        rotationY: at.yaw,
        lean: 0,
        flat: true,
        depth: 0,
        browsed: false,
        art,
        card: new THREE.Color(art.colour),
      })
    }

    const pieces = world.furniture.filter((item) => item.kind === 'recordshelf')
    const known = new Set(pieces.map((piece) => piece.id))
    // A crate that has gone out of `library.json` cannot hold anything, so its
    // records rejoin the deal rather than disappearing.
    const wanted = (crateId: string) =>
      tracks.filter((track) => !placed.has(track.id) && filedRecords[track.id] === crateId)
    const pool = tracks.filter(
      (track) =>
        !placed.has(track.id) &&
        !(filedRecords[track.id] !== undefined && known.has(filedRecords[track.id]!)),
    )

    for (let n = 0; n < pieces.length; n++) {
      const crate = pieces[n]!
      // Records lean back against the divider, filling each bay front to back.
      const usable = crate.depth - 0.09
      const perBay = Math.max(1, Math.floor(usable / (THICKNESS + GAP)))
      // What is left over, split across the crates not yet dealt to — but never
      // less than a crateful, so a collection that fits fills the first crate
      // before it touches the next. A crate asked for by hand keeps every record
      // asked of it: filing one away must not be undone by a capacity.
      const share = Math.max(perBay * 2, Math.ceil(pool.length / (pieces.length - n)))
      const mine = wanted(crate.id)
      const records = [...mine, ...pool.splice(0, Math.max(0, share - mine.length))]
      for (const track of records) dealt[track.id] = crate.id
      crates.push({ crate, records, perBay, usable })
    }

    return { crates, loose, dealt }
  }, [world, tracks, filedRecords, looseRecords])

  /**
   * Stand a crateful up in each crate, and draw one sleeve out of it.
   *
   * The crateful on show is the *block* the riffle is in rather than a window
   * that slides a sleeve at a time: within a block nothing changes hands, so a
   * flick costs a matrix per sleeve and not a single redrawn atlas cell.
   *
   * Keyed on the offsets rather than folded into the deal above, so riffling
   * never re-deals the collection.
   */
  const packed = useMemo(() => {
    const out: Filed[] = [...deal.loose]
    const views: Record<string, CrateView> = {}

    for (const { crate, records, perBay, usable } of deal.crates) {
      const crateful = perBay * 2
      const total = records.length
      const cursor = Math.max(
        0,
        Math.min(Math.floor(crateOffsets[crate.id] ?? 0), Math.max(0, total - 1)),
      )
      const start = Math.floor(cursor / crateful) * crateful
      const shown = Math.min(crateful, Math.max(0, total - start))
      views[crate.id] = { offset: cursor, shown, total, record: records[cursor]?.id ?? null }

      const cos = Math.cos(crate.rotationY)
      const sin = Math.sin(crate.rotationY)
      const drawnZ = usable / 2 + DRAW_OUT

      for (let slot = 0; slot < shown; slot++) {
        const track = records[start + slot]!
        const art = sleeveArtFor(track)
        const bay = slot < perBay ? -1 : 1
        const localX = bay * BAY_X
        const depth = slot % perBay
        const localZ = usable / 2 - depth * (THICKNESS + GAP)
        const hash = hashId(track.id)

        out.push({
          id: track.id,
          crate: crate.id,
          x: crate.x + localX * cos + localZ * sin,
          y: crate.y + 0.08 + SLEEVE / 2,
          z: crate.z - localX * sin + localZ * cos,
          outX: crate.x + localX * cos + drawnZ * sin,
          outZ: crate.z - localX * sin + drawnZ * cos,
          rotationY: crate.rotationY,
          lean: -0.045 - (hash % 7) * 0.007,
          flat: false,
          depth,
          browsed: start + slot === cursor,
          art,
          card: new THREE.Color(art.colour),
        })
      }
    }

    return { filed: out, views }
  }, [deal, crateOffsets])

  const filed = packed.filed

  // What the crates are showing, and where the deal put every record: the HUD
  // card, the riffle and the catalogue all read it from here.
  useLayoutEffect(() => {
    setCrateDeal(packed.views, deal.dealt)
  }, [packed, deal, setCrateDeal])

  // Rounded up to a block, so the mesh is not rebuilt for every record moved.
  const blocks = Math.ceil((filed.length + 8) / 32)
  const capacity = useMemo(() => Math.max(32, blocks * 32), [blocks])

  const atlas = useMemo(() => makeSleeveAtlas(), [])
  const geometry = useMemo(() => makeSleeveGeometry(), [])
  const material = useMemo(() => makeSleeveMaterial(atlas), [atlas])
  useEffect(
    () => () => {
      atlas.dispose()
      geometry.dispose()
      material.dispose()
    },
    [atlas, geometry, material],
  )

  /** How far each sleeve is drawn up out of the crate, 0 to 1. */
  const lift = useRef<Float32Array>(new Float32Array(0))
  /** …and how far the one you have riffled to stands out in front of it, 0 to 1. */
  const drawnOut = useRef<Float32Array>(new Float32Array(0))
  /** Which atlas cell each instance prints from, or -1 for plain card. */
  const slotOf = useRef<Int16Array>(new Int16Array(0))
  /** Which record owns each cell, so a re-deal only redraws what changed hands. */
  const cellOwner = useRef<string[]>([])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      leanTurn: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const item = filed[i]
    const { matrix, position, quaternion, leanTurn, scale, colour, hidden, up } = scratch
    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    const drawn = drawnOut.current[i] ?? 0
    // A record on the deck, or in your hand, is not in the crate.
    const away =
      useMediaStore.getState().playing === item.id ||
      useAppStore.getState().heldRecord === item.id
    // The sleeve you have riffled to comes forward of the crate's front edge and
    // up clear of its rim, because the sleeves in front of it are what hide it.
    position.set(
      item.x + (item.outX - item.x) * drawn,
      item.y + amount * 0.07 + drawn * DRAW_UP,
      item.z + (item.outZ - item.z) * drawn,
    )
    quaternion.setFromAxisAngle(up, item.rotationY)
    // A filed record stands and leans back; one set down lies on its face, which
    // is the same sleeve tipped a quarter turn onto its back. Drawn out, it tips
    // further back still, which is what turns its face towards your eyes.
    const lean = item.flat ? -Math.PI / 2 : item.lean + (DRAW_LEAN - item.lean) * drawn
    quaternion.multiply(leanTurn.setFromAxisAngle(LEAN_AXIS, lean))
    scale.set(SLEEVE, SLEEVE, THICKNESS)
    matrix.compose(position, quaternion, away ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    // A printed cell already carries the artwork, so a printed instance stays
    // white and lets it through untinted; one with no cell wears plain card in
    // its own colour, which is a record rather than the blank cell's blank. The
    // focused sleeve, and the one drawn out, brighten a little — which reads as
    // the hand either is about to be in.
    const printed = (slotOf.current[i] ?? -1) >= 0
    colour.copy(printed ? WHITE : item.card).multiplyScalar(1 + Math.max(amount, drawn) * 0.22)
    mesh.setColorAt(i, colour)
  }

  /**
   * Hand out atlas cells to the sleeves whose faces can actually be read.
   *
   * The grid holds 143 and a pair of crates stands up 144, so the cells are
   * spent where they show: one lying face up on a table, the one drawn out of a
   * crate, then front to back through each bay — a sleeve four millimetres from
   * its neighbour shows an edge and nothing else. Cells are kept by record, so a
   * flick that only moves a sleeve redraws nothing and uploads nothing.
   */
  useLayoutEffect(() => {
    // Update the attribute in place when the capacity allows: a replaced
    // attribute's GPU buffer is only freed on geometry dispose, so swapping in
    // a fresh one per world edit accumulated orphaned buffers.
    let rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute | undefined
    if (!rects || rects.count !== capacity) {
      rects = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
      geometry.setAttribute('aUvRect', rects)
    }
    if (cellOwner.current.length !== ASSIGNABLE_SLOTS) {
      cellOwner.current = new Array<string>(ASSIGNABLE_SLOTS).fill('')
    }
    slotOf.current = new Int16Array(capacity).fill(-1)

    const order = filed
      .map((item, index) => ({
        index,
        rank: item.flat ? 0 : item.browsed ? 1 : 2 + item.depth,
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, ASSIGNABLE_SLOTS)

    const keep = new Set(order.map((entry) => filed[entry.index]!.id))
    const free: number[] = []
    const owned = new Map<string, number>()
    for (let cell = 0; cell < ASSIGNABLE_SLOTS; cell++) {
      const owner = cellOwner.current[cell]!
      if (owner !== '' && keep.has(owner)) owned.set(owner, cell)
      else {
        cellOwner.current[cell] = ''
        free.push(cell)
      }
    }

    for (const entry of order) {
      const item = filed[entry.index]!
      let cell = owned.get(item.id)
      if (cell === undefined) {
        const next = free.pop()
        if (next === undefined) continue
        cell = next
        cellOwner.current[cell] = item.id
        owned.set(item.id, cell)
        atlas.draw(cell + FIRST_ASSIGNABLE, item.art)
      }
      slotOf.current[entry.index] = cell
    }

    const uvRect = rects.array as Float32Array
    for (let i = 0; i < capacity; i++) {
      const cell = slotOf.current[i] ?? -1
      uvRect.set(cell >= 0 ? atlas.rect(cell + FIRST_ASSIGNABLE) : atlas.blank, i * 4)
    }
    atlas.commit()
    rects.needsUpdate = true
  }, [capacity, filed, atlas, geometry])

  /** The records the lift values were dealt to; a change of hands invalidates them. */
  const owners = useRef<Filed[] | null>(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const previous = owners.current
    // Reset only when an instance actually changes hands: a sleeve mid-draw
    // would otherwise leave its value on an index that now belongs to a
    // different record — but riffling re-packs the crate on every flick, and
    // resetting there would snap the sleeve coming out back into the crate.
    const kept =
      lift.current.length === capacity &&
      previous !== null &&
      previous.length === filed.length &&
      previous.every((item, i) => item.id === filed[i]!.id)
    if (!kept) {
      lift.current = new Float32Array(capacity)
      drawnOut.current = new Float32Array(capacity)
    }
    owners.current = filed
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.records = mesh
    sceneRefs.recordIds = filed.map((item) => item.id)
    sceneRefs.recordCrates = filed.map((item) => item.crate)
    return () => {
      sceneRefs.records = null
      sceneRefs.recordIds = []
      sceneRefs.recordCrates = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, filed, playing, heldRecord])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || filed.length === 0) return
    const focused = useAppStore.getState().focusedRecord
    const rate = approach(10, delta)
    // Slower coming out of the crate than a glance lifts one: it is a hand
    // drawing a record forward, not a sleeve twitching.
    const drawRate = approach(6, delta)
    let dirty = false

    for (let i = 0; i < filed.length; i++) {
      const item = filed[i]!
      const wantLift = item.id === focused ? 1 : 0
      const wantOut = item.browsed ? 1 : 0
      const lifted = lift.current[i] ?? 0
      const drawn = drawnOut.current[i] ?? 0

      const movingLift = Math.abs(wantLift - lifted) >= 0.001
      const movingOut = Math.abs(wantOut - drawn) >= 0.001
      if (!movingLift && !movingOut) {
        if (lifted !== wantLift || drawn !== wantOut) {
          lift.current[i] = wantLift
          drawnOut.current[i] = wantOut
          write(mesh, i)
          dirty = true
        }
        continue
      }
      if (movingLift) lift.current[i] = lifted + (wantLift - lifted) * rate
      if (movingOut) drawnOut.current[i] = drawn + (wantOut - drawn) * drawRate
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
