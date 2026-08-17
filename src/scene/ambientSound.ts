/**
 * The room's small noises — a lit fire, the cat's purr, the dust on a record,
 * the lake at its shore — and its one-shots — a footfall, a landed book, a
 * turned page — synthesised like the rain: shaped noise, no samples, no
 * dependencies. Every failure falls back to silence rather than throwing.
 *
 * One AudioContext shared by all of them, opened when the first sound is
 * needed and closed once the loops and the one-shots are both done: browsers
 * cap live contexts, and the rain already holds one of its own.
 */

import { useSettings } from '../state/settings'

type LoopName = 'fire' | 'purr' | 'vinyl' | 'lake' | 'wind'
type ShotName =
  | 'thud'
  | 'swish'
  | 'step-wood'
  | 'step-grass'
  | 'step-sand'
  | 'step-stone'
  | 'click'
  | 'rustle'
  | 'slide'
  | 'door-open'
  | 'door-close'
  | 'cardboard'
  | 'thunder'

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
  // A sound arriving keeps the context: the idle close waits for real quiet.
  if (closeTimer !== null) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
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

/**
 * The lake at the shore: deep low-passed noise whose loudness swells and draws
 * back once per loop. The swell is baked in, the purr's trick — one cycle over
 * the seven seconds is a whole number, so the seam lands on the same phase.
 */
function makeLake(ctx: AudioContext): AudioBuffer {
  const seconds = 7
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = low * 0.988 + white * 0.012
      const t = i / ctx.sampleRate
      const swell = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / seconds)
      // A little of the white kept on top: the wash without it is a hum.
      data[i] = (low * 2.9 + white * 0.02) * (0.3 + 0.7 * swell)
    }
    deSeam(data, ctx.sampleRate)
  }
  return buffer
}

/**
 * Wind in the trees: the lake's dark wash with its loudness gusting rather
 * than swelling. Two gusts beat against each other, at one and three cycles a
 * loop — whole numbers, the purr's trick, so the seam lands on phase — and
 * their phases are drawn once so both channels ride the same weather.
 */
function makeWind(ctx: AudioContext): AudioBuffer {
  const seconds = 13
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  const slow = Math.random() * Math.PI * 2
  const quick = Math.random() * Math.PI * 2
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      low = low * 0.982 + white * 0.018
      const t = i / ctx.sampleRate
      const gust =
        0.5 +
        0.34 * Math.sin((2 * Math.PI * t) / seconds + slow) +
        0.16 * Math.sin((2 * Math.PI * 3 * t) / seconds + quick)
      // A floor under the gusts: the wind never quite dies between them.
      data[i] = (low * 2.6 + white * 0.04) * (0.42 + 0.58 * clamp(gust, 0, 1))
    }
    deSeam(data, ctx.sampleRate)
  }
  return buffer
}

const RECIPES: Record<LoopName, (ctx: AudioContext) => AudioBuffer> = {
  fire: makeFire,
  purr: makePurr,
  vinyl: makeVinyl,
  lake: makeLake,
  wind: makeWind,
}

/** Loop buffers, baked once and kept: makeLake alone is over a million samples. */
const bakes = new Map<LoopName, AudioBuffer>()

function startLoop(name: LoopName): Loop | null {
  const live = loops.get(name)
  if (live) return live
  const ctx = ensure()
  if (!ctx) return null
  try {
    let buffer = bakes.get(name)
    if (!buffer) {
      buffer = RECIPES[name](ctx)
      bakes.set(name, buffer)
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
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

/** Stop one loop; the context goes back with the last sound. */
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
  closeIfIdle()
}

/** Everything off — the scene unmounted. */
export function stopAllLoops() {
  for (const name of [...loops.keys()]) stopLoop(name)
}

/** One-shot buffers, baked once and kept: a footstep fires every stride. */
const shots = new Map<ShotName, AudioBuffer>()
/** One-shots still sounding. The context must not close out from under one. */
let liveShots = 0

/**
 * Give the context back once nothing — loop or one-shot — still needs it,
 * after a quiet spell rather than at once: footsteps end sixty milliseconds
 * apart, and opening a fresh AudioContext per stride is how a browser's
 * context cap gets hit and every sound here goes permanently silent.
 */
let closeTimer: ReturnType<typeof setTimeout> | null = null

function closeIfIdle() {
  if (closeTimer !== null) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    // A chorus between phrases holds the context too: its gaps outlast this
    // quiet spell, and a dawn chorus must not reopen a context per chirp.
    if (loops.size === 0 && liveShots === 0 && choruses.size === 0 && context) {
      void context.close().catch(() => {})
      context = null
    }
  }, 6_000)
}

