/**
 * The room's small noises — a lit fire, the cat's purr, the dust on a record —
 * synthesised like the rain: short seamless loops of shaped noise, no samples,
 * no dependencies. Every failure falls back to silence rather than throwing.
 *
 * One AudioContext shared by the three, opened when the first loop is needed
 * and closed when the last stops: browsers cap live contexts, and the rain
 * already holds one of its own.
 */

type LoopName = 'fire' | 'purr' | 'vinyl'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type Loop = {
  source: AudioBufferSourceNode
  gain: GainNode
}

let context: AudioContext | null = null
let unavailable = false
const loops = new Map<LoopName, Loop>()

function ensure(): AudioContext | null {
  if (unavailable) return null
  if (context) {
    if (context.state === 'suspended') void context.resume().catch(() => {})
    return context
  }
  try {
    context = new AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
    return context
  } catch {
    unavailable = true
    return null
  }
}

/** Cross-fade the loop seam, or the join ticks once a cycle. */
function deSeam(data: Float32Array, sampleRate: number) {
  const fade = Math.floor(sampleRate * 0.02)
  const length = data.length
  for (let i = 0; i < fade; i++) {
    const t = i / fade
    data[i] = data[i]! * t + data[length - fade + i]! * (1 - t)
  }
}

/**
 * A fire: a low rumble with sparse pops riding on it. The pops are baked into
 * the loop rather than scheduled — three seconds of them is enough that the
 * repeat is never picked out over the rumble.
 */
function makeFire(ctx: AudioContext): AudioBuffer {
  const seconds = 3
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = low * 0.972 + white * 0.028
      data[i] = low * 1.7 + white * 0.02
    }
    // The pops: short bursts with an exponential tail, like sap going.
    for (let pop = 0; pop < 46; pop++) {
      const at = Math.floor(Math.random() * (length - 400))
      const loudness = 0.25 + Math.random() * 0.55
      const sign = Math.random() > 0.5 ? 1 : -1
      const tail = 60 + Math.floor(Math.random() * 260)
      for (let i = 0; i < tail; i++) {
        data[at + i]! += sign * loudness * Math.exp((-4 * i) / tail) * (Math.random() * 2 - 1)
      }
    }
    deSeam(data, ctx.sampleRate)
  }
  return buffer
}

/**
 * A purr: low noise with its loudness swung at ~24 Hz. The swing is baked in —
 * 24 cycles a second over a 4-second loop is a whole number, so the loop seam
 * lands on the same phase and no LFO node has to live anywhere.
 */
function makePurr(ctx: AudioContext): AudioBuffer {
  const seconds = 4
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = low * 0.985 + white * 0.015
      const t = i / ctx.sampleRate
      const swing = 0.5 + 0.5 * Math.sin(2 * Math.PI * 24 * t)
      data[i] = low * 3.4 * (0.35 + 0.65 * swing)
    }
    deSeam(data, ctx.sampleRate)
  }
  return buffer
}

/** Record surface noise: a faint hiss and the occasional click of dust. */
function makeVinyl(ctx: AudioContext): AudioBuffer {
  const seconds = 2
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.02
    for (let click = 0; click < 14; click++) {
      const at = Math.floor(Math.random() * (length - 40))
      const loudness = 0.1 + Math.random() * 0.35
      for (let i = 0; i < 18; i++) {
        data[at + i]! += loudness * Math.exp(-i / 5) * (Math.random() > 0.5 ? 1 : -1)
      }
    }
    deSeam(data, ctx.sampleRate)
  }
  return buffer
}

const RECIPES: Record<LoopName, (ctx: AudioContext) => AudioBuffer> = {
  fire: makeFire,
  purr: makePurr,
  vinyl: makeVinyl,
}

function startLoop(name: LoopName): Loop | null {
  const live = loops.get(name)
  if (live) return live
  const ctx = ensure()
  if (!ctx) return null
  try {
    const source = ctx.createBufferSource()
    source.buffer = RECIPES[name](ctx)
    source.loop = true
    const gain = ctx.createGain()
    gain.gain.value = 0
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
    const loop = { source, gain }
    loops.set(name, loop)
    return loop
  } catch {
    return null
  }
}

/**
 * Set one loop's level, 0 to 1, ramped so a step never clicks. A zero level on
 * a loop that has not started stays silent for free — walking past a cold
 * hearth must not open an audio graph.
 */
export function placeLoop(name: LoopName, volume: number) {
  const level = clamp(volume, 0, 1)
  if (level <= 0 && !loops.has(name)) return
  const loop = startLoop(name)
  if (!loop || !context) return
  try {
    loop.gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.12)
  } catch {
    loop.gain.gain.value = level
  }
}

/** Stop one loop; the context goes back with the last of them. */
export function stopLoop(name: LoopName) {
  const loop = loops.get(name)
  if (!loop) return
  loops.delete(name)
  try {
    loop.gain.gain.value = 0
    loop.source.stop()
  } catch {
    /* a source that never started is already stopped */
  }
  if (loops.size === 0 && context) {
    void context.close().catch(() => {})
    context = null
  }
}

/** Everything off — the scene unmounted. */
export function stopAllLoops() {
  for (const name of [...loops.keys()]) stopLoop(name)
}
