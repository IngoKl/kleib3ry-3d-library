/**
 * What the sky dressing shares: where the two lights hang, and the soft
 * radial glow every one of them — moon halo, sun disc, lamp bloom, firefly,
 * the glint on the lake — is painted with. Its own module so SkyDressing,
 * LampGlow and Outside can agree without a circular import.
 */

import * as THREE from 'three'

/**
 * Where the moon hangs: the same corner of the sky the directional light comes
 * from at night — low over the lake to the north-west — so the shadows and the
 * disc agree about where the light is.
 */
export const MOON_DIRECTION = new THREE.Vector3(-0.38, 0.42, -0.78).normalize()

/**
 * The sun, in the same north-west corner (it is one directional light playing
 * both parts) but higher and a little east, so the two discs never coincide
 * mid-transition.
 */
export const SUN_DIRECTION = new THREE.Vector3(-0.3, 0.5, -0.72).normalize()

/**
 * A soft radial glow, painted once: colour stops from the centre out, on a
 * transparent ground. The moon halo's painter, generalised.
 */
export function radialGlowTexture(
  size: number,
  stops: readonly (readonly [number, string])[],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2
  // A tiny solid core rather than a point, the halo's own look.
  const gradient = ctx.createRadialGradient(half, half, size / 32, half, half, half)
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