/**
 * A one-shot is the loops' shaped noise, over in a fraction of a second: white
 * noise between two one-pole low-passes (what `keep` passes, minus what `cut`
 * passes — a crude band-pass), under an attack and an exponential tail.
 * Everything that reads as a material is in these numbers.
 */
type ShotRecipe = {
  seconds: number
  /** Pole of the noise kept: nearer 1 is darker. */
  keep: number
  /** Pole of what is subtracted back out: nearer 1 removes only the rumble. */
  cut: number
  /** Seconds to full loudness, and the tail's time constant. */
  attack: number
  tail: number
  gain: number
  /** Baked micro-transients riding the noise: crinkle, latch, flap. */
  crackle?: number
}

const SHOTS: Record<Exclude<ShotName, 'thunder'>, ShotRecipe> = {
  /** A book landing: all low end, gone almost at once. */
  thud: { seconds: 0.12, keep: 0.965, cut: 0.998, attack: 0.003, tail: 0.035, gain: 6 },
  /** A page of paper: mid-band hiss that swells and settles. */
  swish: { seconds: 0.25, keep: 0.82, cut: 0.97, attack: 0.09, tail: 0.09, gain: 2.4 },
  /** A boot on boards: a short dry tap, a little bright. */
  'step-wood': { seconds: 0.06, keep: 0.9, cut: 0.985, attack: 0.002, tail: 0.016, gain: 3 },
  /** On grass: the same step with the tap softened into a scuff. */
  'step-grass': { seconds: 0.15, keep: 0.94, cut: 0.995, attack: 0.03, tail: 0.05, gain: 3 },
  /** On sand: softer again, and grittier — more of the hiss kept. */
  'step-sand': { seconds: 0.17, keep: 0.7, cut: 0.98, attack: 0.035, tail: 0.055, gain: 1.4 },
  /** On stone: the wood tap with a harder edge and a touch of ring. */
  'step-stone': { seconds: 0.07, keep: 0.84, cut: 0.98, attack: 0.001, tail: 0.022, gain: 3.2 },
  /** A switch: one dry tick, over before it began. */
  click: { seconds: 0.03, keep: 0.6, cut: 0.9, attack: 0.001, tail: 0.006, gain: 2.2 },
  /** Paper handled: the page's swish with crinkle baked over it. */
  rustle: { seconds: 0.3, keep: 0.82, cut: 0.965, attack: 0.04, tail: 0.1, gain: 1.8, crackle: 22 },
  /** A book pushed along boards: the slow attack is the friction swelling. */
  slide: { seconds: 0.24, keep: 0.93, cut: 0.99, attack: 0.08, tail: 0.055, gain: 2.4 },
  /** A door swept open: all wood and moved air. */
  'door-open': { seconds: 0.4, keep: 0.955, cut: 0.996, attack: 0.14, tail: 0.12, gain: 3 },
  /** Shut: a firm clunk, the few crackles its latch. */
  'door-close': {
    seconds: 0.13,
    keep: 0.95,
    cut: 0.997,
    attack: 0.002,
    tail: 0.035,
    gain: 5.5,
    crackle: 3,
  },
  /** Cardboard: a hollow scuff with the flap's crinkle on it. */
  cardboard: { seconds: 0.2, keep: 0.9, cut: 0.987, attack: 0.02, tail: 0.06, gain: 2.4, crackle: 10 },
}

function makeShot(ctx: AudioContext, recipe: ShotRecipe): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * recipe.seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let kept = 0
  let cut = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    kept = kept * recipe.keep + white * (1 - recipe.keep)
    cut = cut * recipe.cut + white * (1 - recipe.cut)
    const t = i / ctx.sampleRate
    const env = Math.min(1, t / recipe.attack) * Math.exp(-t / recipe.tail)
    data[i] = (kept - cut) * env * recipe.gain
  }
  // The crackle: the fire's pops in miniature — what turns smooth noise into
  // paper crinkling or a latch snapping home.
  for (let c = 0; c < (recipe.crackle ?? 0); c++) {
    const at = Math.floor(Math.random() * Math.max(1, length - 40))
    const loudness = (0.25 + Math.random() * 0.4) * recipe.gain * 0.12
    const tail = 8 + Math.floor(Math.random() * 22)
    const sign = Math.random() > 0.5 ? 1 : -1
    for (let i = 0; i < tail && at + i < length; i++) {
      data[at + i]! += sign * loudness * Math.exp((-4 * i) / tail) * (Math.random() * 2 - 1)
    }
  }
  return buffer
}

