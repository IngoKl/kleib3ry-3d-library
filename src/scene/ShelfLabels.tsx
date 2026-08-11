import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useShelfTransforms } from './transforms'
import { SHELF } from '../world/shelf'
import { useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'

/**
 * Label cards on the front edge of a bookcase.
 *
 * Written in the app rather than only in the document, because labelling a
 * shelf is something you do *while* you are shelving it — you have just decided
 * that this case is the poetry, and getting that out of your head and onto the
 * case should not mean alt-tabbing to a text editor. The text lives in
 * `books.json` beside the arrangement it describes and overrides whatever
 * `library.json` supplied, so a hand-written starting label is a default rather
 * than a fight.
 *
 * One canvas texture per labelled case, which is a handful of small textures
 * for a library — cheap enough not to need the atlas machinery the spines use,
 * since a case has one label and a shelf has forty books.
 */

const CARD_W = 256
const CARD_H = 64
/** Metres. Roughly a luggage-tag on the front of the top board. */
const CARD_WIDTH = 0.34
const CARD_HEIGHT = 0.085

function drawCard(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#efe3c8'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.strokeStyle = '#8a7350'
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, CARD_W - 8, CARD_H - 8)

  ctx.fillStyle = '#3a2c1c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Shrink to fit rather than clip: a label is short, and the one time it is
  // not, a smaller label still reads.
  let size = 34
  for (; size > 12; size -= 2) {
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`
    if (ctx.measureText(text).width <= CARD_W - 28) break
  }
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(text, CARD_W / 2, CARD_H / 2 + 1, CARD_W - 24)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function Card({ text, matrix }: { text: string; matrix: THREE.Matrix4 }) {
  const texture = useMemo(() => drawCard(text), [text])
  useEffect(() => () => texture.dispose(), [texture])

  const pose = useMemo(() => {
    const position = new THREE.Vector3(0, SHELF.height - CARD_HEIGHT / 2 - 0.045, SHELF.depth / 2 + 0.004)
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrix.decompose(new THREE.Vector3(), quaternion, scale)
    position.applyMatrix4(matrix)
    return { position, quaternion }
  }, [matrix])

  return (
    <mesh position={pose.position} quaternion={pose.quaternion}>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial map={texture} roughness={0.95} />
    </mesh>
  )
}

export function ShelfLabels() {
  const world = useWorldStore((s) => s.world)
  const labels = useLibraryStore((s) => s.labels)
  const transforms = useShelfTransforms()

  const cards = useMemo(() => {
    if (!world) return []
    return world.shelves.flatMap((shelf, index) => {
      const written = labels[shelf.id]
      const text = (written !== undefined ? written : (shelf.label ?? '')).trim()
      const transform = transforms[index]
      if (!text || !transform) return []
      return [{ id: shelf.id, text, matrix: transform.matrix }]
    })
  }, [world, labels, transforms])

  return (
    <group>
      {cards.map((card) => (
        <Card key={card.id} text={card.text} matrix={card.matrix} />
      ))}
    </group>
  )
}
