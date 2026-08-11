import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { applyBow, applyGutterCurl, gutterRise, makeSheet } from './pageMesh'
import type { PageTextureCache } from './pdf'
import type { Metrics, Settings } from './types'

export const PAGE_HEIGHT = 0.24 // metres -- a trade paperback
const PAGE_DEPTH = 0.0006
const BOOK_THICKNESS = 0.032
const TURN_SECONDS = 0.85
const BOW_AMPLITUDE = 0.055
const GUTTER_CURL = 0.1
/** Clearance between the sheet's lowest point and the page block behind it. */
const BLOCK_CLEARANCE = 0.0004

export type BookApi = {
  turn: (dir: 1 | -1) => void
  isTurning: () => boolean
  /** Freeze a turn part-way so a still frame can be inspected. */
  pose: (dir: 1 | -1, progress: number | null) => void
}

type Props = {
  doc: PDFDocumentProxy | null
  aspect: number
  cache: PageTextureCache | null
  settings: Settings
  spread: number
  onSpread: (next: number) => void
  metrics: React.RefObject<Metrics>
  api: React.RefObject<BookApi | null>
}

type Turn = { dir: 1 | -1; progress: number; frozen?: boolean }

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const quantise = (px: number) => Math.max(384, Math.min(8192, Math.round(px / 128) * 128))

