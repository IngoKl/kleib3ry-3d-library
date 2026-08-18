import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { sceneRefs } from './refs'
import { metrics } from '../state/metrics'

/**
 * Render stats, once per frame. The split between our JavaScript and the draw is
 * the part worth having: it says whether a slow frame is the loop's fault or the
 * GPU's. That boundary means wrapping `gl.render`, because a positive `useFrame`
 * priority switches R3F's automatic rendering off; -10000 runs first instead.
 */
export function Probe() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const acc = useRef({ frames: 0, elapsed: 0, window: [] as number[], worst: 0 })
  const stamp = useRef({ frameStart: 0, cpu: 0, render: 0 })

  useEffect(() => {
    sceneRefs.scene = scene
    return () => {
      sceneRefs.scene = null
    }
  }, [scene])

  useEffect(() => {
    const original = gl.render
    gl.render = function patched(this: typeof gl, target, camera) {
      const started = performance.now()
      stamp.current.cpu = started - stamp.current.frameStart
      original.call(this, target, camera)
      stamp.current.render = performance.now() - started
    }
    return () => {
      gl.render = original
    }
  }, [gl])

  // Before everything else in the frame, so `cpuMs` covers the whole of it.
  useFrame(() => {
    stamp.current.frameStart = performance.now()
  }, -10000)

  useFrame((_, delta) => {
    const a = acc.current
    a.frames += 1
    a.elapsed += delta
    a.worst = Math.max(a.worst, delta * 1000)
    metrics.frames += 1
    metrics.drawCalls = gl.info.render.calls
    metrics.triangles = gl.info.render.triangles
    metrics.programs = gl.info.programs?.length ?? 0
    metrics.cpuMs = stamp.current.cpu
    metrics.renderMs = stamp.current.render

    if (a.elapsed >= 0.25) {
      const fps = a.frames / a.elapsed
      metrics.fps = fps
      metrics.frameMs = (a.elapsed / a.frames) * 1000
      metrics.worstMs = a.worst
      a.window.push(fps)
      if (a.window.length > 20) a.window.shift()
      metrics.fpsMin = Math.min(...a.window)
      a.frames = 0
      a.elapsed = 0
      a.worst = 0
    }
  })

  return null
}
