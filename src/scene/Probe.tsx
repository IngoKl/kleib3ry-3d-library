import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { metrics } from '../state/metrics'

/** Writes render stats into the shared metrics object once per frame. */
export function Probe() {
  const gl = useThree((s) => s.gl)
  const acc = useRef({ frames: 0, elapsed: 0, window: [] as number[] })

  useFrame((_, delta) => {
    const a = acc.current
    a.frames += 1
    a.elapsed += delta
    metrics.frames += 1
    metrics.drawCalls = gl.info.render.calls
    metrics.triangles = gl.info.render.triangles
    metrics.programs = gl.info.programs?.length ?? 0

    if (a.elapsed >= 0.25) {
      const fps = a.frames / a.elapsed
      metrics.fps = fps
      a.window.push(fps)
      if (a.window.length > 20) a.window.shift()
      metrics.fpsMin = Math.min(...a.window)
      a.frames = 0
      a.elapsed = 0
    }
  })

  return null
}
