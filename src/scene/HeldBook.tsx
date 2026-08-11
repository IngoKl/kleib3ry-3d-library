import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { coverFor, coverImageFor, onCoverReady, peekCoverImage } from '../state/covers'

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

  /**
   * Fetch (or render) the cover for whatever is in hand.
   *
   * Two paths into the same result, deliberately. The first time a PDF is
   * picked up its cover has to be rasterised, which takes a second or two —
   * long enough that a book used to be put back down before its artwork ever
   * arrived. So: take whatever the shared cache already has *synchronously*,
   * ask for it urgently if it has not, and listen for it landing. Nothing here
   * waits on a promise that was started for a different reason.
   */
  useEffect(() => {
    let cancelled = false

    const show = (source: HTMLImageElement | string) => {
      if (cancelled) return
      const texture =
        typeof source === 'string' ? new THREE.TextureLoader().load(source) : new THREE.Texture(source)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      setCover(texture)
    }

    setCover(null)
    if (!book) return

    const already = peekCoverImage(book.id)
    if (already) {
      show(already)
    } else {
      // Jump the background sweep: this is the book somebody is holding.
      coverImageFor(book)
      void coverFor(book).then((url) => {
        if (!cancelled && url) show(url)
      })
    }

    const listener = (id: string) => {
      if (id !== book.id) return
      const arrived = peekCoverImage(id)
      if (arrived) show(arrived)
    }
    onCoverReady.add(listener)

    return () => {
      cancelled = true
      onCoverReady.delete(listener)
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
