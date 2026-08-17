import { create } from 'zustand'
import { makeFader } from '../lib/mediaFade'
import { library } from '../services'
import type { IndexedArtwork, IndexedTrack } from '../services/types'

/**
 * The two folders that are not books: `music/` and `artwork/`.
 *
 * Playback is one `HTMLAudioElement`. It streams rather than decoding the whole
 * file, starts on the keypress that asked for it, and has no AudioContext to be
 * suspended; the scene still places it in the room — see `audioRig.ts`.
 */

type MediaState = {
  tracks: IndexedTrack[]
  artwork: IndexedArtwork[]
  loaded: boolean

  /** Track id currently on the deck, playing or paused. */
  playing: string | null
  paused: boolean
  /**
   * Which record player it is on, by furniture id.
   *
   * There can be more than one deck in a building — the cabin has one in the
   * great room and one in the bathroom — and they share the single audio
   * element, so this is what tells the scene where in the house the music is
   * coming from. Null until something has been put on.
   */
  deck: string | null
  /** Why the last attempt to play failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  /** Put a record on. Passing the one already on the deck toggles the pause. */
  play: (id: string, deck?: string) => void
  stop: () => void
  /** Next record in shelf order, so a side plays through rather than stopping. */
  next: () => void
  trackAt: (id: string) => IndexedTrack | undefined
  /** Volume, 0 to 1. The scene turns it down as you walk away from the deck. */
  setVolume: (volume: number) => void
}

let element: HTMLAudioElement | null = null

/** One element, created on first use so nothing is allocated in a test run. */
function audio(): HTMLAudioElement {
  if (!element) {
    element = new Audio()
    element.preload = 'none'
    // Web Audio draws frames of a media element through a graph, and an element
    // fetched cross-origin without this taints it — which fails silently, as
    // silence. The same reason the `<video>` element sets it.
    element.crossOrigin = 'anonymous'
  }
  return element
}

/**
 * The one element the deck plays through, for the scene to place in the room.
 *
 * Exported alongside `setVolume` rather than instead of it: the store owns *what*
 * is playing, and the scene owns *where you are standing relative to it*. Handing
 * the scene the element is what lets it do the second without the store having to
 * know that rooms exist.
 */
export const musicElement = audio

/** The needle's lift — see `lib/mediaFade.ts` for why a pause is ramped. */
const fader = makeFader()

/** Whether the lift currently owns the element's volume — the scene checks. */
export const musicFading = fader.fading

export const useMediaStore = create<MediaState>((set, get) => ({
  tracks: [],
  artwork: [],
  loaded: false,
  playing: null,
  paused: false,
  deck: null,
  error: null,

  load: async () => {
    try {
      const [tracks, artwork] = await Promise.all([library.listTracks(), library.listArtwork()])
      set({ tracks, artwork, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
    }
  },

  trackAt: (id) => get().tracks.find((track) => track.id === id),

  play: (id, deck) => {
    const track = get().trackAt(id)
    if (!track) return

    const player = audio()
    if (deck !== undefined) set({ deck })

    // The record already on the deck: lift the needle, or put it back down.
    // The store's flag rather than the element's, because during the lift's
    // fade the element has not paused yet.
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

    // A fade still running belongs to the record coming off, not this one.
    fader.cancelFade(player)
    player.src = library.assetUrl(track.path)
    player.currentTime = 0
    player.onended = () => get().next()
    set({ playing: id, paused: false, error: null })
    // A placeholder record in the browser build points at nothing. Say so in
    // the panel rather than throwing an unhandled rejection into the console —
    // and take the record off the deck again, or the HUD shows it spinning
    // forever on a playback that never started.
    void player.play().catch((e) => {
      if (get().playing !== id) return
      player.removeAttribute('src')
      set({
        playing: null,
        paused: false,
        error: `cannot play ${track.title} — ${e instanceof Error ? e.message : String(e)}`,
      })
    })
  },

  stop: () => {
    const player = element
    // Cleared first: the scene stops placing the element the moment `playing`
    // is null, which leaves the fade alone with the volume.
    set({ playing: null, paused: false, deck: null })
    if (!player) return
    // A record stopped in its run-out groove can end during the fade, and an
    // ended handler still wired would put the next one on.
    player.onended = null
    if (player.paused) {
      player.removeAttribute('src')
    } else {
      fader.fadeOutThen(player, () => player.removeAttribute('src'))
    }
  },

  next: () => {
    // A needle lifted in the run-out groove stays lifted: the element plays on
    // under the pause fade, and its ending must not start the next side.
    if (get().paused) return
    const { tracks, playing } = get()
    if (tracks.length === 0) return
    const at = tracks.findIndex((track) => track.id === playing)
    const following = tracks[(at + 1) % tracks.length]
    // No deck passed: a side playing on by itself stays on the deck it is on.
    if (following) get().play(following.id)
  },

  setVolume: (volume) => {
    const level = Math.max(0, Math.min(1, volume))
    // Mid-lift the fade owns the element; the new level lands where the fade
    // restores to, instead of being stepped over and then snapped back.
    if (fader.retarget(level)) return
    if (element) element.volume = level
  },
}))
