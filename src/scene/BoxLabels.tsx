import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'

/**
 * A marker-on-masking-tape label on the front of a moving box — the same `L`
 * that labels a bookcase, aimed at a box instead. Boxes are not instanced like
 * shelves, so each one already carries its own world position and rotation;
 * no transform lookup is needed the way `ShelfLabels` needs one.
 */

const CARD_W = 220
const CARD_H = 72
const CARD_WIDTH = 0.24
const CARD_HEIGHT = 0.078
/** Metres out from the box's front wall, so the card sits on the cardboard rather than in it. */
const MARGIN = 0.006

function drawCard(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f2ead9'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.strokeStyle = '#c9bd9c'
  ctx.lineWidth = 2
  ctx.strokeRect(3, 3, CARD_W - 6, CARD_H - 6)

  ctx.fillStyle = '#2a2a2a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 30
  for (; size > 12; size -= 2) {
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`
    if (ctx.measureText(text).width <= CARD_W - 24) break
  }
  ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(text, CARD_W / 2, CARD_H / 2 + 1, CARD_W - 20)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function Card({
  text,
  x,
  y,
  z,
  rotationY,
}: {
  text: string
  x: number
  y: number
  z: number
  rotationY: number
}) {
  const texture = useMemo(() => drawCard(text), [text])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh position={[x, y, z]} rotation-y={rotationY}>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial map={texture} roughness={0.95} />
    </mesh>
  )
}

export function BoxLabels() {
  const world = useWorldStore((s) => s.world)
  const labels = useLibraryStore((s) => s.labels)

  const cards = useMemo(() => {
    if (!world) return []
    return world.furniture.flatMap((item) => {
      if (item.kind !== 'box') return []
      const text = (labels[item.id] ?? '').trim()
      if (!text) return []

      // The same rotation the box's own geometry is drawn in, so the card
      // sits flush on the front wall and faces the way the box faces.
      const cos = Math.cos(item.rotationY)
      const sin = Math.sin(item.rotationY)
      const out = item.depth / 2 + MARGIN
      return [
        {
          id: item.id,
          text,
          x: item.x + out * sin,
          y: item.y + item.height * 0.55,
          z: item.z + out * cos,
          rotationY: item.rotationY,
        },
      ]
    })
  }, [world, labels])

  return (
    <group>
      {cards.map((card) => (
        <Card key={card.id} text={card.text} x={card.x} y={card.y} z={card.z} rotationY={card.rotationY} />
      ))}
    </group>
  )
}
