import * as THREE from 'three'

/**
 * A single sheet of paper as a skinned, bone-driven mesh hinged at x = 0.
 *
 * Same rig as wass08/r3f-animated-book-slider: a segmented box whose vertices
 * are weighted between two adjacent bones in a chain running along +X, so
 * rotating the bones bows the sheet instead of folding it.
 */

export const PAGE_SEGMENTS = 24

export function makePageGeometry(width: number, height: number, depth: number) {
  const geometry = new THREE.BoxGeometry(width, height, depth, PAGE_SEGMENTS, 2)
  geometry.translate(width / 2, 0, 0) // hinge at the spine, sheet extends +X

  const segmentWidth = width / PAGE_SEGMENTS
  const position = geometry.attributes.position
  const vertex = new THREE.Vector3()
  const skinIndices: number[] = []
  const skinWeights: number[] = []

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position as THREE.BufferAttribute, i)
    const index = Math.max(0, Math.min(PAGE_SEGMENTS - 1, Math.floor(vertex.x / segmentWidth)))
    const weight = Math.max(0, Math.min(1, vertex.x / segmentWidth - index))
    skinIndices.push(index, index + 1, 0, 0)
    skinWeights.push(1 - weight, weight, 0, 0)
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
  return geometry
}

export function makeBoneChain(width: number) {
  const segmentWidth = width / PAGE_SEGMENTS
  const bones: THREE.Bone[] = []
  for (let i = 0; i <= PAGE_SEGMENTS; i++) {
    const bone = new THREE.Bone()
    bone.position.x = i === 0 ? 0 : segmentWidth
    if (i > 0) bones[i - 1].add(bone)
    bones.push(bone)
  }
  return bones
}

export type Sheet = {
  mesh: THREE.SkinnedMesh
  bones: THREE.Bone[]
  front: THREE.MeshStandardMaterial
  back: THREE.MeshStandardMaterial
  dispose: () => void
}

/** BoxGeometry emits groups in the order +X, -X, +Y, -Y, +Z, -Z. */
const FRONT_GROUP = 4
const BACK_GROUP = 5

export function makeSheet(width: number, height: number, depth: number): Sheet {
  const geometry = makePageGeometry(width, height, depth)
  const bones = makeBoneChain(width)

  const paperFace = () =>
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 })
  const edge = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 1, metalness: 0 })

  const front = paperFace()
  const back = paperFace()
  const materials: THREE.Material[] = [edge, edge, edge, edge, edge, edge]
  materials[FRONT_GROUP] = front
  materials[BACK_GROUP] = back

  const mesh = new THREE.SkinnedMesh(geometry, materials)
  mesh.add(bones[0])
  mesh.bind(new THREE.Skeleton(bones))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false

  return {
    mesh,
    bones,
    front,
    back,
    dispose: () => {
      geometry.dispose()
      front.dispose()
      back.dispose()
      edge.dispose()
    },
  }
}

/**
 * Bow the sheet. `bend` in [0,1] scales the bow; the per-bone deltas follow
 * cos(pi*u), which integrates to zero across the sheet so the free edge ends
 * up parallel to the hinge rather than curled away from it.
 */
export function applyBow(bones: THREE.Bone[], baseAngle: number, bend: number, amplitude: number) {
  bones[0].rotation.y = baseAngle
  const n = bones.length - 1
  for (let i = 1; i <= n; i++) {
    bones[i].rotation.y = bend * amplitude * Math.cos((i / n) * Math.PI)
  }
}

/**
 * Curl into the gutter for the two sheets lying open.
 *
 * The tangent angle must *decay to zero*, otherwise the sheet keeps rotating
 * along its whole length and dives through the page block underneath it. So
 * shape the cumulative angle as `amount * exp(-i / falloff)` and hand the
 * bones the differences: steep at the spine, dead flat past the fold.
 */
export function applyGutterCurl(
  bones: THREE.Bone[],
  baseAngle: number,
  amount: number,
  falloff = GUTTER_FALLOFF,
) {
  const decay = Math.exp(-1 / falloff)
  bones[0].rotation.y = baseAngle + amount
  for (let i = 1; i < bones.length; i++) {
    bones[i].rotation.y = -amount * Math.exp(-(i - 1) / falloff) * (1 - decay)
  }
}

export const GUTTER_FALLOFF = 3

/**
 * How far the flat part of a curled sheet ends up in front of its hinge.
 * Used to seat the sheet so its plateau lands exactly on the page block.
 */
export function gutterRise(width: number, amount: number, falloff = GUTTER_FALLOFF) {
  const segmentWidth = width / PAGE_SEGMENTS
  let rise = 0
  for (let i = 0; i < PAGE_SEGMENTS; i++) {
    rise += segmentWidth * Math.sin(Math.abs(amount) * Math.exp(-i / falloff))
  }
  return rise
}
