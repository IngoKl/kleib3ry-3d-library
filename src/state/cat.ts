/**
 * The cat.
 *
 * A plain mutable object rather than a zustand store, for the same reason
 * `player.ts` is one: it changes every frame, and a React render per frame for
 * an animal wandering about the room would cost more than everything else in
 * the building put together. What the UI needs to know — is it under the
 * crosshair, is it purring — goes through the app store, which changes rarely.
 *
 * The behaviour lives in `scene/Cat.tsx`, next to the walking; this is only what
 * it is doing and where.
 */

export type CatMood =
  /** Wandering between rooms on its own business. */
  | 'roam'
  /** Called, and on its way to you. */
  | 'come'
  /** Sitting. What it does after arriving, and after being petted. */
  | 'sit'
  /** Asked for a book, and on its way to a shelf to get one. */
  | 'fetch'
  /** Carrying a book back to you. */
  | 'deliver'
  /** Asleep, which is most of what a cat does. */
  | 'sleep'

export type Cat = {
  x: number
  z: number
  /** The floor it is standing on. */
  floor: number
  /** Radians. The way it is facing. */
  yaw: number
  mood: CatMood
  /** Where it is heading, in world metres, or null when it is not heading anywhere. */
  targetX: number
  targetZ: number
  /** Seconds left of whatever it is doing before it decides again. */
  patience: number
  /** How fast it is actually moving, for the walk cycle. */
  speed: number
  /** 0 to 1. Fades after a fuss; drives the tail and the HUD. */
  purr: number
  /** Book id in its mouth, or null. */
  carrying: string | null
  /** Shelf id it is going to, while fetching. */
  fetchingFrom: string | null
  /** How long it has been failing to get anywhere, so it can give up gracefully. */
  stuck: number
  /** True once the world has been up long enough to put it somewhere sensible. */
  placed: boolean
}

export const cat: Cat = {
  x: 0,
  z: 0,
  floor: 0,
  yaw: 0,
  mood: 'roam',
  targetX: 0,
  targetZ: 0,
  patience: 0,
  speed: 0,
  purr: 0,
  carrying: null,
  fetchingFrom: null,
  stuck: 0,
  placed: false,
}

/** How near you have to be for the cat to be worth pointing at. */
export const CAT_REACH = 2.2
