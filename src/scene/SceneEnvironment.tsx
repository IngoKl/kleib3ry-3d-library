import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend, colorCorners, goldenWarmth, mixColor, mixNumber } from './ambienceBlend'
import { useAppStore } from '../state/store'
import { useSettings } from '../state/settings'

/**
 * The environment map: a 64×32 equirect painted from the same weather the sky
 * shows, prefiltered through PMREM and set as `scene.environment`, so brass,
 * glass and above all the lake have something to reflect — metalness with no
 * environment is paint. 64×32 is PMREM's documented minimum input, and enough:
 * the prefilter blurs everything to "bright sky over dark ground", which is
 * all a reflection this soft can say. The stops here approximate the dome's
 * rather than importing them, for the same reason.
 *
 * Regenerated only when the ambience blend settles — plus once mid-transition
 * if it has drifted far, so a seven-second dusk does not reflect noon all the
 * way down — into a reused render target: a regen is a handful of offscreen
 * passes, never per-frame work. Off in Low Performance Mode: cubeUV sampling
 * is a per-fragment cost every standard material in the frame pays.
 *
 * And unhooked while a book is open. The reader pays for pages, not
 * reflections: mid-turn the rasteriser and the renderer share one CPU on the
 * machines that struggle, a reflection buys nothing behind an open book, and
 * unhooking returns exactly the budget the turn needs. Both shader variants
 * are compiled once at boot (the first frame renders before the environment
 * arrives), so the toggle swaps cached programs rather than recompiling.
 */

const ZENITH = colorCorners({ day: '#4d7fb5', dayRain: '#5d6771', night: '#0a1024', nightRain: '#141721' })
const HORIZON = colorCorners({ day: '#d6e4ec', dayRain: '#9aa3aa', night: '#1d2536', nightRain: '#1b1f29' })
const GROUND = colorCorners({ day: '#41522e', dayRain: '#39443a', night: '#131a10', nightRain: '#161a14' })
const GOLDEN_HORIZON = new THREE.Color('#e8a05c')
const INTENSITY = { day: 0.22, dayRain: 0.12, night: 0.1, nightRain: 0.07 }

const scratchA = new THREE.Color()
const scratchB = new THREE.Color()
const scratchC = new THREE.Color()

export function SceneEnvironment() {
  const low = useSettings((s) => s.lowPerformance)
  return low ? null : <Prefiltered />
}

function Prefiltered() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const rig = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    const texture = new THREE.CanvasTexture(canvas)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    return {
      canvas,
      ctx: canvas.getContext('2d')!,
      texture,
      pmrem,
      target: null as THREE.WebGLRenderTarget | null,
    }
  }, [gl])

  const bake = useCallback(() => {
    const { canvas, ctx, texture, pmrem } = rig
    const zenith = mixColor(scratchA, ZENITH)
    const horizon = mixColor(scratchB, HORIZON).lerp(GOLDEN_HORIZON, 0.55 * goldenWarmth())
    const ground = mixColor(scratchC, GROUND)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, `#${zenith.getHexString()}`)
    gradient.addColorStop(0.5, `#${horizon.getHexString()}`)
    // A dark lower half is what sells the lake: a reflection needs a ground
    // line, not sky all the way round.
    gradient.addColorStop(0.56, `#${scratchC.clone().lerp(horizon, 0.35).getHexString()}`)
    gradient.addColorStop(1, `#${ground.getHexString()}`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
    // Only the bake: whether the result is hooked up is the frame loop's call.
    rig.target = pmrem.fromEquirectangular(texture, rig.target ?? undefined)
  }, [rig])

  /** What the map currently shows, and where the blend was last frame. */
  const baked = useRef({ night: -1, rain: -1 })
  const prev = useRef({ night: 0, rain: 0 })

  // A plain effect, not a layout one: the first frame must render *without*
  // the environment so the no-envmap programs exist in the cache — they are
  // what the reader swaps back to. The recompile wave for the env variants
  // lands a frame later, still inside the load.
  useEffect(() => {
    bake()
    baked.current = { night: ambienceBlend.night, rain: ambienceBlend.rain }
    return () => {
      scene.environment = null
      scene.environmentIntensity = 1
      rig.target?.dispose()
      rig.pmrem.dispose()
      rig.texture.dispose()
    }
  }, [bake, rig, scene])

  /** Frames rendered so far: the first one must go out with no environment. */
  const warmed = useRef(0)

  useFrame(() => {
    // Frame one renders without the environment on purpose: it is what puts
    // the no-envmap shader programs in the cache, so the reader's unhook
    // below swaps programs instead of compiling them — a compile wave on a
    // software rasteriser is seconds, mid-page-turn.
    warmed.current += 1
    const reading = useAppStore.getState().mode === 'read'
    const want = warmed.current <= 1 || reading ? null : (rig.target?.texture ?? null)
    if (scene.environment !== want) scene.environment = want
    scene.environmentIntensity = mixNumber(INTENSITY)
    const { night, rain } = ambienceBlend
    const was = prev.current
    const moving = was.night !== night || was.rain !== rain
    const settledElsewhere =
      !moving && (baked.current.night !== night || baked.current.rain !== rain)
    const drifted = Math.abs(night - baked.current.night) > 0.35
    if (settledElsewhere || drifted) {
      bake()
      baked.current = { night, rain }
    }
    prev.current = { night, rain }
  })

  return null
}
