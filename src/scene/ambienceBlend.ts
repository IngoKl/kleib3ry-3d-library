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
  /** 1 at a lightning strike, decaying to 0 in under a second. */
  lightning: 0,
}

/**
 * How many e-foldings a second. Weather still arrives briskly, but dusk takes
 * its time — about seven seconds — because a two-second sunset reads as a
 * light switch, and the golden hour below needs somewhere to happen.
 */
const NIGHT_RATE = 0.6
const RAIN_RATE = 2.2

/** Advance towards the store's booleans. Returns true while anything moved. */
export function advanceAmbience(night: boolean, rain: boolean, delta: number): boolean {
  const wantNight = night ? 1 : 0
  const wantRain = rain ? 1 : 0
  const before = ambienceBlend.night + ambienceBlend.rain * 3

  ambienceBlend.night += (wantNight - ambienceBlend.night) * approach(NIGHT_RATE, delta)
  ambienceBlend.rain += (wantRain - ambienceBlend.rain) * approach(RAIN_RATE, delta)
  // Snap the last sliver, so "is it still moving" has an answer and repaints
  // (the sky's canvas, most expensively) stop when the fade has finished.
  if (Math.abs(wantNight - ambienceBlend.night) < 0.002) ambienceBlend.night = wantNight
  if (Math.abs(wantRain - ambienceBlend.rain) < 0.002) ambienceBlend.rain = wantRain

  // The flash decays here but is deliberately no part of the return value:
  // the ambient light carries it, and the sky canvas must not repaint twenty
  // times per strike.
  ambienceBlend.lightning *= Math.exp(-7 * delta)
  if (ambienceBlend.lightning < 0.01) ambienceBlend.lightning = 0

  return before !== ambienceBlend.night + ambienceBlend.rain * 3
}

/** The thunder calls this — twice, for the classic double flash. */
export function strikeLightning(strength = 1) {
  ambienceBlend.lightning = Math.min(1.5, ambienceBlend.lightning + strength)
}

/**
 * The amber the day passes through on its way down: zero at both settled
 * poles — a settled day and a settled night are pixel-identical with or
 * without this — peaking mid-transition, and rained off. A curve on the
 * existing blend, not a fifth corner.
 */
export function goldenWarmth(): number {
  const s = Math.sin(Math.PI * ambienceBlend.night)
  return s * s * (1 - ambienceBlend.rain * 0.8)
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
