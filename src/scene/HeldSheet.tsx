import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { NOTE, NOTE_COLOURS, SHEET, noteTexture, pageTextureFor, peekPage } from './pinArt'
import { useAppStore } from '../state/store'

/**
 * The page or note in your hand, held up in front of you the way you hold a
 * sheet of paper you are about to stick to something.
 *
 * Rides the camera each frame like `HeldBook`, and sits lower and further left
 * than the book does, because a sheet in one hand and a book in the other is a
 * thing that happens: `heldPin` and `held` are deliberately not exclusive.
 */
export function HeldSheet() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const heldPin = useAppStore((s) => s.heldPin)

  const [page, setPage] = useState<THREE.Texture | null>(null)

  const note = useMemo(
    () => (heldPin?.kind === 'note' ? noteTexture(heldPin.text, heldPin.colour) : null),
    [heldPin],
  )
  useEffect(() => () => note?.dispose(), [note])

  useEffect(() => {
    if (heldPin?.kind !== 'page') {
      setPage(null)
      return
    }
    setPage(peekPage(heldPin.bookId, heldPin.page) ?? null)
    let cancelled = false
    void pageTextureFor(heldPin.bookId, heldPin.page).then((loaded) => {
      if (!cancelled) setPage(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [heldPin])

  const drift = useRef(0)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return

    drift.current += delta

    camera.getWorldDirection(forward.current)
    right.current.crossVectors(forward.current, camera.up).normalize()
    up.current.crossVectors(right.current, forward.current).normalize()

    node.position
      .copy(camera.position)
      .addScaledVector(forward.current, 0.46)
      .addScaledVector(right.current, -0.26)
      .addScaledVector(up.current, -0.2)

    node.quaternion.copy(camera.quaternion)
    node.rotateY(0.42 + Math.sin(drift.current * 0.6) * 0.03)
    node.rotateX(-0.24 + Math.sin(drift.current * 0.5) * 0.02)
  })

  if (!heldPin) return null

  const width = heldPin.kind === 'note' ? NOTE : SHEET.width
  const height = heldPin.kind === 'note' ? NOTE : SHEET.height
  const art = heldPin.kind === 'note' ? note : page

  return (
    <group ref={group}>
      <mesh castShadow>
        <planeGeometry args={[width, height]} />
        {art ? (
          <meshStandardMaterial key="art" map={art} roughness={0.9} side={THREE.DoubleSide} />
        ) : (
          <meshStandardMaterial
            key="blank"
            color={heldPin.kind === 'note' ? NOTE_COLOURS[heldPin.colour % NOTE_COLOURS.length] : '#f1ece0'}
            roughness={0.95}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>
    </group>
  )
}
