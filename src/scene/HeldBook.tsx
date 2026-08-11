import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { coverFor } from '../state/covers'

/**
 * The book currently in hand, floating just below the line of sight. It rides
 * the camera each frame rather than being parented to it, so the idle drift can
 * be independent of head bob.
 */
export function HeldBook() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const held = useAppStore((s) => s.held)
  const reading = useAppStore((s) => s.reading)

  const book = useLibraryStore((s) => (held ? s.byId.get(held) : undefined))
  const size = useLibraryStore((s) => (held ? s.dims.get(held) : undefined))

  const [cover, setCover] = useState<THREE.Texture | null>(null)

  // Fetch (or render) the cover for whatever is in hand.
  useEffect(() => {
    let cancelled = false
    setCover(null)
    if (!book) return

    void coverFor(book).then((url) => {
      if (cancelled || !url) return
      new THREE.TextureLoader().load(url, (texture) => {
        if (cancelled) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        setCover(texture)
      })
    })

    return () => {
      cancelled = true
    }
  }, [book])

  useEffect(() => () => cover?.dispose(), [cover])

  const drift = useRef(0)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    const node = group.current
    if (!node || !size) return

    drift.current += delta

    camera.getWorldDirection(forward.current)
    right.current.crossVectors(forward.current, camera.up).normalize()
    up.current.crossVectors(right.current, forward.current).normalize()

    // Held low and off to the side: far enough not to block the shelf you are
    // reading, close enough to be clearly in hand.
    node.position
      .copy(camera.position)
      .addScaledVector(forward.current, 0.54)
      .addScaledVector(right.current, 0.21)
      .addScaledVector(up.current, -0.2)

    node.quaternion.copy(camera.quaternion)
    node.rotateY(-0.55 + Math.sin(drift.current * 0.6) * 0.05)
    node.rotateX(0.3)
    node.rotateZ(Math.sin(drift.current * 0.45) * 0.03)
  })

  // While reading, the open book replaces the closed one.
  if (!book || !size || reading) return null

  const coverWidth = size.depth
  const coverHeight = size.height
  const spine = size.thickness

  return (
    <group ref={group}>
      <mesh castShadow>
        <boxGeometry args={[coverWidth, coverHeight, spine]} />
        <meshStandardMaterial color={size.colour} roughness={0.65} />
      </mesh>

      {/* pages, just proud of the boards on three edges */}
      <mesh>
        <boxGeometry args={[coverWidth * 0.965, coverHeight * 0.96, spine * 0.82]} />
        <meshStandardMaterial color="#e9e0cb" roughness={1} />
      </mesh>

      {/* the real cover art, or a blank board until it arrives */}
      <mesh position={[0, 0, spine / 2 + 0.0012]}>
        <planeGeometry args={[coverWidth * 0.98, coverHeight * 0.98]} />
        {cover ? (
          <meshStandardMaterial map={cover} roughness={0.62} />
        ) : (
          <meshStandardMaterial color={size.colour} roughness={0.62} />
        )}
      </mesh>
    </group>
  )
}
