/**
 * Rain, synthesised rather than sampled: looping filtered noise through a
 * low-pass whose cutoff tracks how much sky you can hear. Every failure falls
 * back to silence rather than throwing.
 */

type Rig = {
  context: AudioContext
  source: AudioBufferSourceNode
  /** Cuts the hiss off as you go indoors. */
  shelter: BiquadFilterNode
  gain: GainNode
}

let rig: Rig | null = null
/** Set once anything throws; the same stack is not asked twice. */
let unavailable = false

/** Seconds of noise in the loop. */
const LOOP_SECONDS = 4

/** Cutoff under open sky, and under a roof. */
const OPEN_HZ = 9000
const SHELTERED_HZ = 620

/** White noise with a one-pole low-pass mixed back in, for the rumble under the hiss. */
function makeNoise(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * LOOP_SECONDS)
  const buffer = context.createBuffer(2, length, context.sampleRate)

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = low * 0.94 + white * 0.06
      data[i] = white * 0.34 + low * 3.2
    }
    // Cross-fade the seam, or the loop point ticks.
    const fade = Math.floor(context.sampleRate * 0.02)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      data[i] = data[i]! * t + data[length - fade + i]! * (1 - t)
    }
  }

  return buffer
}

function start(): Rig | null {
  if (unavailable) return null
  if (rig) {
    // A context can be suspended at any point after it was granted.
    if (rig.context.state === 'suspended') void rig.context.resume().catch(() => {})
    return rig
  }

  try {
    const context = new AudioContext()
    const source = context.createBufferSource()
    source.buffer = makeNoise(context)
    source.loop = true

    const shelter = context.createBiquadFilter()
    shelter.type = 'lowpass'
    shelter.frequency.value = SHELTERED_HZ
    shelter.Q.value = 0.4

    const gain = context.createGain()
    gain.gain.value = 0

    source.connect(shelter)
    shelter.connect(gain)
    gain.connect(context.destination)
    source.start()

    if (context.state === 'suspended') void context.resume().catch(() => {})
    rig = { context, source, shelter, gain }
    return rig
  } catch {
    // A refusal while an old rig is still fading out is the browser's context
    // cap, not a missing device: the next placeRain retries once it has closed.
    if (closing === 0) unavailable = true
    return null
  }
}

/** `openness` is 0 under a roof and 1 outside. Both ramped: a step clicks. */
export function placeRain(volume: number, openness: number) {
  const fresh = !rig
  const live = start()
  if (!live) return
  const { context, shelter, gain } = live
  // A shower arriving gets a longer swell than an adjustment to one already on.
  const at = context.currentTime + (fresh ? 0.5 : 0.12)
  try {
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)), at)
    // Exponential in frequency, because hearing is.
    shelter.frequency.exponentialRampToValueAtTime(
      SHELTERED_HZ * (OPEN_HZ / SHELTERED_HZ) ** Math.max(0, Math.min(1, openness)),
      at,
    )
  } catch {
    gain.gain.value = volume
  }
}

/** Seconds the shower takes to die away once told to stop. */
const TAIL_SECONDS = 0.8

/** Rigs still fading out — their contexts are spoken for, not gone. */
let closing = 0

/**
 * Ramp the gain out, then stop the source once the tail has run: stopping in the
 * same tick is the click the ramps avoid. `rig` is cleared first, so a second
 * stop is a no-op and rain restarted during the tail opens a fresh one.
 */
export function stopRain() {
  if (!rig) return
  const { context, source, gain } = rig
  rig = null
  try {
    const now = context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0, now + TAIL_SECONDS)
  } catch {
    gain.gain.value = 0
  }
  closing += 1
  setTimeout(
    () => {
      closing -= 1
      try {
        source.stop()
      } catch {
        /* a source that never started is already stopped */
      }
      void context.close().catch(() => {})
    },
    (TAIL_SECONDS + 0.1) * 1000,
  )
}
