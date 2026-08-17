/**
 * Live render stats, outside React so the probe writes every frame without
 * re-rendering. The HUD polls it; the smoke tests read it to prove a draw.
 */
export type RenderMetrics = {
  fps: number
  fpsMin: number
  /**
   * Wall-clock milliseconds per frame. With headroom this is the refresh rate
   * and nothing else, so 16.7 means "fast enough", never "exactly fast enough".
   */
  frameMs: number
  /** The worst frame in the recent window. An average hides the hitches. */
  worstMs: number
  /** Milliseconds of our own JavaScript, before the draw is submitted. */
  cpuMs: number
  /** Milliseconds spent inside the draw call itself. */
  renderMs: number
  drawCalls: number
  triangles: number
  programs: number
  frames: number
}

export const metrics: RenderMetrics = {
  fps: 0,
  fpsMin: 0,
  frameMs: 0,
  worstMs: 0,
  cpuMs: 0,
  renderMs: 0,
  drawCalls: 0,
  triangles: 0,
  programs: 0,
  frames: 0,
}

/**
 * Which cost to go after. A 200 ms frame with 8 ms of JavaScript in it is
 * waiting on the GPU, and no amount of tightening the loop will move it. Below
 * the refresh interval there is nothing to diagnose but vsync.
 */
export function frameVerdict(m: RenderMetrics): 'vsync' | 'cpu' | 'gpu' {
  if (m.frameMs <= 17.5) return 'vsync'
  return m.cpuMs + m.renderMs > m.frameMs * 0.6 ? 'cpu' : 'gpu'
}
