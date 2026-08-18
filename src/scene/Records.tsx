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
 * Records are dealt rather than arranged. Every crate takes a slice of `music/`
 * in folder order, so nothing has to be written down for a few hundred sleeves
 * to have somewhere to be; only what you have had an opinion about is stored,
 * as one entry rather than an ordering, because a crate has no order worth
 * keeping.
 *
 * A crate is dealt more records than it can stand up, as a box holds more books
 * than it can pile: it stands up one crateful at a time, and riffling moves
 * which crateful that is and draws one sleeve out face-on — the only way
 * seventy sleeves four millimetres apart are readable.
 *
 * One instanced mesh for the lot, printed from a sleeve atlas.
 */

const SLEEVE = SLEEVE_SIZE
const THICKNESS = SLEEVE_THICKNESS
/** How much air is left between two filed sleeves. */
const GAP = 0.0035
const LEAN_AXIS = new THREE.Vector3(1, 0, 0)
const WHITE = new THREE.Color('#ffffff')

/** A centre divider, so records file into two bays and a full crate is not one slab. */
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
  // Subscribed rather than peeked: a record on the deck or in your hand is out
  // of its crate, and the instances must follow the moment either changes.
  const playing = useMediaStore((s) => s.playing)
  const heldRecord = useAppStore((s) => s.heldRecord)
  const crateOffsets = useAppStore((s) => s.crateOffsets)
  const setCrateDeal = useAppStore((s) => s.setCrateDeal)
  const filedRecords = useLibraryStore((s) => s.filedRecords)
  const looseRecords = useLibraryStore((s) => s.looseRecords)

  /**
   * Deal the collection into the room's crates in document order, honouring
   * hand filings first — without that ordering, a record filed into a full
   * crate is pushed straight back out and putting one away looks like it failed.
   *
   * Every record gets a crate however many there are: a crate takes a share of
   * the collection rather than only what it can show.
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
      // Never less than a crateful, so a collection that fits fills the first
      // crate before touching the next. A crate asked for by hand keeps
      // everything asked of it: a capacity must not undo a filing.
      const share = Math.max(perBay * 2, Math.ceil(pool.length / (pieces.length - n)))
      const mine = wanted(crate.id)
      const records = [...mine, ...pool.splice(0, Math.max(0, share - mine.length))]
      for (const track of records) dealt[track.id] = crate.id
      crates.push({ crate, records, perBay, usable })
    }

    return { crates, loose, dealt }
  }, [world, tracks, filedRecords, looseRecords])

  /**
   * Stand a crateful up in each crate and draw one sleeve out. The crateful on
   * show is the block the riffle is in rather than a sliding window, so a flick
   * costs a matrix per sleeve and no redrawn atlas cell. Keyed on the offsets,
   * so riffling never re-deals the collection.
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
    // Filed, it stands and leans back; set down, it is the same sleeve tipped a
    // quarter turn; drawn out, it tips further, turning its face to your eyes.
    const lean = item.flat ? -Math.PI / 2 : item.lean + (DRAW_LEAN - item.lean) * drawn
    quaternion.multiply(leanTurn.setFromAxisAngle(LEAN_AXIS, lean))
    scale.set(SLEEVE, SLEEVE, THICKNESS)
    matrix.compose(position, quaternion, away ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    // A printed cell carries the artwork, so its instance stays white and lets
    // it through untinted; one with no cell wears plain card. The focused
    // sleeve and the drawn one brighten, which reads as a hand about to be there.
    const printed = (slotOf.current[i] ?? -1) >= 0
    colour.copy(printed ? WHITE : item.card).multiplyScalar(1 + Math.max(amount, drawn) * 0.22)
    mesh.setColorAt(i, colour)
  }

  /**
   * Atlas cells go to the sleeves whose faces can be read: one lying face up,
   * the one drawn out, then front to back through each bay — a sleeve four
   * millimetres from its neighbour shows an edge and nothing else. Cells are
   * kept by record, so a flick that only moves a sleeve uploads nothing.
   */
  useLayoutEffect(() => {
    // In place where the capacity allows: a replaced attribute's GPU buffer is
    // freed only on geometry dispose, so a fresh one per edit orphans buffers.
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
    // Only when an instance changes hands: a sleeve mid-draw would leave its
    // value on an index now belonging to another record — yet riffling re-packs
    // every flick, and resetting there snaps the drawn sleeve back in.
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
