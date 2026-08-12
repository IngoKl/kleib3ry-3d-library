import * as THREE from 'three'
import { approach } from '../lib/ease'

/**
 * Day fading into night rather than switching to it.
 *
 * `N` and `K` flip booleans in the ambience store, and everything that colours
 * the world — the sky, the fog, the lights, the lake — used to read them as
 * ternaries, so the whole valley changed in a single frame. This module holds
 * the *blended* position between those states: two values easing towards
 * whatever the store says, advanced once per frame by `Outside` (the one
 * component that is always mounted with the world) and read by everyone else in
 * their own `useFrame`. A reader being a frame behind the advance is invisible;
 * two writers advancing it would double the speed, which is why there is
 * exactly one.
 *
 * It lives outside zustand for the same reason `state/player.ts` does: it
 * changes every frame of a transition and must not trigger React renders.
 */
export const ambienceBlend = {
  /** 0 is day, 1 is night. */
  night: 0,
  /** 0 is dry, 1 is raining. */
  rain: 0,
}

/** How many e-foldings a second: the fade settles in about two seconds. */
const RATE = 2.2

/** Advance towards the store's booleans. Returns true while anything moved. */
export function advanceAmbience(night: boolean, rain: boolean, delta: number): boolean {
  const step = approach(RATE, delta)
  const wantNight = night ? 1 : 0
  const wantRain = rain ? 1 : 0
  const before = ambienceBlend.night + ambienceBlend.rain * 3

  ambienceBlend.night += (wantNight - ambienceBlend.night) * step
  ambienceBlend.rain += (wantRain - ambienceBlend.rain) * step
  // Snap the last sliver, so "is it still moving" has an answer and repaints
  // (the sky's canvas, most expensively) stop when the fade has finished.
  if (Math.abs(wantNight - ambienceBlend.night) < 0.002) ambienceBlend.night = wantNight
  if (Math.abs(wantRain - ambienceBlend.rain) < 0.002) ambienceBlend.rain = wantRain

  return before !== ambienceBlend.night + ambienceBlend.rain * 3
}

/** The four corners a blended value is stretched between. */
export type Corners<T> = { day: T; dayRain: T; night: T; nightRain: T }

/** Bilinear blend of four numbers at the current night/rain position. */
export function mixNumber(corners: Corners<number>): number {
  const { night, rain } = ambienceBlend
  const dry = corners.day + (corners.night - corners.day) * night
  const wet = corners.dayRain + (corners.nightRain - corners.dayRain) * night
  return dry + (wet - dry) * rain
}

const scratchA = new THREE.Color()
const scratchB = new THREE.Color()

/** Pre-parsed colours for the four corners, built once per call site. */
export function colorCorners(corners: Corners<string>): Corners<THREE.Color> {
  return {
    day: new THREE.Color(corners.day),
    dayRain: new THREE.Color(corners.dayRain),
    night: new THREE.Color(corners.night),
    nightRain: new THREE.Color(corners.nightRain),
  }
}

/** Bilinear blend of four colours into `out` at the current position. */
export function mixColor(out: THREE.Color, corners: Corners<THREE.Color>): THREE.Color {
  const { night, rain } = ambienceBlend
  scratchA.copy(corners.day).lerp(corners.night, night)
  scratchB.copy(corners.dayRain).lerp(corners.nightRain, night)
  return out.copy(scratchA).lerp(scratchB, rain)
}
