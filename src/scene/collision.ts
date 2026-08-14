/**
 * Axis-aligned collision for the walk controller.
 *
 * Deliberately not a physics engine. The room is static boxes and the player is
 * a vertical cylinder, so a few lines of AABB overlap gives sliding movement
 * that is deterministic, unit-testable, and does not drag in a wasm runtime
 * (which would also mean loosening the desktop CSP). Rapier can arrive later if
 * books ever need to fall off shelves.
 */
export type Aabb = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type Point = { x: number; z: number }

export function aabbFromCentre(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationY = 0,
): Aabb {
  // The AABB of the rotated footprint, summed like the stair bounds in
  // `derive.ts`: the schema accepts any facing, and snapping to a quarter turn
  // let you walk through the corners of anything stood at an angle — the camp
  // tent most visibly. At right angles one term is zero, so nothing changes;
  // the snap keeps those cases bit-exact despite sin/cos rounding.
  const snap = (v: number) => (v < 1e-9 ? 0 : v > 1 - 1e-9 ? 1 : v)
  const s = snap(Math.abs(Math.sin(rotationY)))
  const c = snap(Math.abs(Math.cos(rotationY)))
  const halfW = (c * width + s * depth) / 2
  const halfD = (s * width + c * depth) / 2
  return { minX: cx - halfW, maxX: cx + halfW, minZ: cz - halfD, maxZ: cz + halfD }
}

export function overlapsCircle(box: Aabb, p: Point, radius: number): boolean {
  return (
    p.x + radius > box.minX &&
    p.x - radius < box.maxX &&
    p.z + radius > box.minZ &&
    p.z - radius < box.maxZ
  )
}

export function blocked(boxes: readonly Aabb[], p: Point, radius: number): boolean {
  return boxes.some((box) => overlapsCircle(box, p, radius))
}

/**
 * Move from `from` towards `to`, sliding along whatever gets in the way.
 *
 * Each axis is tried independently: if the combined move is blocked but one
 * axis alone is not, the player slides along the surface instead of sticking to
 * it. If the start position is already inside something (a shelf placed on top
 * of the player, say) the move is allowed, so there is no way to get trapped.
 */
export function resolveMove(
  from: Point,
  to: Point,
  radius: number,
  boxes: readonly Aabb[],
): Point {
  if (blocked(boxes, from, radius)) return to

  let { x, z } = from
  const tryX = { x: to.x, z }
  if (!blocked(boxes, tryX, radius)) x = to.x

  const tryZ = { x, z: to.z }
  if (!blocked(boxes, tryZ, radius)) z = to.z

  return { x, z }
}
