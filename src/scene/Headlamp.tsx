import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../state/store'

/**
 * The beam of the headlamp, while it is on your head.
 *
 * A spot light that rides the camera and points where you look — which is what
 * a headlamp is. Mounted only while the lamp is worn, like the television's
 * glow: every light in the scene is a term every lit fragment pays for even at
 * zero intensity, and the software rasteriser the tests run on cannot afford
 * that as a standing charge. Putting the lamp on recompiles the shaders once.
 *
 * No shadows: a moving shadow-casting light re-renders the whole shadow map
 * every frame, and the beam exists to find the trail, not to win an award.
 */
export function Headlamp() {
  const worn = useAppStore((s) => s.wornLamp !== null)
  if (!worn) return null
  return <Beam />
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
