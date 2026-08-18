import { CABLE_CAR, CABLE_SIDE, cabinAt, type CablePoint } from '../world/terrain'

/**
 * The cable car's one moving fact, kept outside zustand like the player and the
 * courier: it advances every frame while a ride is on, and nothing should
 * re-render for it. `Player.tsx` steps it, `Mountains.tsx` draws the cabins
 * from it, and `Interaction.tsx` reads `riding` to offer nothing mid-air.
 *
 * Two cabins on one line, counterweighted: A's place is `lineT`, B mirrors it,
 * and a ride always swaps their ends — so whichever station you are at, the
 * cabin waiting there is the one you board.
 */
export const cableRide = {
  riding: false,
  /** Cabin A's place on the line, 0 at the base stop; cabin B mirrors it. */
  lineT: 0,
  /** The cabin you are in: the one that was waiting at your station. */
  cabin: 'A' as 'A' | 'B',
  /** Which way `lineT` runs this ride. It only ever goes end to end. */
  dir: 1 as 1 | -1,
  from: 'base' as 'base' | 'top',
  /** Seconds since boarding: stepping in, the ride, stepping off. */
  clock: 0,
  /** Where you stood when you pressed E, eased into the cabin from. */
  stand: { x: 0, z: 0, floor: 0 },
}

/** Long enough to read as stepping in, short enough not to read as a cutscene. */
const BOARD_SECONDS = 0.9
const ALIGHT_SECONDS = 0.9

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Where the rider's own cabin floor is at ride progress `r`, 0 at their station. */
function riderCabinAt(r: number): CablePoint {
  const t = cableRide.dir > 0 ? r : 1 - r
  const centre = cableRide.cabin === 'A' ? cabinAt(t) : cabinAt(1 - t)
  // On this cabin's own track line, the same offset the renderer draws it at.
  const side = cableRide.cabin === 'A' ? 1 : -1
  return { x: centre.x + CABLE_SIDE.x * side, y: centre.y, z: centre.z + CABLE_SIDE.z * side }
}

export function startRide(from: 'base' | 'top', stand: { x: number; z: number; floor: number }) {
  if (cableRide.riding) return
  cableRide.riding = true
  cableRide.from = from
  // The cabin at this end of the line, and the direction that takes it away.
  cableRide.cabin = (from === 'base') === (cableRide.lineT < 0.5) ? 'A' : 'B'
  cableRide.dir = cableRide.lineT < 0.5 ? 1 : -1
  cableRide.clock = 0
  cableRide.stand = { ...stand }
}

export type RidePose = { x: number; z: number; floor: number }

/**
 * Advance the ride and answer where the rider is, or null when there is no
 * ride. The rider is eased in from where they stood, carried, and eased out
 * onto the landing — three phases on one clock, so a paused frame pauses all of it.
 */
export function stepRide(delta: number): RidePose | null {
  if (!cableRide.riding) return null
  cableRide.clock += delta
  const clock = cableRide.clock

  if (clock < BOARD_SECONDS) {
    const s = smooth(clock / BOARD_SECONDS)
    const door = riderCabinAt(0)
    const { stand } = cableRide
    return {
      x: stand.x + (door.x - stand.x) * s,
      z: stand.z + (door.z - stand.z) * s,
      floor: stand.floor + (door.y - stand.floor) * s,
    }
  }

  const riding = clock - BOARD_SECONDS
  if (riding < CABLE_CAR.seconds) {
    // Eased at both ends: a cabin leaves a station gently, and both cabins
    // share the haul rope, so the line's own progress carries the easing.
    const r = smooth(riding / CABLE_CAR.seconds)
    const here = riderCabinAt(r)
    cableRide.lineT = cableRide.dir > 0 ? r : 1 - r
    return { x: here.x, z: here.z, floor: here.y }
  }

  const out = riding - CABLE_CAR.seconds
  const landing = CABLE_CAR.landings[cableRide.from === 'base' ? 'top' : 'base']
  if (out < ALIGHT_SECONDS) {
    const s = smooth(out / ALIGHT_SECONDS)
    const door = riderCabinAt(1)
    return {
      x: door.x + (landing.x - door.x) * s,
      z: door.z + (landing.z - door.z) * s,
      floor: door.y + (landing.y - door.y) * s,
    }
  }

  // Arrived: the cabins rest at their new ends until the next ride.
  cableRide.riding = false
  cableRide.lineT = cableRide.dir > 0 ? 1 : 0
  return { x: landing.x, z: landing.z, floor: landing.y }
}
