import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ambienceBlend, colorCorners, goldenWarmth, mixColor, mixNumber } from './ambienceBlend'
import { shaderWarm } from './shaderWarm'
import { useAppStore } from '../state/store'
import { useSettings } from '../state/settings'

/**
 * A 64×32 equirect painted from the weather the sky shows, prefiltered through
 * PMREM, so brass, glass and above all the lake have something to reflect —
 * metalness with no environment is paint. 64×32 is PMREM's minimum input and
 * enough, since the prefilter blurs everything to "bright sky over dark ground".
 *
 * Regenerated only when the ambience blend settles, plus once mid-transition if
 * it has drifted far, into a reused target: never per-frame work. Off in Low
 * Performance Mode, where cubeUV sampling is a cost every material pays.
 *
 * Unhooked while a book is open: a reflection buys nothing behind a page, and
 * the turn needs exactly that budget. Both shader variants are compiled at boot,
 * so the toggle swaps cached programs rather than recompiling.
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

  // A plain effect, not a layout one: the first frame must render without the
  // environment, so the no-envmap programs the reader swaps back to are cached.
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
    // Frame one is deliberately env-free, so the unhook below swaps cached
    // programs: a compile wave on a software rasteriser is seconds, mid-turn.
    warmed.current += 1
    const reading = useAppStore.getState().mode === 'read'
    // Unhooked for the headlamp's first warm frames too, so the beam's programs
    // exist both with and without the map — the pair opening a book while
    // wearing the lamp would otherwise compile on the spot.
    const warmingBeam = shaderWarm.spotlight > 0 && shaderWarm.spotlight <= 2
    const want =
      warmed.current <= 1 || reading || warmingBeam ? null : (rig.target?.texture ?? null)
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
