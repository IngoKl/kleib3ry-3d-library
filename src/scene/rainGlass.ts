import * as THREE from 'three'

/**
 * Rain on a window: one animated canvas for every pane in the building. Nobody
 * notices that two windows are wet in the same pattern, but everybody notices
 * the frame rate halving because eleven canvases are being redrawn.
 *
 * On a timer rather than per frame, at about fifteen a second: water on glass
 * moves slowly, and the upload is the cost rather than the drawing.
 */

const SIZE = 256
const BEADS = 90
const RUNS = 7

type Bead = { x: number; y: number; r: number; speed: number }
type Run = { x: number; y: number; length: number; speed: number; width: number }

let canvas: HTMLCanvasElement | null = null
let texture: THREE.CanvasTexture | null = null
let beads: Bead[] = []
let runs: Run[] = []
/** Whoever is currently asking for it. The last one out turns the timer off. */
let holders = 0
let timer: ReturnType<typeof setInterval> | undefined

/** Seeded, so two launches of the same library look the same, as with the forest. */
let seed = 0x9e37
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

function reset() {
  beads = Array.from({ length: BEADS }, () => ({
    x: random() * SIZE,
    y: random() * SIZE,
    r: 1 + random() * 2.6,
    // Small beads cling; big ones are about to run. Which is also what makes a
    // still frame of this read as water rather than as noise.
    speed: 0.05 + random() * 0.5,
  }))
  runs = Array.from({ length: RUNS }, () => ({
    x: random() * SIZE,
    y: random() * SIZE,
    length: 18 + random() * 60,
    speed: 3 + random() * 9,
    width: 1.4 + random() * 2.2,
  }))
}

function paint() {
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Two arcs each — a bright edge where the light bends and a dark core — which
  // is the whole of why a droplet reads as a lens rather than a dot.
  for (const bead of beads) {
    bead.y += bead.speed
    if (bead.y > SIZE + 4) {
      bead.y = -4
      bead.x = random() * SIZE
    }
    ctx.beginPath()
    ctx.arc(bead.x, bead.y, bead.r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(210, 232, 245, 0.30)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(bead.x - bead.r * 0.3, bead.y - bead.r * 0.3, bead.r * 0.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)'
    ctx.fill()
  }

  // The runs: a bead that got heavy enough to fall, dragging a tail.
  for (const run of runs) {
    run.y += run.speed
    if (run.y - run.length > SIZE) {
      run.y = -run.length
      run.x = random() * SIZE
      run.length = 18 + random() * 60
      run.speed = 3 + random() * 9
    }
    const gradient = ctx.createLinearGradient(run.x, run.y - run.length, run.x, run.y)
    gradient.addColorStop(0, 'rgba(200, 226, 242, 0)')
    gradient.addColorStop(1, 'rgba(226, 242, 252, 0.42)')
    ctx.strokeStyle = gradient
    ctx.lineWidth = run.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(run.x, run.y - run.length)
    ctx.lineTo(run.x, run.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(run.x, run.y, run.width * 0.8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(240, 250, 255, 0.5)'
    ctx.fill()
  }

  if (texture) texture.needsUpdate = true
}

/**
 * Reference counted rather than tied to a component, because every pane mounts
 * one at once and the timer has to be started once and stopped once.
 */
export function holdRainGlass(): THREE.CanvasTexture {
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    reset()
    texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    paint()
  }
  holders += 1
  if (timer === undefined) timer = setInterval(paint, 66)
  return texture!
}

export function releaseRainGlass() {
  holders = Math.max(0, holders - 1)
  if (holders === 0 && timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}
