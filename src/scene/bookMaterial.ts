import * as THREE from 'three'
import { CELL_REGIONS, type SpineAtlas } from './spineAtlas'

/**
 * The one book mesh: a unit cube that reads its artwork out of an atlas cell.
 *
 * Shared by the books on the shelves and the books in the boxes, which are the
 * same object seen from two angles — standing up with the spine out, or lying
 * flat with the cover up. Both are instanced, both sample one texture, and both
 * therefore cost one draw call for the whole pile.
 */

/**
 * A unit cube whose *spine* face carries the atlas cell and whose other faces
 * take a single plain point from inside that same cell.
 *
 * The spine is the +Z face — books stand with their thickness along X and their
 * depth into the shelf along Z — and it is the only face you can see once a
 * book has neighbours. Mapping the rest to one cloth-coloured texel keeps them
 * looking like cloth instead of like five more copies of the title.
 */
export function makeBookGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  // BoxGeometry emits +X, -X, +Y, -Y, +Z, -Z, four vertices each. +Z is the
  // spine, +X is the front board — the face a book turns towards you.
  const face = (first: number, [rx, ry, rw, rh]: readonly [number, number, number, number]) => {
    for (let i = 0; i < 4; i++) {
      const u = uv.getX(first + i)
      const v = uv.getY(first + i)
      uv.setXY(first + i, rx + u * rw, ry + v * rh)
    }
  }

  // Everything starts on plain cloth; the two faces you can see get regions.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, CELL_REGIONS.cloth[0], CELL_REGIONS.cloth[1])
  const box = new THREE.BoxGeometry(1, 1, 1)
  const source = box.attributes.uv as THREE.BufferAttribute
  for (const first of [0, 16]) {
    for (let i = 0; i < 4; i++) uv.setXY(first + i, source.getX(first + i), source.getY(first + i))
  }
  face(0, CELL_REGIONS.cover)
  face(16, CELL_REGIONS.spine)
  box.dispose()

  uv.needsUpdate = true
  return geometry
}

/**
 * The atlas is sampled through a per-instance rectangle, which three has no
 * built-in for — so `map` is set to get the uv plumbing and the sampling is
 * then replaced with one that uses our own varying.
 */
export function makeBookMaterial(atlas: SpineAtlas): THREE.MeshStandardMaterial {
  const created = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 })
  created.map = atlas.texture
  created.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aUvRect;\nvarying vec2 vAtlasUv;',
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvAtlasUv = aUvRect.xy + uv * aUvRect.zw;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAtlasUv;')
      .replace('#include <map_fragment>', 'diffuseColor *= texture2D( map, vAtlasUv );')
  }
  return created
}
