import { create } from 'zustand'
import { library } from '../services'
import type { IndexedTape } from '../services/types'

/**
 * The `video/` folder, and what is in the machine.
 *
 * Deliberately a near-copy of `media.ts` rather than a generalisation of it. The
 * two stores share a shape — a list from a folder, one thing playing, an error
 * to report — and almost nothing else: a record plays through to the next one on
 * the shelf, a tape stops at the end because that is what a tape does; a record
 * is an `<audio>` element, a tape is a `<video>` element the scene has to hand
 * to a texture. Folding them together would mean a store that is half about
 * sound and half about a texture, with a flag deciding which.
 *
 * Playback is a single `HTMLVideoElement`, for the same reasons the record
 * player is a single `HTMLAudioElement`: it streams rather than decoding a
 * gigabyte into memory, it starts on the keypress that asked for it, and it has
 * no AudioContext to be mysteriously suspended.
 */

type VideoState = {
  tapes: IndexedTape[]
  loaded: boolean

  /** Tape id in the machine, running or paused. */
  playing: string | null
  paused: boolean
  /** Why the last attempt to play failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  /** Put a tape in. Passing the one already in the machine pauses or resumes it. */
  play: (id: string) => void
  /** Eject. The screen goes back to static. */
  stop: () => void
  tapeAt: (id: string) => IndexedTape | undefined
  /** Volume, 0 to 1. The scene turns it down as you walk away from the set. */
  setVolume: (volume: number) => void
}

let element: HTMLVideoElement | null = null

/**
 * One element, created on first use so nothing is allocated in a test run that
 * never turns the television on.
 *
 * `playsInline` and `muted: false` are the defaults we want, but `crossOrigin`
 * is the load-bearing one: without it a frame drawn from the asset protocol
 * taints the canvas the texture is uploaded through.
 */
export function videoElement(): HTMLVideoElement {
  if (!element) {
    element = document.createElement('video')
    element.preload = 'none'
    element.crossOrigin = 'anonymous'
    element.playsInline = true
    // Never in the document: the only thing that ever shows a frame of it is a
    // texture on the front of a cathode-ray tube.
    element.style.display = 'none'
  }
  return element
}

/** True if a frame has arrived, so the screen has something real to show. */
export function videoReady(): boolean {
  return element !== null && element.readyState >= 2 && !element.ended
}

export const useVideoStore = create<VideoState>((set, get) => ({
  tapes: [],
  loaded: false,
  playing: null,
  paused: false,
  error: null,

  load: async () => {
    try {
      const tapes = await library.listTapes()
      set({ tapes, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
    }
  },

  tapeAt: (id) => get().tapes.find((tape) => tape.id === id),

  play: (id) => {
    const tape = get().tapeAt(id)
    if (!tape) return

    const player = videoElement()

    // The tape already in the machine: pause, or let it run on.
    if (get().playing === id) {
      if (player.paused) {
        void player.play().catch((e) => set({ error: String(e) }))
        set({ paused: false })
      } else {
        player.pause()
        set({ paused: true })
      }
      return
    }

    player.src = library.assetUrl(tape.path)
    player.currentTime = 0
    // A tape runs out and stops. It does not go on to the next one — nobody
    // has ever wanted the next tape in the box to start on its own.
    player.onended = () => set({ paused: true })
    set({ playing: id, paused: false, error: null })

    void player.play().catch((e) => {
      if (get().playing !== id) return
      player.removeAttribute('src')
      set({
        playing: null,
        paused: false,
        error: `cannot play ${tape.title} — ${e instanceof Error ? e.message : String(e)}`,
      })
    })
  },

  stop: () => {
    if (element) {
      element.pause()
      element.removeAttribute('src')
    }
    set({ playing: null, paused: false })
  },

  setVolume: (volume) => {
    if (element) element.volume = Math.max(0, Math.min(1, volume))
  },
}))
