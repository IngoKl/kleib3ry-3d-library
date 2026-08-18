import * as THREE from 'three'
import { CELL_REGIONS, type SpineAtlas } from './spineAtlas'

/**
 * The one book mesh: a unit cube reading its artwork out of an atlas cell.
 * Shared by the shelves and the boxes, which are the same object seen from two
 * angles, so each costs one draw call for the whole pile.
 */

/**
 * The spine face carries the atlas cell; the others take one plain point from
 * inside it. The spine is the only face visible once a book has neighbours, and
 * a single cloth-coloured texel keeps the rest from being copies of the title.
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
 * Three has no built-in for a per-instance UV rectangle, so `map` is set for the
 * uv plumbing and the sampling replaced with one using our own varying.
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
