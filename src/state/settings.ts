import { create } from 'zustand'

/**
 * Settings: the things that are about *this machine and this person*, rather
 * than about the library.
 *
 * Which is exactly why they are not in the library folder. Whether your GPU can
 * carry a shadow pass, whether you like seeing your own legs, how loud the
 * record player is — none of that belongs in a folder you might sync to another
 * computer or hand to somebody else. It goes in `localStorage`, keyed by the
 * app rather than by the library, and it is available before any driver has
 * been asked a question: the main menu needs it, and the main menu comes up
 * before the world does.
 *
 * The room's own state — which lamps are on, whether it is night, whether it is
 * raining — is deliberately *not* here. That is a fact about the library and
 * lives in `ambience.json` beside it.
 */

export type ShadowQuality = 'off' | 'low' | 'high'
const SHADOW_QUALITIES: readonly ShadowQuality[] = ['off', 'low', 'high']
/** Pixels on a side, by name. `off` never reaches here. */
export const SHADOW_MAP_SIZE: Record<Exclude<ShadowQuality, 'off'>, number> = { low: 1024, high: 2048 }

const KEY = 'kleib3ry.settings'
/** Recent library folders, for the main menu. Also per-machine, also not a library fact. */
const RECENT_KEY = 'kleib3ry.recent'
const RECENT_LIMIT = 6

export type Settings = {
  /**
   * Everything that costs frames, off at once.
   *
   * One switch rather than six, because the person reaching for it is not
   * tuning a renderer — they have a laptop with an integrated GPU and the room
   * is stuttering. What it actually turns off is written down at each use site;
   * the rule is that nothing it changes may alter where anything *is*, so a
   * library looks the same shape on both settings.
   */
  lowPerformance: boolean
  /**
   * How many pixels are drawn per pixel of window — the most expensive number
   * in the app. Keep the cap at 1: a high-DPI panel at 2 is four times the
   * fragments, and those machines disproportionately have integrated GPUs.
   * Values below 1 are a genuine blur, offered because a soft 30 fps beats a
   * sharp 5.
   */
  resolutionScale: number
  /**
   * The sun's shadow map: off, or its resolution. `low` is 1024 and is the
   * default, because the pass is charged for the whole site either way — see
   * `Lighting`, where the frustum is now tied to where you are standing rather
   * than to the bounding box of every room in the document.
   */
  shadowQuality: 'off' | 'low' | 'high'
  /**
   * How many lamps may light the room at once.
   *
   * Three.js has no per-object light culling: every point light in the scene is
   * a term in every lit fragment's shader, whether it is next to you or in
   * another building. The default map declares nearly forty. This is the size
   * of the pool that stands in for them — see `scene/lightPool.ts`.
   */
  lightBudget: number
  /** Whether you can see your own body when you look down. */
  showBody: boolean
  /** Master volume for the record player and the television, 0 to 1. */
  volume: number
  /** How loud the rain is, on top of the master volume. 0 silences it. */
  rainVolume: number
  /**
   * The room's small noises — the fire's crackle, the cat's purr, the dust on
   * a record — on top of the master volume. 0 silences them.
   */
  ambientVolume: number
  /**
   * Whether sound is placed in the room — quieter from the kitchen, and off to
   * your left when the deck is. Off falls back to one volume everywhere, which
   * is what a browser does and what some audio stacks are happier with.
   */
  positionalAudio: boolean
  /** Mouse sensitivity, as a multiplier on the base rate. */
  sensitivity: number
  /**
   * Whether newly scanned books are boxed one folder per box, so a first scan
   * arrives pre-sorted by the folders under `books/`. A preference about how
   * *you* sort rather than a fact about the room, which is why it sits here
   * beside the mouse and not in the library folder.
   */
  boxPerFolder: boolean
  /**
   * Whether night in the room follows this machine's clock, so an evening
   * session arrives in an evening room. Here rather than in `ambience.json`
   * because the timezone is a machine fact — the same library opened on
   * another continent should follow *that* machine's evening.
   */
  matchClock: boolean
  /**
   * Whether a row with room in it leans back on the side panel the way a real
   * part-empty shelf does. Taste, not tidiness: some people want the shelf they
   * arranged to stand plumb. It changes how a row *looks*, never what is in it
   * or how much fits — see `packRow`.
   */
  booksLean: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  lowPerformance: false,
  // Deliberately not 2. A quarter over one pixel per pixel is the point where
  // the spine text stops looking soft; the rest of the way to 2 costs 60% more
  // fragments for a difference you have to go looking for.
  resolutionScale: 1.25,
  shadowQuality: 'low',
  lightBudget: 8,
  showBody: true,
  volume: 0.8,
  rainVolume: 0.35,
  ambientVolume: 1,
  positionalAudio: true,
  sensitivity: 1,
  boxPerFolder: false,
  matchClock: false,
  booksLean: true,
}

