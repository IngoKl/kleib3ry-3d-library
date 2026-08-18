import { create } from 'zustand'
import { makeFader } from '../lib/mediaFade'
import { library } from '../services'
import type { IndexedArtwork, IndexedTrack } from '../services/types'
import { useAppStore } from './store'

/**
 * The two folders that are not books. Playback is one `HTMLAudioElement`: it
 * streams rather than decoding the file, starts on the keypress that asked for
 * it, and has no AudioContext to be suspended. See `audioRig.ts` for placement.
 */

type MediaState = {
  tracks: IndexedTrack[]
  artwork: IndexedArtwork[]
  loaded: boolean

  /** Track id currently on the deck, playing or paused. */
  playing: string | null
  paused: boolean
  /**
   * Which deck it is on. A building may have several sharing the single audio
   * element, so this is what tells the scene where the music comes from.
   */
  deck: string | null
  /** Why the last attempt to play failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  /** Put a record on. Passing the one already on the deck toggles the pause. */
  play: (id: string, deck?: string) => void
  stop: () => void
  /** The next record the room holds, so a side plays through rather than stopping. */
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
    // Without this, an element fetched cross-origin taints the graph — which
    // fails silently, as silence. The `<video>` element sets it for the same reason.
    element.crossOrigin = 'anonymous'
  }
  return element
}

/**
 * The one element the deck plays through. The store owns what is playing and the
 * scene owns where you stand relative to it, so handing over the element lets
 * the scene do its half without the store knowing rooms exist.
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

    // Lift the needle, or put it back down. The store's flag rather than the
    // element's, because during the fade the element has not paused yet.
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
    // A placeholder record points at nothing: say so in the panel rather than
    // throwing, and take it off the deck, or the HUD spins it forever.
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
    // In folder order, but only what the room can reach: a record no crate
    // holds cannot be the next side. The one on the deck counts regardless.
    const crates = useAppStore.getState().recordCrates
    const inRoom = tracks.filter(
      (track) => crates[track.id] !== undefined || track.id === playing,
    )
    if (inRoom.length === 0) return
    const at = inRoom.findIndex((track) => track.id === playing)
    const following = inRoom[(at + 1) % inRoom.length]
    // No deck passed: a side playing on by itself stays where it is. The lone
    // record does not restart either — `play` on it would lift the needle.
    if (following && following.id !== playing) get().play(following.id)
  },

  setVolume: (volume) => {
    const level = Math.max(0, Math.min(1, volume))
    // Mid-lift the fade owns the element; the new level lands where the fade
    // restores to, instead of being stepped over and then snapped back.
    if (fader.retarget(level)) return
    if (element) element.volume = level
  },
}))
