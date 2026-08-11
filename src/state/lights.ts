import { create } from 'zustand'
import { library } from '../services'
import type { LightState } from '../services/types'

/**
 * Which lamps are on.
 *
 * Saved beside the layout, in `.library/lights.json`, and keyed by furniture id
 * — so a lamp you switch off stays off across launches, and a lamp taken out of
 * `library.json` stops being remembered as soon as nothing refers to it. The
 * document's `"on"` is the *initial* state and nothing writes back over it:
 * `library.json` is yours, and flipping a switch should not reformat it.
 *
 * The file is deliberately trivial to reason about. Delete it and every light
 * goes back to whatever the document says, which is a repair anyone can
 * perform without knowing what a schema is.
 */

export const LIGHT_SCHEMA_VERSION = 1

const SAVE_DEBOUNCE_MS = 400

type LightsState = {
  /** Only the lamps whose state differs from what the document asked for. */
  on: Record<string, boolean>
  /**
   * Whether it is night outside. Saved with the lamps because it is the same
   * kind of fact — how the room is lit right now — and deleting `lights.json`
   * should bring the daylight back along with every lamp.
   */
  night: boolean
  loaded: boolean
  load: () => Promise<void>
  /** Flip one lamp. Returns whether it is now lit. */
  toggle: (id: string, defaultOn: boolean) => boolean
  /** Day to night and back. Returns whether it is now night. */
  toggleNight: () => boolean
  /** Turn everything in the library off, or back on. */
  setAll: (ids: readonly string[], on: boolean) => void
  isOn: (id: string, defaultOn: boolean) => boolean
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let runSave: (() => void) | null = null

export const useLightStore = create<LightsState>((set, get) => {
  const saveNow = () => {
    const document: LightState = {
      schemaVersion: LIGHT_SCHEMA_VERSION,
      on: get().on,
      night: get().night,
    }
    // A light that will not save is not worth interrupting anybody over; the
    // room is still lit the way they asked for this session.
    void library.saveLights(document).catch(() => {})
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
    loaded: false,

    load: async () => {
      try {
        const saved = await library.loadLights()
        set({ on: saved?.on ?? {}, night: saved?.night ?? false, loaded: true })
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
