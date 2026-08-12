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
  /** Whether you can see your own body when you look down. */
  showBody: boolean
  /** Master volume for the record player and the television, 0 to 1. */
  volume: number
  /** How loud the rain is, on top of the master volume. 0 silences it. */
  rainVolume: number
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
}

export const DEFAULT_SETTINGS: Settings = {
  lowPerformance: false,
  showBody: true,
  volume: 0.8,
  rainVolume: 0.35,
  positionalAudio: true,
  sensitivity: 1,
  boxPerFolder: false,
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
      showBody: parsed.showBody ?? DEFAULT_SETTINGS.showBody,
      volume: clamp(parsed.volume ?? DEFAULT_SETTINGS.volume, 0, 1),
      rainVolume: clamp(parsed.rainVolume ?? DEFAULT_SETTINGS.rainVolume, 0, 1),
      positionalAudio: parsed.positionalAudio ?? DEFAULT_SETTINGS.positionalAudio,
      sensitivity: clamp(parsed.sensitivity ?? DEFAULT_SETTINGS.sensitivity, 0.2, 3),
      boxPerFolder: parsed.boxPerFolder ?? DEFAULT_SETTINGS.boxPerFolder,
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
        showBody: state.showBody,
        volume: state.volume,
        rainVolume: state.rainVolume,
        positionalAudio: state.positionalAudio,
        sensitivity: state.sensitivity,
        boxPerFolder: state.boxPerFolder,
      } satisfies Settings),
    )
  } catch {
    /* see above */
  }
}
