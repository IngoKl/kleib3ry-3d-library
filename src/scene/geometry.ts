/**
 * The shared geometry vocabulary. Every assembled thing here — the cat, the
 * body, a carcass, a room shell, a staircase — is boxes merged into one
 * geometry per material, and each of those files had grown its own copy of
 * the same two helpers. They live here now, together with the two builders
 * the furniture upgrade added: a chamfered box, and a turned profile.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Panel } from '../world/derive'

/** A box at a place, ready to merge with its neighbours. */
export function block(
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, d)
  box.translate(x, y, z)
  return box
}

/** Merge a list — assumed non-empty — and dispose the parts. */
export function join(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries([...parts], false)
  parts.forEach((part) => part.dispose())
  return merged
}

/** Panels as one geometry: `block` + `join` for the position/size idiom. */
export function mergePanels(panels: readonly Panel[]): THREE.BufferGeometry | null {
  if (panels.length === 0) return null
  return join(panels.map((panel) => block(...panel.size, ...panel.position)))
}

/**
 * A box with its twelve edges chamfered: the difference between joinery and
 * CG. Hand-built rather than an ExtrudeGeometry bevel because extrusion's
 * UVs are shape-space — a grain map would smear differently on every box —
 * and these carry the box convention: each face projected 0..1, chamfer
 * strips reusing the nearest edge texel. Indexed, position/normal/uv only,
 * so it merges cleanly with plain BoxGeometry parts. 44 triangles.
 */
export function chamferBox(w: number, h: number, d: number, c = 0.012): THREE.BufferGeometry {
  // A chamfer can never eat a face: cap it well below the smallest half-side.
  const cut = Math.min(c, w / 3, h / 3, d / 3)
  const hw = w / 2
  const hh = h / 2
  const hd = d / 2

  type P = readonly [number, number, number]
  // A corner's three points, one on each adjoining main face.
  const A = (sx: number, sy: number, sz: number): P => [sx * hw, sy * (hh - cut), sz * (hd - cut)]
  const B = (sx: number, sy: number, sz: number): P => [sx * (hw - cut), sy * hh, sz * (hd - cut)]
  const C = (sx: number, sy: number, sz: number): P => [sx * (hw - cut), sy * (hh - cut), sz * hd]

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // Project a point to the face UV its normal mostly belongs to — on the
  // chamfers the pick is arbitrary between the two faces, which lands the
  // strip on an edge texel either way.
  const uvFor = (p: P, n: P): readonly [number, number] => {
    const ax = Math.abs(n[0])
    const ay = Math.abs(n[1])
    const az = Math.abs(n[2])
    if (ax >= ay && ax >= az) return [p[2] / d + 0.5, p[1] / h + 0.5]
    if (ay >= ax && ay >= az) return [p[0] / w + 0.5, p[2] / d + 0.5]
    return [p[0] / w + 0.5, p[1] / h + 0.5]
  }

  const tri = (p0: P, p1: P, p2: P, nx: number, ny: number, nz: number) => {
    // Wind outward: flip if the geometric normal opposes the intended one.
    const ux = p1[0] - p0[0]
    const uy = p1[1] - p0[1]
    const uz = p1[2] - p0[2]
    const vx = p2[0] - p0[0]
    const vy = p2[1] - p0[1]
    const vz = p2[2] - p0[2]
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
    const points = dot < 0 ? [p0, p2, p1] : [p0, p1, p2]
    const scale = 1 / Math.hypot(nx, ny, nz)
    for (const p of points) {
      positions.push(...p)
      normals.push(nx * scale, ny * scale, nz * scale)
      uvs.push(...uvFor(p, [nx, ny, nz]))
    }
  }
  const quad = (p0: P, p1: P, p2: P, p3: P, nx: number, ny: number, nz: number) => {
    tri(p0, p1, p2, nx, ny, nz)
    tri(p0, p2, p3, nx, ny, nz)
  }

  for (const s of [-1, 1]) {
    quad(A(s, -1, -1), A(s, 1, -1), A(s, 1, 1), A(s, -1, 1), s, 0, 0)
    quad(B(-1, s, -1), B(1, s, -1), B(1, s, 1), B(-1, s, 1), 0, s, 0)
    quad(C(-1, -1, s), C(1, -1, s), C(1, 1, s), C(-1, 1, s), 0, 0, s)
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) quad(A(sx, sy, -1), A(sx, sy, 1), B(sx, sy, 1), B(sx, sy, -1), sx, sy, 0)
    for (const sz of [-1, 1]) quad(A(sx, -1, sz), A(sx, 1, sz), C(sx, 1, sz), C(sx, -1, sz), sx, 0, sz)
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) quad(B(-1, sy, sz), B(1, sy, sz), C(1, sy, sz), C(-1, sy, sz), 0, sy, sz)
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) tri(A(sx, sy, sz), B(sx, sy, sz), C(sx, sy, sz), sx, sy, sz)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Trivially indexed: mergeGeometries refuses to mix indexed BoxGeometry
  // parts with non-indexed ones, and every neighbour of this is a box.
  geometry.setIndex([...Array(positions.length / 3).keys()])
  return geometry
}

/** `chamferBox` at a place, the `block` convention. */
export function chamferBlock(
  w: number,
  h: number,
  d: number,
  c: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const box = chamferBox(w, h, d, c)
  box.translate(x, y, z)
  return box
}

/**
 * A turned profile — table leg, lamp base — as radius/height pairs read
 * bottom-up. Eight radial segments by default: flat-shaded low-poly turning,
 * in step with the six-to-sixteen-segment cylinders everywhere else.
 */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments = 8,
): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
    segments,
  )
}
