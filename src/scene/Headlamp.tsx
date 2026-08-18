import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { shaderWarm } from './shaderWarm'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * A spot light riding the camera, which is what a headlamp is. Mounted only
 * while worn, like the television's glow, because every light costs every lit
 * fragment even at zero intensity — but putting it on compiles nothing, since
 * `Warmup` below builds the with-beam programs during the load.
 *
 * No shadows: a moving caster re-renders the whole map every frame, and the
 * beam exists to find the trail.
 */
export function Headlamp() {
  const worn = useAppStore((s) => s.wornLamp !== null)
  // Once the room exists, because there is nothing to warm against until its
  // materials do. Latched: after it, this mounts nothing and runs no callback.
  const room = useWorldStore((s) => s.world !== null)
  const [warmed, setWarmed] = useState(false)
  if (worn) return <Beam />
  return room && !warmed ? <Warmup done={() => setWarmed(true)} /> : null
}

function Beam() {
  const light = useRef<THREE.SpotLight>(null)
  const camera = useThree((s) => s.camera)
  const target = useMemo(() => new THREE.Object3D(), [])
  const aim = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const node = light.current
    if (!node) return
    node.position.copy(camera.position)
    camera.getWorldDirection(aim)
    target.position.copy(camera.position).addScaledVector(aim, 8)
    target.updateMatrixWorld()
  })

  return (
    <>
      <spotLight
        ref={light}
        target={target}
        // Candela, like the lamps: at 6 m down the trail this arrives as ~0.5,
        // which reads as a torch in the dark and as nothing much by day.
        intensity={18}
        distance={24}
        angle={0.44}
        penumbra={0.75}
        color="#ffe2b0"
      />
      <primitive object={target} />
    </>
  )
}

/**
 * The beam's shader programs, compiled behind the menu and then let go of. The
 * spot light count is baked into every lit material, so the beam's first frame
 * would otherwise recompile the room — seconds on a software rasteriser. A dark
 * spot light held for a few frames of the load builds them instead.
 *
 * Zero intensity rather than `visible={false}`, which takes the light out of the
 * count and warms nothing; unmounted after, so an unworn lamp costs nothing.
 */
function Warmup({ done }: { done: () => void }) {
  const frames = useRef(0)
  const [lit, setLit] = useState(false)

  // A canvas remount mid-warm must not leave the flag raised, or the
  // environment map would stay unhooked for the rest of the session.
  useEffect(() => () => {
    shaderWarm.spotlight = 0
  }, [])

  useFrame(() => {
    frames.current += 1
    // The first frame goes out unlit, like the environment map's: it is what
    // caches the *no*-spotlight programs the room runs on the rest of the time.
    if (frames.current === 1) {
      setLit(true)
      return
    }
    // Counted where `SceneEnvironment` can see it: it drops the environment for
    // the first two, so the beam compiles both with the map and without — the
    // second being what a book opened in the dark runs on.
    shaderWarm.spotlight = frames.current - 1
    if (frames.current >= 7) {
      shaderWarm.spotlight = 0
      done()
    }
  })

  return lit ? <spotLight intensity={0} /> : null
}
