import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHand } from './hand'
import { useAppStore } from '../state/store'
import { useVideoStore } from '../state/video'
import type { IndexedTape } from '../services/types'

/** The same cassette it is in the crate. */
const THICKNESS = 0.031
const HEIGHT = 0.234
const DEPTH = 0.129

/**
 * A tape in the crate gets an atlas cell a hundred pixels across, which is
 * plenty from a room away and not enough held in front of your face — so the one
 * in hand gets its own canvas, as the sleeve in hand does. Handwriting on a
 * sticky label, because that is what almost every tape anybody owns has on it.
 */
function labelTexture(tape: IndexedTape): THREE.CanvasTexture {
  const width = 512
  const height = 288
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // The shell, then the label stuck onto it a little askew.
  ctx.fillStyle = '#26262a'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(-0.012)
  const lw = width * 0.9
  const lh = height * 0.62
  ctx.fillStyle = '#efe7d4'
  ctx.fillRect(-lw / 2, -lh / 2, lw, lh)
  ctx.strokeStyle = 'rgba(60, 48, 32, 0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(-lw / 2, -lh / 2, lw, lh)

  // Two ruled lines, and the title written across them.
  ctx.strokeStyle = 'rgba(90, 74, 52, 0.28)'
  ctx.lineWidth = 1.5
  for (const y of [-lh * 0.02, lh * 0.22]) {
    ctx.beginPath()
    ctx.moveTo(-lw / 2 + 22, y + 14)
    ctx.lineTo(lw / 2 - 22, y + 14)
    ctx.stroke()
  }

  ctx.fillStyle = '#22303f'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const available = lw - 48
  let size = 40
  for (; size > 18; size -= 2) {
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`
    if (ctx.measureText(tape.title).width <= available) break
  }
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(tape.title, -lw / 2 + 24, -lh * 0.02 + 8, available)

  if (tape.series) {
    ctx.font = `400 24px "Segoe UI", system-ui, sans-serif`
    ctx.globalAlpha = 0.72
    ctx.fillText(tape.series, -lw / 2 + 24, lh * 0.22 + 8, available)
    ctx.globalAlpha = 1
  }
  ctx.restore()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Carried the way you carry a cassette, riding the camera like `HeldBook`. */
export function HeldTape() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const heldTape = useAppStore((s) => s.heldTape)
  const tape = useVideoStore((s) => (heldTape ? s.tapes.find((t) => t.id === heldTape) : undefined))

  const label = useMemo(() => (tape ? labelTexture(tape) : null), [tape])
  useEffect(() => () => label?.dispose(), [label])

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
      .addScaledVector(forward, 0.42)
      .addScaledVector(right, 0.21)
      .addScaledVector(up, -0.19)

    node.quaternion.copy(quaternion)
    node.rotateY(-0.55 + Math.sin(drift.current * 0.6) * 0.04)
    node.rotateX(0.2 + Math.sin(drift.current * 0.45) * 0.02)
    // Held label-up, which is how you look at one before it goes in.
    node.rotateZ(Math.PI / 2)
  })

  if (!tape || !label) return null

  return (
    <group ref={group}>
      <mesh castShadow>
        <boxGeometry args={[THICKNESS, HEIGHT, DEPTH]} />
        <meshStandardMaterial color="#26262a" roughness={0.55} />
      </mesh>
      {/* The label, on the big face. */}
      <mesh position={[THICKNESS / 2 + 0.0006, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[DEPTH * 0.98, HEIGHT * 0.98]} />
        <meshStandardMaterial map={label} roughness={0.7} />
      </mesh>
      {/* The window over the reels, which is what tells a cassette from a box. */}
      <mesh position={[-THICKNESS / 2 - 0.0006, HEIGHT * 0.12, 0]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[DEPTH * 0.6, HEIGHT * 0.28]} />
        <meshStandardMaterial color="#1a1c1e" roughness={0.2} metalness={0.1} />
      </mesh>
    </group>
  )
}
