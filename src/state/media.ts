import { create } from 'zustand'
import { library } from '../services'
import type { IndexedArtwork, IndexedTrack } from '../services/types'

/**
 * The two folders that are not books: `music/` and `artwork/`.
 *
 * Playback is a single `HTMLAudioElement` rather than anything in the scene
 * graph, deliberately. Web Audio's `PositionalAudio` would let the record
 * player be quieter from the kitchen, which is a lovely idea and costs an
 * AudioContext that cannot be started without a gesture, a decode of the whole
 * file into memory, and a class of failure — a suspended context — that looks
 * exactly like a bug. An `<audio>` element streams, starts on the keypress that
 * asked for it, and its volume can still be faded with distance by the scene;
 * see `RecordPlayer`.
 */

type MediaState = {
  tracks: IndexedTrack[]
  artwork: IndexedArtwork[]
  loaded: boolean

  /** Track id currently on the deck, playing or paused. */
  playing: string | null
  paused: boolean
  /** Why the last attempt to play failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  /** Put a record on. Passing the one already on the deck toggles the pause. */
  play: (id: string) => void
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

export const useMediaStore = create<MediaState>((set, get) => ({
  tracks: [],
  artwork: [],
  loaded: false,
  playing: null,
  paused: false,
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

  play: (id) => {
    const track = get().trackAt(id)
    if (!track) return

    const player = audio()

    // The record already on the deck: lift the needle, or put it back down.
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
    if (element) {
      element.pause()
      element.removeAttribute('src')
    }
    set({ playing: null, paused: false })
  },

  next: () => {
    const { tracks, playing } = get()
    if (tracks.length === 0) return
    const at = tracks.findIndex((track) => track.id === playing)
    const following = tracks[(at + 1) % tracks.length]
    if (following) get().play(following.id)
  },

  setVolume: (volume) => {
    if (element) element.volume = Math.max(0, Math.min(1, volume))
  },
}))
