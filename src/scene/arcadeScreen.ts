import * as THREE from 'three'
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Chip8 } from '../arcade/chip8'

/**
 * The cabinet's tube: a canvas exactly one texel per CHIP-8 pixel.
 *
 * 64×32 RGBA is an eight-kilobyte upload, which is why this is the one dynamic
 * texture in the app that can afford to repaint every frame — the whiteboard's
 * revision-checking exists because its canvas is two thousand pixels across,
 * and this one is not. `NearestFilter` because the pixels *are* the picture:
 * bilinear filtering would smear a 1977 display into fog.
 */

/** Phosphor green on a dark tube, the palette every one-bit display claims. */
const LIT: [number, number, number] = [0x9c, 0xf2, 0x9c]
const UNLIT: [number, number, number] = [0x0d, 0x17, 0x12]

export type ArcadeScreen = {
  texture: THREE.CanvasTexture
  paint: (machine: Chip8 | null) => void
  dispose: () => void
}

export function makeArcadeScreen(): ArcadeScreen {
  const canvas = document.createElement('canvas')
  canvas.width = SCREEN_WIDTH
  canvas.height = SCREEN_HEIGHT
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping

  const paint = (machine: Chip8 | null) => {
    const pixels = image.data
    for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
      const [r, g, b] = machine?.screen[i] ? LIT : UNLIT
      pixels[i * 4] = r
      pixels[i * 4 + 1] = g
      pixels[i * 4 + 2] = b
      pixels[i * 4 + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    texture.needsUpdate = true
  }

  paint(null)
  return { texture, paint, dispose: () => texture.dispose() }
}
