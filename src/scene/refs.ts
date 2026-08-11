import type * as THREE from 'three'

/**
 * Handles to the instanced meshes the interaction raycaster needs. They live in
 * different components, and threading refs through the tree for one consumer is
 * more ceremony than it is worth.
 *
 * Bookcases come in groups because a four-shelf carcass is a different mesh
 * from a six-shelf one, so a raycast hit gives an instance id that only means
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
  /** The boxes themselves — for dropping a book in, or emptying one out. */
  boxes: THREE.Object3D | null
  /** Everything you can sit on. Each mesh carries its furniture id in userData. */
  seats: THREE.Object3D | null
  /** How many shelved books currently hold an atlas cell, i.e. are printed. */
  printedSpines: number
  /** Cells drawn since launch. Rises when you move, flat when you stand still. */
  spinesReprinted: number
  /**
   * Books whose printed spine is out of date — a cover arrived and its colour
   * is now known. Drained by the next printing pass.
   */
  spineDirty: Set<string>
  /** How far the focused book has slid out, 0 to 1, so its cover can follow it. */
  focusPull: number
} = {
  books: null,
  bookIds: [],
  shelfGroups: [],
  boxedBooks: null,
  boxedIds: [],
  boxes: null,
  seats: null,
  printedSpines: 0,
  spinesReprinted: 0,
  spineDirty: new Set<string>(),
  focusPull: 0,
}
