import { create } from 'zustand'
import { library } from '../services'
import { eveningNow, useSettings } from './settings'
import type { AmbienceState } from '../services/types'

/**
 * How the room is right now: which lamps are on, whether it is night, whether
 * it is raining.
 *
 * Saved beside the layout, in `.library/ambience.json`, with the lamps keyed by
 * furniture id — so a lamp you switch off stays off across launches, and a lamp
 * taken out of `library.json` stops being remembered as soon as nothing refers
 * to it. The document's `"on"` is the *initial* state and nothing writes back
 * over it: `library.json` is yours, and flipping a switch should not reformat
 * it.
 *
 * The three live in one file because they are one kind of fact — the weather is
 * not a setting any more than the evening is — and because the whole file is
 * deliberately trivial to reason about. Delete it and you get every light back
 * on and a dry afternoon, which is a repair anyone can perform without knowing
 * what a schema is.
 */

export const AMBIENCE_SCHEMA_VERSION = 1

const SAVE_DEBOUNCE_MS = 400

type AmbienceStore = {
  /** Only the lamps whose state differs from what the document asked for. */
  on: Record<string, boolean>
  /** Whether it is night outside. */
  night: boolean
  /** Whether it is raining. */
  rain: boolean
  loaded: boolean
  load: () => Promise<void>
  /** Flip one lamp. Returns whether it is now lit. */
  toggle: (id: string, defaultOn: boolean) => boolean
  /** Day to night and back. Returns whether it is now night. */
  toggleNight: () => boolean
  /** Rain on and off. Returns whether it is now raining. */
  toggleRain: () => boolean
  /** Turn everything in the library off, or back on. */
  setAll: (ids: readonly string[], on: boolean) => void
  isOn: (id: string, defaultOn: boolean) => boolean
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let runSave: (() => void) | null = null

export const useAmbienceStore = create<AmbienceStore>((set, get) => {
  const saveNow = () => {
    const document: AmbienceState = {
      schemaVersion: AMBIENCE_SCHEMA_VERSION,
      on: get().on,
      night: get().night,
      rain: get().rain,
    }
    // An evening that will not save is not worth interrupting anybody over; the
    // room is still the way they asked for it this session.
    void library.saveAmbience(document).catch(() => {})
  }
  runSave = saveNow

  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    on: {},
    night: false,
    rain: false,
    loaded: false,

    load: async () => {
      try {
        const saved = await library.loadAmbience()
        // "Match the Clock": an evening session arrives in an evening room.
        // The derived value is not saved — the file keeps what was chosen by
        // hand, and N still works for the rest of the session.
        const match = useSettings.getState().matchClock
        set({
          on: saved?.on ?? {},
          night: match ? eveningNow() : (saved?.night ?? false),
          rain: saved?.rain ?? false,
          loaded: true,
        })
      } catch {
        set({ loaded: true })
      }
    },

    isOn: (id, defaultOn) => get().on[id] ?? defaultOn,

    toggleNight: () => {
      const next = !get().night
      set({ night: next })
      scheduleSave()
      return next
    },

    toggleRain: () => {
      const next = !get().rain
      set({ rain: next })
      scheduleSave()
      return next
    },

    toggle: (id, defaultOn) => {
      const next = !(get().on[id] ?? defaultOn)
      set({ on: { ...get().on, [id]: next } })
      scheduleSave()
      return next
    },

    setAll: (ids, on) => {
      const next = { ...get().on }
      for (const id of ids) next[id] = on
      set({ on: next })
      scheduleSave()
    },
  }
})

// A lamp flipped just before closing the window should still be flipped on the
// next launch; the debounce must not be a window that loses it.
if (typeof window !== 'undefined') {
  const flush = () => {
    if (saveTimer === undefined) return
    clearTimeout(saveTimer)
    saveTimer = undefined
    runSave?.()
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
}
