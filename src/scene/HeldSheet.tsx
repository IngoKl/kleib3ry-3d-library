import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHand } from './hand'
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
  const hand = useMemo(makeHand, [])

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return

    drift.current += delta

    // The hand lags the head, so a turn swings it out a little. See `hand.ts`.
    const { quaternion, forward, right, up } = hand.follow(camera, delta)

    node.position
      .copy(camera.position)
      .addScaledVector(forward, 0.46)
      .addScaledVector(right, -0.26)
      .addScaledVector(up, -0.2)

    node.quaternion.copy(quaternion)
    node.rotateY(0.42 + Math.sin(drift.current * 0.6) * 0.03)
    node.rotateX(-0.24 + Math.sin(drift.current * 0.5) * 0.02)
  })

  if (!heldPin) return null

  const width = heldPin.kind === 'note' ? NOTE : SHEET.width
  const height = heldPin.kind === 'note' ? NOTE : SHEET.height
  const art = heldPin.kind === 'note' ? note : page

  const paper =
    heldPin.kind === 'note' ? NOTE_COLOURS[heldPin.colour % NOTE_COLOURS.length]! : '#f1ece0'
  // A note is a small pad of leaves and a page is one sheet. Both have a body,
  // for the same reason the ones on the wall do: a plane seen edge-on is a line.
  const body = heldPin.kind === 'note' ? 0.0035 : 0.0009

  return (
    <group ref={group}>
      <mesh castShadow>
        <boxGeometry args={[width, height, body]} />
        <meshStandardMaterial color={paper} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0, body / 2 + 0.0002]}>
        <planeGeometry args={[width, height]} />
        {art ? (
          <meshStandardMaterial key="art" map={art} roughness={0.9} />
        ) : (
          <meshStandardMaterial key="blank" color={paper} roughness={0.95} />
        )}
      </mesh>
    </group>
  )
}
