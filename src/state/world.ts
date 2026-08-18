import { create } from 'zustand'
import { library } from '../services'
import type { SavePaths } from '../services/types'
import { DEFAULT_WORLD_TEXT } from '../world/defaults'
import {
  deriveWorld,
  type BoxEdits,
  type DerivedWorld,
  type FurnitureOverride,
} from '../world/derive'
import { WorldError, parseWorldText } from '../world/schema'

/**
 * The world document, live. The contract that matters is what happens when an
 * edit is wrong: the broken text is not applied, the running world is left
 * alone, and the parse error is surfaced verbatim — so you cannot lose a library
 * by mistyping, and you find out at once rather than on next launch.
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
  /**
   * Where furniture has been shoved to. Here rather than in `library.json`
   * because that is a file a person wrote: pushing a box must not rewrite their
   * comments. The book layout owns the persistence; this owns the effect.
   */
  placements: Record<string, FurnitureOverride>
  /** Boxes made off the stack or broken down, persisted by the layout like the placements. */
  boxEdits: BoxEdits

  load: () => Promise<void>
  /** Re-read the file and apply it if it parses. Returns true if it changed. */
  refresh: () => Promise<boolean>
  /** Re-derive with a new set of furniture overrides. */
  setPlacements: (placements: Record<string, FurnitureOverride>) => void
  /** Re-derive with a new set of spawned and broken-down boxes. */
  setBoxEdits: (boxEdits: BoxEdits) => void
  watch: () => () => void
}

export const useWorldStore = create<WorldState>((set, get) => {
  /** Parse and apply, or record why not. Never partially applies. */
  const apply = (text: string): boolean => {
    try {
      const world = deriveWorld(parseWorldText(text), get().placements, get().boxEdits)
      set((state) => ({
        world,
        text,
        error: null,
        revision: state.revision + 1,
      }))
      return true
    } catch (e) {
      // Keep the running world exactly as it is: a half-loaded room is worse
      // than a stale one, and the error goes straight to the panel.
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
    placements: {},
    boxEdits: {},

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
          // Broken on disk with nothing on screen yet: fall back to the default
          // rather than a black window. The error stays; the file is untouched.
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

    setPlacements: (placements) => {
      const text = get().text
      set({ placements })
      // Re-derive from the same text: a shoved box changes where things are,
      // not what the document says, and the document is still the only source.
      if (text !== null) {
        set({ world: deriveWorld(parseWorldText(text), placements, get().boxEdits) })
        set((state) => ({ revision: state.revision + 1 }))
      }
    },

    setBoxEdits: (boxEdits) => {
      const text = get().text
      set({ boxEdits })
      if (text !== null) {
        set({ world: deriveWorld(parseWorldText(text), get().placements, boxEdits) })
        set((state) => ({ revision: state.revision + 1 }))
      }
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
