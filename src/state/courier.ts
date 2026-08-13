import { deliverySpot, type DerivedWorld } from '../world/derive'
import { terrainAt } from '../world/terrain'

/**
 * The delivery courier: somebody who walks out of the trees with your food,
 * puts it down at the foot of the porch steps, and walks away again.
 *
 * A plain mutable object outside zustand, like the player and the cat — he
 * moves every frame while he is about, and must not trigger React renders
 * doing it. `Courier.tsx` is the only writer once a delivery has started.
 */
export const courier = {
  active: false,
  phase: 'coming' as 'coming' | 'dropping' | 'leaving',
  x: 0,
  y: 0,
  z: 0,
  /** The way he is facing, for the renderer. */
  yaw: 0,
  /** Where he appears out of the trees, and vanishes back into them. */
  from: { x: 0, z: 0 },
  /** Where the box goes down. */
  target: { x: 0, y: 0, z: 0, yaw: 0 },
  /** Seconds left standing at the steps before the box goes down. */
  pause: 0,
  /** True while the box is in his hands rather than on the ground. */
  carrying: true,
  /** Advanced by distance walked, for the stride bob. */
  stride: 0,
}

/** How far out of the trees he comes. Far enough to watch him arrive. */
const APPROACH = 20

/**
 * The way in with the fewest trunks across it. He has no pathfinding — the
 * same deliberate poverty as the cat — so the best that can be done is to
 * pick, once, a straight lane that mostly misses the forest, and let the odd
 * branch brush past him.
 */
function clearestWay(world: DerivedWorld, spot: { x: number; z: number; yaw: number }): number {
  // `spot.yaw` faces the *box* back at the house; the lane out of the trees
  // runs the other way. Getting this backwards had him walking in through the
  // building, which is a horror film, not a delivery.
  const outward = spot.yaw + Math.PI
  let best = outward
  let bestScore = Infinity
  for (const offset of [0, 0.4, -0.4, 0.8, -0.8]) {
    const yaw = outward + offset
    const dx = Math.sin(yaw)
    const dz = Math.cos(yaw)
    let score = 0
    for (const tree of world.trees) {
      const tx = tree.x - spot.x
      const tz = tree.z - spot.z
      const along = tx * dx + tz * dz
      if (along < 0 || along > APPROACH) continue
      if (Math.abs(tx * dz - tz * dx) < 0.8) score += 1
    }
    // A lane that starts in the lake is not a lane.
    if (terrainAt(spot.x + dx * APPROACH, spot.z + dz * APPROACH) === null) score += 100
    if (score < bestScore) {
      bestScore = score
      best = yaw
    }
  }
  return best
}

/** Send him walking. The box lands when he gets there, not on a timer. */
export function startDelivery(world: DerivedWorld): void {
  const spot = deliverySpot(world)
  const way = clearestWay(world, spot)
  courier.active = true
  courier.phase = 'coming'
  courier.carrying = true
  courier.pause = 0
  courier.target = spot
  courier.from = { x: spot.x + Math.sin(way) * APPROACH, z: spot.z + Math.cos(way) * APPROACH }
  courier.x = courier.from.x
  courier.z = courier.from.z
  courier.y = terrainAt(courier.x, courier.z) ?? spot.y
  courier.yaw = way + Math.PI
  courier.stride = 0
}
