export type Settings = {
  /** Texture pixels per screen pixel. The spec's "2-4x" claim under test. */
  supersample: number
  anisotropy: boolean
  mipmaps: boolean
  shadows: boolean
  /** Book pitch away from the camera, radians. Probes oblique-angle filtering. */
  tiltRad: number
  dpr: number
  textureBudgetMB: number
}

export type Metrics = {
  fps: number
  fpsMin: number
  pageCssPx: number
  pageDevicePx: number
  targetTexturePx: number
  actualTexturePx: number
  texelRatio: number
  textureMB: number
  turning: boolean
}

export const initialMetrics = (): Metrics => ({
  fps: 0,
  fpsMin: 0,
  pageCssPx: 0,
  pageDevicePx: 0,
  targetTexturePx: 0,
  actualTexturePx: 0,
  texelRatio: 0,
  textureMB: 0,
  turning: false,
})
