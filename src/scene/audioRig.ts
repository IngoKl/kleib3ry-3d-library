/**
 * Sound placed in the room: quieter from next door, and off to the side the
 * source stands on. The `<audio>` element still plays; this routes it through a
 * `PannerNode` when a context can be had and attenuates `element.volume` when
 * one cannot, so every Web Audio failure lands on the fallback, not on silence.
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
 * Inverse-square is right in a field and wrong in a cabin, where a record is
 * audible from the kitchen. This is gentler, and bottoms out rather than
 * reaching zero: one playing two rooms away should be something you can tell.
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
    // `createMediaElementSource` takes the element's own output, so a failure
    // after it is silence — it throws before rerouting, which makes this safe.
    unavailable = true
    return null
  }
}

/**
 * `at` is where the noise is made; null plays it flat at the master volume,
 * which is the right answer for a world that has not loaded yet.
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
    // An existing rig cannot be undone, so "not positional" is served by
    // putting the source at the listener's ear rather than tearing it down.
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
 * A step change on an audio parameter is a click, and a teleporting listener
 * would make one every frame. 40 ms is under the threshold of noticing and over
 * the threshold of clicking.
 */
function set(param: AudioParam, value: number, context: AudioContext) {
  try {
    param.linearRampToValueAtTime(value, context.currentTime + 0.04)
  } catch {
    param.value = value
  }
}