export function Book({ doc, aspect, cache, settings, spread, onSpread, metrics, api }: Props) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const width = PAGE_HEIGHT * aspect

  // The curled sheets rise away from their hinge, so seat the hinge below zero
  // to land the flat part of the page on the plane the block tops out at.
  const rise = gutterRise(width, GUTTER_CURL)

  const sheets = useMemo(() => {
    const left = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    const right = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    const turning = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    left.mesh.position.z = -rise
    right.mesh.position.z = -rise
    turning.mesh.position.z = 0.0016
    turning.mesh.visible = false
    return { left, right, turning }
  }, [width, rise])

  useEffect(() => {
    const { left, right, turning } = sheets
    return () => {
      left.dispose()
      right.dispose()
      turning.dispose()
    }
  }, [sheets])

  const turnRef = useRef<Turn | null>(null)
  const spreadRef = useRef(spread)
  spreadRef.current = spread
  // Mirrored as state as well as a ref: the ref is what the imperative turn
  // handler reads mid-frame, the state is what re-triggers the loader when the
  // required resolution changes.
  const [targetPx, setTargetPx] = useState(1024)
  const targetPxRef = useRef(targetPx)
  const probe = useMemo(() => new THREE.Vector3(), [])

  // ---- page numbering -------------------------------------------------
  // Leaf s has recto 2s+1 and verso 2s+2. Spread s therefore shows the verso
  // of leaf s-1 on the left (page 2s) and the recto of leaf s on the right.
  const leftPage = (s: number) => 2 * s
  const rightPage = (s: number) => 2 * s + 1

  const assign = useMemo(() => {
    return async (
      target: THREE.MeshStandardMaterial,
      pageNumber: number,
      px: number,
      immediate = false,
    ) => {
      if (!doc || !cache) return
      if (immediate) {
        const resident = cache.peek(pageNumber, px) ?? cache.peekAny(pageNumber)
        if (resident) {
          target.map = resident.texture
          target.needsUpdate = true
        }
      }
      const entry = await cache.get(doc, pageNumber, px, settings.anisotropy, settings.mipmaps)
      if (target.map !== entry.texture) {
        target.map = entry.texture
        target.needsUpdate = true
      }
    }
  }, [doc, cache, settings.anisotropy, settings.mipmaps])

  // Load the resting spread, then warm the pages the next turn will need.
  useEffect(() => {
    if (!doc || !cache) return
    let cancelled = false
    const px = targetPx
    void (async () => {
      await assign(sheets.left.back, leftPage(spread), px, true)
      await assign(sheets.right.front, rightPage(spread), px, true)
      if (cancelled) return
      // Warm both directions so a turn can start without a stall.
      for (const p of [2 * spread + 2, 2 * spread + 3, 2 * spread - 1, 2 * spread - 2]) {
        if (cancelled) return
        if (doc && p >= 1 && p <= doc.numPages) {
          await cache.get(doc, p, px, settings.anisotropy, settings.mipmaps)
        }
      }
      cache.evictExcept(
        new Set(
          [-2, -1, 0, 1, 2, 3].map((d) => cache.key(2 * spread + d, px)),
        ),
        settings.textureBudgetMB * 1024 * 1024,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [doc, cache, spread, targetPx, assign, sheets, settings.anisotropy, settings.mipmaps, settings.textureBudgetMB])

  // ---- turn control ---------------------------------------------------
  useEffect(() => {
    const begin = (dir: 1 | -1) => {
      if (!doc) return false
      const s = spreadRef.current
      if (dir === 1 && rightPage(s) >= doc.numPages) return false
      if (dir === -1 && s <= 0) return false

      const px = targetPxRef.current
      const front = dir === 1 ? 2 * s + 1 : 2 * s - 1
      const back = dir === 1 ? 2 * s + 2 : 2 * s
      void assign(sheets.turning.front, front, px, true)
      void assign(sheets.turning.back, back, px, true)
      // Reveal what sits underneath the sweeping leaf.
      void assign(sheets.left.back, dir === 1 ? 2 * s : 2 * s - 2, px, true)
      void assign(sheets.right.front, dir === 1 ? 2 * s + 3 : 2 * s + 1, px, true)
      sheets.turning.mesh.visible = true
      return true
    }

    api.current = {
      isTurning: () => turnRef.current !== null,
      turn: (dir) => {
        if (turnRef.current) return
        if (begin(dir)) turnRef.current = { dir, progress: 0 }
      },
      pose: (dir, progress) => {
        if (progress === null) {
          turnRef.current = null
          sheets.turning.mesh.visible = false
          return
        }
        if (begin(dir)) turnRef.current = { dir, progress, frozen: true }
      },
    }
  }, [api, doc, assign, sheets])

  // ---- per-frame ------------------------------------------------------
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20)
    const turn = turnRef.current

    // Static spread: gutter curl, mirrored across the spine. Negative on the
    // right / positive on the left makes both sheets rise out of the gutter,
    // because the left sheet's local frame is flipped by its pi base rotation.
    applyGutterCurl(sheets.left.bones, Math.PI, GUTTER_CURL)
    applyGutterCurl(sheets.right.bones, 0, -GUTTER_CURL)

    if (turn) {
      if (!turn.frozen) turn.progress = Math.min(1, turn.progress + dt / TURN_SECONDS)
      const eased = easeInOut(turn.progress)
      // Negative, because +Y rotation swings +X towards -Z -- i.e. down through
      // the desk. The leaf has to lift towards the reader instead.
      const base = turn.dir === 1 ? -eased * Math.PI : -(1 - eased) * Math.PI
      const bend = Math.sin(Math.PI * turn.progress)
      // Bow trails the sweep, so the sign follows the direction of travel.
      applyBow(sheets.turning.bones, base, bend, BOW_AMPLITUDE * turn.dir)
      if (!turn.frozen && turn.progress >= 1) {
        turnRef.current = null
        sheets.turning.mesh.visible = false
        onSpread(spreadRef.current + turn.dir)
      }
    }

    // Measure how many pixels of screen the right-hand page actually occupies.
    // This -- not the texture size -- is the ceiling on legibility.
    sheets.right.mesh.updateWorldMatrix(true, false)
    const m = sheets.right.mesh.matrixWorld
    probe.set(width * 0.5, PAGE_HEIGHT * 0.5, 0).applyMatrix4(m).project(camera)
    const topY = probe.y
    probe.set(width * 0.5, -PAGE_HEIGHT * 0.5, 0).applyMatrix4(m).project(camera)
    const cssPx = (Math.abs(topY - probe.y) / 2) * size.height
    const devicePx = cssPx * gl.getPixelRatio()

    const wanted = quantise(devicePx * settings.supersample)
    if (Math.abs(wanted - targetPxRef.current) / targetPxRef.current > 0.1) {
      targetPxRef.current = wanted
      setTargetPx(wanted)
    }

    const stats = metrics.current
    stats.pageCssPx = cssPx
    stats.pageDevicePx = devicePx
    stats.targetTexturePx = targetPxRef.current
    // Report the texture actually bound to the right-hand page, not the best
    // one sitting in the cache -- they diverge whenever quality changes.
    const bound = sheets.right.front.map?.image as { height?: number } | undefined
    const boundPx = bound?.height ?? 0
    stats.actualTexturePx = boundPx
    stats.texelRatio = devicePx > 0 ? boundPx / devicePx : 0
    stats.textureMB = (cache?.bytes ?? 0) / (1024 * 1024)
    stats.turning = turn !== null
  })

  const stackLeft = Math.max(0.0015, (BOOK_THICKNESS * spread) / Math.max(1, totalLeaves(doc)))
  const stackRight = Math.max(0.0015, BOOK_THICKNESS - stackLeft)
  const blockTop = -(rise + BLOCK_CLEARANCE)

  return (
    <group rotation-x={-settings.tiltRad}>
      {/* covers */}
      <mesh
        position={[-width / 2 - 0.004, 0, blockTop - stackLeft - 0.0025]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width + 0.008, PAGE_HEIGHT + 0.008, 0.003]} />
        <meshStandardMaterial color="#4a3527" roughness={0.75} />
      </mesh>
      <mesh
        position={[width / 2 + 0.004, 0, blockTop - stackRight - 0.0025]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width + 0.008, PAGE_HEIGHT + 0.008, 0.003]} />
        <meshStandardMaterial color="#4a3527" roughness={0.75} />
      </mesh>

      {/* page blocks */}
      <mesh position={[-width / 2, 0, blockTop - stackLeft / 2]} receiveShadow>
        <boxGeometry args={[width, PAGE_HEIGHT, stackLeft]} />
        <meshStandardMaterial color="#efe8d8" roughness={1} />
      </mesh>
      <mesh position={[width / 2, 0, blockTop - stackRight / 2]} receiveShadow>
        <boxGeometry args={[width, PAGE_HEIGHT, stackRight]} />
        <meshStandardMaterial color="#efe8d8" roughness={1} />
      </mesh>

      <primitive object={sheets.left.mesh} />
      <primitive object={sheets.right.mesh} />
      <primitive object={sheets.turning.mesh} />
    </group>
  )
}

function totalLeaves(doc: PDFDocumentProxy | null) {
  return doc ? Math.ceil(doc.numPages / 2) : 1
}
