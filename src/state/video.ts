import { create } from 'zustand'
import { makeFader } from '../lib/mediaFade'
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
  /**
   * Which television it is in, by furniture id — the record player's `deck`,
   * for the same reason: a building may have more than one set, and they share
   * the single video element, so this is what tells the scene which screen the
   * picture is on. Null until a tape has gone in.
   */
  crt: string | null
  /**
   * Whether the tape has a decoded frame to show. Owned here, off the
   * element's own events, so the glass cannot read the readyState of the tape
   * that just came out and draw black.
   */
  ready: boolean
  /** Why the last attempt to play failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  /** Put a tape in. Passing the one already in the machine pauses or resumes it. */
  play: (id: string, crt?: string) => void
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
    // Readiness comes off the element itself, installed once here: a frame
    // arriving flips it on, the media failing or being torn down flips it off.
    element.addEventListener('loadeddata', () => useVideoStore.setState({ ready: true }))
    for (const gone of ['error', 'emptied'] as const) {
      element.addEventListener(gone, () => useVideoStore.setState({ ready: false }))
    }
  }
  return element
}

/** True if a frame has arrived, so the screen has something real to show. */
export function videoReady(): boolean {
  return element !== null && element.readyState >= 2 && !element.ended
}

/** The tape's stop — see `lib/mediaFade.ts` for why a pause is ramped. */
const fader = makeFader()

/** Whether the stop currently owns the element's volume — the scene checks. */
export const videoFading = fader.fading

export const useVideoStore = create<VideoState>((set, get) => ({
  tapes: [],
  loaded: false,
  playing: null,
  paused: false,
  crt: null,
  ready: false,
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

  play: (id, crt) => {
    const tape = get().tapeAt(id)
    if (!tape) return

    const player = videoElement()
    if (crt !== undefined) set({ crt })

    // The tape already in the machine: pause, or let it run on. The store's
    // flag rather than the element's, because during the fade out the element
    // has not paused yet.
    if (get().playing === id) {
      if (get().paused) {
        fader.cancelFade(player)
        void player.play().catch((e) => set({ error: String(e) }))
        set({ paused: false })
      } else {
        // Marked paused before the fade, so the scene stops placing the
        // element and the fade owns its volume.
        set({ paused: true })
        fader.fadeOutThen(player)
      }
      return
    }

    // A fade still running belongs to the tape coming out, not this one.
    fader.cancelFade(player)
    player.src = library.assetUrl(tape.path)
    player.currentTime = 0
    // A tape runs out and stops. It does not go on to the next one — nobody
    // has ever wanted the next tape in the box to start on its own.
    player.onended = () => set({ paused: true })
    // Not ready until THIS tape's first frame lands — the old one's does not count.
    set({ playing: id, paused: false, ready: false, error: null })

    void player.play().catch((e) => {
      if (get().playing !== id) return
      player.removeAttribute('src')
      set({
        playing: null,
        paused: false,
        crt: null,
        error: `cannot play ${tape.title} — ${e instanceof Error ? e.message : String(e)}`,
      })
    })
  },

  stop: () => {
    const player = element
    // Cleared first: the scene stops placing the element the moment `playing`
    // is null, which leaves the fade alone with the volume.
    set({ playing: null, paused: false, crt: null })
    if (!player) return
    // A tape ejected at its end can still finish during the fade, and the
    // ended handler would mark a machine with nothing in it paused.
    player.onended = null
    if (player.paused) {
      player.removeAttribute('src')
    } else {
      fader.fadeOutThen(player, () => player.removeAttribute('src'))
    }
  },

  setVolume: (volume) => {
    const level = Math.max(0, Math.min(1, volume))
    // Mid-stop the fade owns the element; the new level lands where the fade
    // restores to, instead of being stepped over and then snapped back.
    if (fader.retarget(level)) return
    if (element) element.volume = level
  },
}))