/**
 * The three dials as the renderer should actually read them.
 *
 * Low Performance Mode stays what it always was — everything that costs frames,
 * off at once — and is now expressed as a *floor* over the dials rather than as
 * a separate branch at each use site. One switch still works for the person who
 * is not tuning a renderer; the dials are there for the person who is, and the
 * two can never disagree because the floor always wins.
 */
export function effectiveQuality(s: Settings): {
  resolutionScale: number
  shadowQuality: ShadowQuality
  lightBudget: number
} {
  if (!s.lowPerformance) {
    return {
      resolutionScale: s.resolutionScale,
      shadowQuality: s.shadowQuality,
      lightBudget: s.lightBudget,
    }
  }
  return {
    resolutionScale: Math.min(1, s.resolutionScale),
    shadowQuality: 'off',
    lightBudget: Math.min(4, s.lightBudget),
  }
}

/** Whether this machine's clock says it is evening: before 7, or from 19:00. */
export function eveningNow(): boolean {
  const hour = new Date().getHours()
  return hour < 7 || hour >= 19
}

function read(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const stored = localStorage.getItem(KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(stored) as Partial<Settings>
    // Field by field rather than a spread of whatever was in there: a settings
    // file written by a newer build must not be able to introduce a key this
    // one will then write back and act on.
    return {
      lowPerformance: parsed.lowPerformance ?? DEFAULT_SETTINGS.lowPerformance,
      resolutionScale: clamp(parsed.resolutionScale ?? DEFAULT_SETTINGS.resolutionScale, 0.5, 2),
      shadowQuality: SHADOW_QUALITIES.includes(parsed.shadowQuality as ShadowQuality)
        ? (parsed.shadowQuality as ShadowQuality)
        : DEFAULT_SETTINGS.shadowQuality,
      lightBudget: clamp(parsed.lightBudget ?? DEFAULT_SETTINGS.lightBudget, 2, 32),
      showBody: parsed.showBody ?? DEFAULT_SETTINGS.showBody,
      volume: clamp(parsed.volume ?? DEFAULT_SETTINGS.volume, 0, 1),
      rainVolume: clamp(parsed.rainVolume ?? DEFAULT_SETTINGS.rainVolume, 0, 1),
      ambientVolume: clamp(parsed.ambientVolume ?? DEFAULT_SETTINGS.ambientVolume, 0, 1),
      positionalAudio: parsed.positionalAudio ?? DEFAULT_SETTINGS.positionalAudio,
      sensitivity: clamp(parsed.sensitivity ?? DEFAULT_SETTINGS.sensitivity, 0.2, 3),
      boxPerFolder: parsed.boxPerFolder ?? DEFAULT_SETTINGS.boxPerFolder,
      matchClock: parsed.matchClock ?? DEFAULT_SETTINGS.matchClock,
      booksLean: parsed.booksLean ?? DEFAULT_SETTINGS.booksLean,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const clamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low

/** Library folders opened before, most recent first. */
export function recentLibraries(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored = localStorage.getItem(RECENT_KEY)
    const parsed = stored ? (JSON.parse(stored) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function rememberLibrary(path: string) {
  if (typeof localStorage === 'undefined' || !path) return
  const next = [path, ...recentLibraries().filter((item) => item !== path)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // A full or disabled storage costs a convenience, not a library.
  }
}

export function forgetLibrary(path: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentLibraries().filter((i) => i !== path)))
  } catch {
    /* see above */
  }
}

type SettingsState = Settings & {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  reset: () => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...read(),

  set: (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>)
    persist(get())
  },

  reset: () => {
    set({ ...DEFAULT_SETTINGS })
    persist(DEFAULT_SETTINGS)
  },
}))

function persist(state: Settings) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        lowPerformance: state.lowPerformance,
        resolutionScale: state.resolutionScale,
        shadowQuality: state.shadowQuality,
        lightBudget: state.lightBudget,
        showBody: state.showBody,
        volume: state.volume,
        rainVolume: state.rainVolume,
        ambientVolume: state.ambientVolume,
        positionalAudio: state.positionalAudio,
        sensitivity: state.sensitivity,
        boxPerFolder: state.boxPerFolder,
        matchClock: state.matchClock,
        booksLean: state.booksLean,
      } satisfies Settings),
    )
  } catch {
    /* see above */
  }
}
