/**
 * Sound placed in the room: quieter from the next room, and off to the side the
 * thing making it stands on.
 *
 * The `<audio>` element is still what plays — see `state/media.ts`. This routes
 * its output through a `PannerNode` when a context can be had, and attenuates
 * `element.volume` by distance when one cannot. Every Web Audio failure mode
 * lands on that fallback rather than on silence.
 */

type Rig = {
  context: AudioContext
  panner: PannerNode
  gain: GainNode
}

const rigs = new Map<HTMLMediaElement, Rig>()
let context: AudioContext | null = null
/** Set once anything throws. There is no point asking the same stack twice. */
let unavailable = false

/** Where the ears are, written once per frame before any source is placed. */
export type Listener = { x: number; y: number; z: number; yaw: number }

/**
 * Distance falloff for the fallback path, and the shape the panner is given.
 *
 * Inverse-square would be right in a field and wrong in a cabin: at the far end
 * of the great room a record would be inaudible, when in fact you can hear it
 * from the kitchen. This is gentler, and bottoms out rather than reaching zero —
 * a record playing two rooms away should be a thing you can tell is on.
 */
const REFERENCE = 2.4
const FLOOR = 0.08

export function falloff(distance: number): number {
  const near = Math.max(0, distance - REFERENCE * 0.5)
  return FLOOR + (1 - FLOOR) / (1 + (near / REFERENCE) ** 1.7)
}

function rigFor(element: HTMLMediaElement): Rig | null {
  if (unavailable) return null
  const existing = rigs.get(element)
  if (existing) {
    // A context can be suspended by the browser at any point after it was
    // granted — a background tab, an OS audio change. Asking is cheap.
    if (existing.context.state === 'suspended') void existing.context.resume().catch(() => {})
    return existing
  }

  try {
    context ??= new AudioContext()
    const source = context.createMediaElementSource(element)
    const panner = new PannerNode(context, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: REFERENCE,
      maxDistance: 60,
      rolloffFactor: 1.1,
    })
    const gain = context.createGain()
    source.connect(panner)
    panner.connect(gain)
    gain.connect(context.destination)
    const rig: Rig = { context, panner, gain }
    rigs.set(element, rig)
    if (context.state === 'suspended') void context.resume().catch(() => {})
    return rig
  } catch {
    // Once `createMediaElementSource` has been called the element's own output
    // is gone, so a failure *after* that point would be silence. It throws
    // before rerouting anything, which is why this is safe to attempt at all.
    unavailable = true
    return null
  }
}

/**
 * Put one source in the room.
 *
 * `at` is where the thing making the noise is; null plays it flat at the master
 * volume, which is the right answer for a world that has not loaded yet.
 */
export function placeSound(
  element: HTMLMediaElement,
  at: { x: number; y: number; z: number } | null,
  listener: Listener,
  master: number,
  positional: boolean,
) {
  if (!positional || !at) {
    const rig = rigs.get(element)
    // A rig that already exists cannot be undone — the element's direct output
    // is gone — so "not positional" is served by putting the source at the
    // listener's ear rather than by trying to tear the graph down.
    if (rig) {
      set(rig.panner.positionX, listener.x, rig.context)
      set(rig.panner.positionY, listener.y, rig.context)
      set(rig.panner.positionZ, listener.z, rig.context)
      set(rig.gain.gain, master, rig.context)
    } else {
      element.volume = clamp(master)
    }
    return
  }

  const rig = rigFor(element)
  if (!rig) {
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z)
    element.volume = clamp(master * falloff(distance))
    return
  }

  const ears = rig.context.listener
  set(ears.positionX, listener.x, rig.context)
  set(ears.positionY, listener.y, rig.context)
  set(ears.positionZ, listener.z, rig.context)
  // Yaw 0 looks down -Z, which is the same convention the camera uses.
  set(ears.forwardX, -Math.sin(listener.yaw), rig.context)
  set(ears.forwardY, 0, rig.context)
  set(ears.forwardZ, -Math.cos(listener.yaw), rig.context)
  set(ears.upX, 0, rig.context)
  set(ears.upY, 1, rig.context)
  set(ears.upZ, 0, rig.context)

  set(rig.panner.positionX, at.x, rig.context)
  set(rig.panner.positionY, at.y, rig.context)
  set(rig.panner.positionZ, at.z, rig.context)
  set(rig.gain.gain, master, rig.context)
  // Element volume stays at 1: the gain node is the master now, and turning
  // both down would square it.
  element.volume = 1
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

/**
 * Ramp rather than assign.
 *
 * A step change on an audio parameter is a click, and a listener that teleports
 * — which the test surface does, and which a live reload can do — would produce
 * one on every frame of the move. 40 ms is under the threshold of noticing and
 * over the threshold of clicking.
 */
function set(param: AudioParam, value: number, context: AudioContext) {
  try {
    param.linearRampToValueAtTime(value, context.currentTime + 0.04)
  } catch {
    param.value = value
  }
}
