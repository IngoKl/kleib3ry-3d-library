import type * as THREE from 'three'

/**
 * Handles to the instanced meshes the interaction raycaster needs, which live in
 * different components. Bookcases come in groups because a four-shelf carcass is
 * a different mesh from a six-shelf one, so a hit's instance id only means
 * something alongside the group's `indices` back into `world.shelves`.
 */
export type ShelfGroup = {
  rows: number
  /** `indices[instanceId]` is the index of that instance in `world.shelves`. */
  indices: number[]
  mesh: THREE.InstancedMesh | null
}

export const sceneRefs: {
  books: THREE.InstancedMesh | null
  /** `bookIds[instanceId]` for the shelved-books mesh, which can be sparse. */
  bookIds: string[]
  shelfGroups: ShelfGroup[]
  /** The books piled in the moving boxes, for taking one back out. */
  boxedBooks: THREE.InstancedMesh | null
  boxedIds: string[]
  /** `boxedOwners[instanceId]` — which box that book is lying in. */
  boxedOwners: string[]
  /** The boxes themselves — for dropping a book in, or emptying one out. */
  boxes: THREE.Object3D | null
  /** Tables and counters: what you can set a book down on. */
  surfaces: THREE.Object3D | null
  /** Lamps and appliances: what pressing E *operates* rather than picks up. */
  fixtures: THREE.Object3D | null
  /** The records in the crates, and which track each instance is. */
  records: THREE.InstancedMesh | null
  recordIds: string[]
  /** `recordCrates[instanceId]` — which crate that record is in, null if it is out. */
  recordCrates: (string | null)[]
  /** The tapes in the crates, and which tape each instance is. */
  tapes: THREE.InstancedMesh | null
  tapeIds: string[]
  /** `tapeCrates[instanceId]` — which crate that tape is filed in. */
  tapeCrates: string[]
  /** Its own group: the question asked of a board is not the one asked of a table. */
  boards: THREE.Object3D | null
  /**
   * So a page can be pinned to a plain wall. Published by `Rooms`, the only
   * thing that knows where the walls ended up once their openings were cut.
   */
  walls: THREE.Object3D | null
  /** Pages and notes already pinned up, for taking one down again. */
  pinned: THREE.Object3D | null
  /** Books lying about the room, on tables and on the floor. */
  looseBooks: THREE.InstancedMesh | null
  looseIds: string[]
  /** The small props — cup, cans, takeaway boxes. Each group carries its propId. */
  props: THREE.Object3D | null
  /** Books left open. Real meshes rather than instances, so their own group. */
  openBooks: THREE.Object3D | null
  /** Everything you can sit on. Each mesh carries its furniture id in userData. */
  seats: THREE.Object3D | null
  /** One invisible box round the whole animal, so pointing finds a cat, not an ear. */
  cat: THREE.Object3D | null
  /** How many shelved books currently hold an atlas cell, i.e. are printed. */
  printedSpines: number
  /** Cells drawn since launch. Rises when you move, flat when you stand still. */
  spinesReprinted: number
  /** Books whose printed spine is out of date: a cover arrived. Drained by the next pass. */
  spineDirty: Set<string>
  /** How far the focused book has slid out, 0 to 1, so its cover can follow it. */
  focusPull: number
  /** Published by `Probe`, so a test can ask what is actually mounted. */
  scene: THREE.Scene | null
} = {
  books: null,
  bookIds: [],
  shelfGroups: [],
  boxedBooks: null,
  boxedIds: [],
  boxedOwners: [],
  boxes: null,
  surfaces: null,
  fixtures: null,
  records: null,
  recordIds: [],
  recordCrates: [],
  tapes: null,
  tapeIds: [],
  tapeCrates: [],
  boards: null,
  walls: null,
  pinned: null,
  looseBooks: null,
  looseIds: [],
  props: null,
  openBooks: null,
  seats: null,
  cat: null,
  printedSpines: 0,
  spinesReprinted: 0,
  spineDirty: new Set<string>(),
  focusPull: 0,
  scene: null,
}
