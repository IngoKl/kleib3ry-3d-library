import { create } from 'zustand'
import { makeFader } from '../lib/mediaFade'
import { library } from '../services'
import type { IndexedTape } from '../services/types'

/**
 * The `video/` folder, and what is in the machine. Deliberately a near-copy of
 * `media.ts` rather than a generalisation: the two share a shape and almost
 * nothing else — a record plays on to the next side and a tape stops, one is an
 * `<audio>` element and one a `<video>` the scene hands to a texture. Folded
 * together they would be one store with a flag deciding which half applies.
 */

type VideoState = {
  tapes: IndexedTape[]
  loaded: boolean

  /** Tape id in the machine, running or paused. */
  playing: string | null
  paused: boolean
  /**
   * Which set it is in — the deck's own argument: several sets share the single
   * video element, so this tells the scene which screen the picture is on.
   */
  crt: string | null
  /**
   * Whether the tape has a decoded frame. Owned here rather than read off the
   * element, so the glass cannot see the readyState of the tape that just left.
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
 * One element, created on first use so a test that never switches the set on
 * allocates nothing. `crossOrigin` is the load-bearing setting: without it a
 * frame from the asset protocol taints the canvas the texture uploads through.
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

    // Pause, or let it run on. The store's flag rather than the element's,
    // because during the fade out the element has not paused yet.
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
