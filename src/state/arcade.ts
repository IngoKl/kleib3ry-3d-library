import { create } from 'zustand'
import { createChip8, type Chip8 } from '../arcade/chip8'
import { library } from '../services'
import type { IndexedRom } from '../services/types'

/**
 * The `roms/` folder, and what is in the machine. A near-copy of `video.ts` for
 * the reason that is a near-copy of `media.ts`: the shape is shared and nothing
 * else — a tape streams, a ROM is a few hundred bytes computed with sixty times
 * a second.
 *
 * Which is why the running machine is a module-level mutable object like
 * `player.ts`, and the store keeps only what the HUD cares about.
 */

type ArcadeState = {
  roms: IndexedRom[]
  loaded: boolean

  /** ROM id in the machine, powered and running. */
  inserted: string | null
  /** Why the last boot failed, for the HUD. */
  error: string | null

  load: () => Promise<void>
  romAt: (id: string) => IndexedRom | undefined
  /** Slot a cartridge: fetch its bytes and boot the machine on them. */
  insert: (id: string) => Promise<void>
  /** Take the cartridge back out. The screen goes dark. */
  eject: () => void
}

let machine: Chip8 | null = null
/** Guards a slow readRom against an eject or a second insert overtaking it. */
let bootToken = 0

/** The live machine, for the scene to step and paint. Null when empty. */
export function arcadeMachine(): Chip8 | null {
  return machine
}

export const useArcadeStore = create<ArcadeState>((set, get) => ({
  roms: [],
  loaded: false,
  inserted: null,
  error: null,

  load: async () => {
    try {
      const roms = await library.listRoms()
      set({ roms, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
    }
  },

  romAt: (id) => get().roms.find((rom) => rom.id === id),

  insert: async (id) => {
    const rom = get().romAt(id)
    if (!rom) return

    const token = ++bootToken
    try {
      const bytes = await library.readRom(id)
      if (token !== bootToken) return
      machine = createChip8(bytes)
      set({ inserted: id, error: null })
    } catch (e) {
      if (token !== bootToken) return
      machine = null
      set({
        inserted: null,
        error: `cannot start ${rom.title} — ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  },

  eject: () => {
    bootToken += 1
    machine = null
    set({ inserted: null })
  },
}))
