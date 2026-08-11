/**
 * Live render stats, kept outside React so the probe can write every frame
 * without re-rendering the tree. The HUD polls it; the smoke test reads it to
 * prove the scene actually drew something.
 */
export type RenderMetrics = {
  fps: number
  fpsMin: number
  drawCalls: number
  triangles: number
  programs: number
  frames: number
}

export const metrics: RenderMetrics = {
  fps: 0,
  fpsMin: 0,
  drawCalls: 0,
  triangles: 0,
  programs: 0,
  frames: 0,
}
