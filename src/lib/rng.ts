/**
 * Small deterministic PRNG. Every generated thing in the scene — floor grain,
 * book sizes, spine colours — runs off a seed so the room is identical on every
 * load and screenshots are comparable between runs.
 */
export function mulberry32(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Random = ReturnType<typeof mulberry32>

export const between = (random: Random, min: number, max: number) =>
  min + random() * (max - min)

export const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!