/**
 * Distant thunder: at this range only the rumble arrives, so it is the shot
 * machinery's noise slowed right down — energy at 20 to 90 Hz — under a slow
 * attack and a long tail, with a few baked swells for the rolling. Fired at a
 * random rate and loudness by the mixer, so one cached buffer never plays the
 * same strike twice.
 */
function makeThunder(ctx: AudioContext): AudioBuffer {
  const seconds = 3.2
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rolls = Array.from({ length: 3 }, () => ({
    at: 0.5 + Math.random() * 2,
    height: 0.4 + Math.random() * 0.5,
    width: 0.2 + Math.random() * 0.4,
  }))
  let kept = 0
  let cut = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    kept = kept * 0.9965 + white * 0.0035
    cut = cut * 0.9996 + white * 0.0004
    const t = i / ctx.sampleRate
    let env = Math.min(1, t / 0.3) * Math.exp(-t / 1.1)
    for (const roll of rolls) {
      const away = Math.abs(t - roll.at) / roll.width
      if (away < 1) env *= 1 + roll.height * (0.5 + 0.5 * Math.cos(Math.PI * away))
    }
    data[i] = (kept - cut) * env * 9
  }
  return buffer
}

/** The shots too shaped for the recipe table, baked by hand instead. */
const SPECIAL: Partial<Record<ShotName, (ctx: AudioContext) => AudioBuffer>> = {
  thunder: makeThunder,
}

/**
 * Fire one short sound — a footfall, a landed book, a turned page — at
 * `loudness`, 0 to 1, scaled here by the master and Small Sounds sliders so no
 * call site can forget the bus. A zero level never opens the context, the same
 * bargain `placeLoop` makes. `rate` bends the cached buffer's pitch — cheap
 * variety with nothing rebaked — and `rain` moves the shot onto the Rain
 * slider: thunder is the rain, and silencing one silences the other.
 */
