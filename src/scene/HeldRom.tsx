import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHand } from './hand'
import { ROM_CARTRIDGE } from './Furniture'
import { useAppStore } from '../state/store'
import { useArcadeStore } from '../state/arcade'
import type { IndexedRom } from '../services/types'

/**
 * The shells in the crate are anonymous, so this is the only place a ROM's title
 * is printed on plastic — hence a full-resolution canvas, like the tape in hand.
 */
function labelTexture(rom: IndexedRom): THREE.CanvasTexture {
  const width = 384
  const height = 512
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#33383c'
  ctx.fillRect(0, 0, width, height)

  // The label, a printed sticker with a dark title band.
  const margin = 36
  ctx.fillStyle = '#ddd4bd'
  ctx.fillRect(margin, margin, width - margin * 2, height - margin * 2)
  ctx.fillStyle = '#7a3428'
  ctx.fillRect(margin, margin, width - margin * 2, 120)

  ctx.fillStyle = '#f2e8d2'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const available = width - margin * 2 - 24
  let size = 52
  for (; size > 22; size -= 2) {
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`
    if (ctx.measureText(rom.title).width <= available) break
  }
  ctx.fillText(rom.title, width / 2, margin + 62, available)

  if (rom.series) {
    ctx.fillStyle = '#5a5346'
    ctx.font = `400 30px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(rom.series.toUpperCase(), width / 2, height - margin - 48, available)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The cartridge in hand, riding the camera like every other held thing. */
export function HeldRom() {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const heldRom = useAppStore((s) => s.heldRom)
  const rom = useArcadeStore((s) => (heldRom ? s.romAt(heldRom) : undefined))

  const label = useMemo(() => (rom ? labelTexture(rom) : null), [rom])
  useEffect(() => () => label?.dispose(), [label])

  const drift = useRef(0)
  const hand = useMemo(makeHand, [])

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return

    drift.current += delta
    const { quaternion, forward, right, up } = hand.follow(camera, delta)

    node.position
      .copy(camera.position)
      .addScaledVector(forward, 0.4)
      .addScaledVector(right, 0.2)
      .addScaledVector(up, -0.18)

    node.quaternion.copy(quaternion)
    node.rotateY(-0.35 + Math.sin(drift.current * 0.6) * 0.04)
    node.rotateX(-0.12 + Math.sin(drift.current * 0.45) * 0.02)
  })

  if (!rom || !label) return null

  return (
    <group ref={group}>
      <mesh castShadow>
        <boxGeometry args={[ROM_CARTRIDGE.width, ROM_CARTRIDGE.height, ROM_CARTRIDGE.depth]} />
        <meshStandardMaterial color="#33383c" roughness={0.6} />
      </mesh>
      {/* The label, on the face towards you. */}
      <mesh position={[0, 0.004, ROM_CARTRIDGE.depth / 2 + 0.0006]}>
        <planeGeometry args={[ROM_CARTRIDGE.width * 0.86, ROM_CARTRIDGE.height * 0.78]} />
        <meshStandardMaterial map={label} roughness={0.7} />
      </mesh>
      {/* The edge connector, which is what tells a cartridge from a domino. */}
      <mesh position={[0, -ROM_CARTRIDGE.height / 2 + 0.008, 0]}>
        <boxGeometry args={[ROM_CARTRIDGE.width * 0.6, 0.016, ROM_CARTRIDGE.depth * 0.5]} />
        <meshStandardMaterial color="#1d2124" roughness={0.4} />
      </mesh>
    </group>
  )
}
