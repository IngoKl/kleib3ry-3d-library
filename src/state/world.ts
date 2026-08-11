import { create } from 'zustand'
import { library } from '../services'
import type { SavePaths } from '../services/types'
import { DEFAULT_WORLD_TEXT } from '../world/defaults'
import { deriveWorld, type DerivedWorld } from '../world/derive'
import { WorldError, parseWorldText } from '../world/schema'

/**
 * The world document, live.
 *
 * The contract that matters here is what happens when an edit is wrong: the
 * broken text is *not* applied, the world already on screen keeps running, and
 * the parse error is surfaced verbatim. You cannot lose a library by mistyping
 * in `library.json`, and you find out immediately rather than on next launch.
 */

/** How often the world file is checked for an edit, in milliseconds. */
const POLL_MS = 700

type WorldState = {
  world: DerivedWorld | null
  /** The text currently applied, so a poll can tell a real edit from a re-stat. */
  text: string | null
  loaded: boolean
  /** Why the last edit was rejected. Null when the live world is the file. */
  error: string | null
  paths: SavePaths | null
  /** Bumped whenever a new document is applied; the layout watches this. */
  revision: number

  load: () => Promise<void>
  /** Re-read the file and apply it if it parses. Returns true if it changed. */
  refresh: () => Promise<boolean>
  watch: () => () => void
}

export const useWorldStore = create<WorldState>((set, get) => {
  /** Parse and apply, or record why not. Never partially applies. */
  const apply = (text: string): boolean => {
    try {
      const world = deriveWorld(parseWorldText(text))
      set((state) => ({
        world,
        text,
        error: null,
        revision: state.revision + 1,
      }))
      return true
    } catch (e) {
      // Keep the running world exactly as it is. A half-loaded room is worse
      // than a stale one, and a stale one is worse than neither only if you are
      // not told — hence the error going straight to the panel.
      set({
        error:
          e instanceof WorldError
            ? `library.json — ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e),
      })
      return false
    }
  }

  return {
    world: null,
    text: null,
    loaded: false,
    error: null,
    paths: null,
    revision: 0,

    load: async () => {
      try {
        const paths = await library.savePaths().catch(() => null)
        set({ paths })

        let text = await library.loadWorld()
        if (text === null) {
          // First time in this folder: leave a starter document behind, so the
          // first thing you learn about the format is that it is already there.
          await library.writeDefaultWorld(DEFAULT_WORLD_TEXT)
          text = (await library.loadWorld()) ?? DEFAULT_WORLD_TEXT
        }

        if (!apply(text)) {
          // The file on disk is broken and there is nothing on screen yet, so
          // fall back to the default rather than leaving a black window. The
          // error stays visible; the file is not touched.
          const broken = get().error
          apply(DEFAULT_WORLD_TEXT)
          set({ error: broken })
        }
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
        if (!get().world) apply(DEFAULT_WORLD_TEXT)
      } finally {
        set({ loaded: true })
      }
    },

    refresh: async () => {
      const text = await library.loadWorld()
      if (text === null || text === get().text) return false
      return apply(text)
    },

    watch: () => {
      let stamp: string | null = null
      let stopped = false

      const tick = async () => {
        if (stopped) return
        try {
          const next = await library.worldStamp()
          if (next !== stamp) {
            stamp = next
            await get().refresh()
          }
        } catch {
          // A failed stat is not worth reporting; the next tick will retry.
        }
      }

      void tick()
      const timer = setInterval(() => void tick(), POLL_MS)
      return () => {
        stopped = true
        clearInterval(timer)
      }
    },
  }
})
