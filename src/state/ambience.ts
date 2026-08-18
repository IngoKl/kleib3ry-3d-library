import { create } from 'zustand'
import { library } from '../services'
import { eveningNow, useSettings } from './settings'
import type { AmbienceState } from '../services/types'

/**
 * Which lamps are on, whether it is night, whether it is raining — facts about
 * the room, saved beside the layout. Lamps are keyed by furniture id, so one
 * taken out of `library.json` stops being remembered, and the document's `"on"`
 * is only an initial state: flipping a switch must not reformat a hand-edited
 * file. Deleting this restores every light and a dry day.
 */

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
        // "Match the Clock": an evening session arrives in an evening room. Not
        // saved, so the file keeps what was chosen by hand and N still works.
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