export function playOneShot(
  name: ShotName,
  loudness = 1,
  opts?: { rate?: number; rain?: boolean },
) {
  const settings = useSettings.getState()
  const bus = opts?.rain ? settings.rainVolume : settings.ambientVolume
  const level = clamp(loudness, 0, 1) * settings.volume * bus
  if (level <= 0) return
  const ctx = ensure()
  if (!ctx) return
  try {
    let buffer = shots.get(name)
    if (!buffer) {
      const special = SPECIAL[name]
      // The cast is safe: SPECIAL covers exactly the names SHOTS lacks.
      buffer = special ? special(ctx) : makeShot(ctx, SHOTS[name as Exclude<ShotName, 'thunder'>])
      shots.set(name, buffer)
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    if (opts?.rate) source.playbackRate.value = opts.rate
    const gain = ctx.createGain()
    gain.gain.value = level
    source.connect(gain)
    gain.connect(ctx.destination)
    source.onended = () => {
      liveShots = Math.max(0, liveShots - 1)
      try {
        gain.disconnect()
      } catch {
        /* an already-collected graph needs nothing */
      }
      closeIfIdle()
    }
    source.start()
    liveShots += 1
  } catch {
    /* silence, like every failure here */
  }
}

/**
 * A chorus is the third kind of sound here: not a loop — a repeated melodic
 * phrase is picked out in a minute, unlike fire pops — and not one shot but a
 * scheduler, synthesising a fresh phrase every so often and sleeping between.
 * The timers run off the frame loop entirely, so a slow renderer never thins
 * the dawn chorus.
 */
type ChorusName = 'birds' | 'crickets'

type Chorus = { level: number; timer: ReturnType<typeof setTimeout> | null }

const choruses = new Map<ChorusName, Chorus>()

/**
 * Set one chorus's level, 0 to 1. Zero on a chorus that never started stays
 * silent for free, the loops' bargain; the level is re-read at each firing, so
 * dusk shows up phrase by phrase rather than at the next scheduling.
 */
export function placeChorus(name: ChorusName, volume: number) {
  const level = clamp(volume, 0, 1)
  const live = choruses.get(name)
  if (level <= 0) {
    if (!live) return
    if (live.timer !== null) clearTimeout(live.timer)
    choruses.delete(name)
    closeIfIdle()
    return
  }
  if (live) {
    live.level = level
    return
  }
  const entry: Chorus = { level, timer: null }
  choruses.set(name, entry)
  scheduleChorus(name, entry)
}

/** Every chorus off — the scene unmounted. */
export function stopAllChoruses() {
  for (const name of [...choruses.keys()]) placeChorus(name, 0)
}

function scheduleChorus(name: ChorusName, entry: Chorus) {
  const wait = name === 'birds' ? 3_500 + Math.random() * 8_500 : 700 + Math.random() * 2_100
  entry.timer = setTimeout(() => {
    // A stale timer — the chorus was stopped and restarted — must not double up.
    if (choruses.get(name) !== entry) return
    if (name === 'birds') singBird(entry.level)
    else chirpCricket(entry.level)
    scheduleChorus(name, entry)
  }, wait)
}

/**
 * One bird phrase: a few sine notes, each sliding up or down as it decays, at
 * a pitch and a place drawn fresh every time — no two phrases alike, which is
 * what keeps synthesised birds from reading as a ringtone.
 */
function singBird(level: number) {
  const ctx = ensure()
  if (!ctx || level <= 0) return
  try {
    const out = ctx.createGain()
    out.gain.value = 1
    try {
      const pan = ctx.createStereoPanner()
      pan.pan.value = (Math.random() * 2 - 1) * 0.7
      out.connect(pan)
      pan.connect(ctx.destination)
    } catch {
      out.connect(ctx.destination)
    }
    const detune = 0.85 + Math.random() * 0.35
    const notes = 2 + Math.floor(Math.random() * 3)
    let at = ctx.currentTime + 0.02
    let last: OscillatorNode | null = null
    for (let n = 0; n < notes; n++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const f0 = (2300 + Math.random() * 1800) * detune
      const length = 0.06 + Math.random() * 0.07
      osc.frequency.setValueAtTime(f0, at)
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.75 + Math.random() * 0.5), at + length)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(level, at + 0.006)
      gain.gain.setTargetAtTime(0, at + length * 0.5, 0.05)
      osc.connect(gain)
      gain.connect(out)
      osc.start(at)
      osc.stop(at + length + 0.3)
      last = osc
      at += length + 0.05 + Math.random() * 0.09
    }
    if (!last) return
    // One phrase counts as one live shot: the context must not close mid-song.
    liveShots += 1
    last.onended = () => {
      liveShots = Math.max(0, liveShots - 1)
      try {
        out.disconnect()
      } catch {
        /* an already-collected graph needs nothing */
      }
      closeIfIdle()
    }
  } catch {
    /* silence, like every failure here */
  }
}

/**
 * One cricket: a high carrier pulsed into syllables — the classic chirp train
 * — from a random direction, so one scheduler reads as a field of them.
 */
function chirpCricket(level: number) {
  const ctx = ensure()
  if (!ctx || level <= 0) return
  try {
    const osc = ctx.createOscillator()
    osc.frequency.value = 4300 * (0.92 + Math.random() * 0.16)
    const gain = ctx.createGain()
    gain.gain.value = 0
    const syllables = 4 + Math.floor(Math.random() * 3)
    const rate = 18 + Math.random() * 8
    const seconds = syllables / rate
    const steps = 128
    const curve = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const phase = (((i / (steps - 1)) * seconds * rate) % 1 + 1) % 1
      curve[i] = level * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
    }
    osc.connect(gain)
    try {
      const pan = ctx.createStereoPanner()
      pan.pan.value = (Math.random() * 2 - 1) * 0.8
      gain.connect(pan)
      pan.connect(ctx.destination)
    } catch {
      gain.connect(ctx.destination)
    }
    const at = ctx.currentTime + 0.02
    gain.gain.setValueCurveAtTime(curve, at, seconds)
    osc.start(at)
    osc.stop(at + seconds + 0.05)
    liveShots += 1
    osc.onended = () => {
      liveShots = Math.max(0, liveShots - 1)
      try {
        gain.disconnect()
      } catch {
        /* an already-collected graph needs nothing */
      }
      closeIfIdle()
    }
  } catch {
    /* silence, like every failure here */
  }
}
