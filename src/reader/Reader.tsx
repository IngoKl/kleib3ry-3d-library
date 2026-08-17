import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { applyBow, applyGutterCurl, gutterRise, makeSheet, type Sheet } from './pageMesh'
import { makePageTextures, spreadWindow } from './pageTextures'
import { openSource, type PageSource } from './source'
import { readerHandles, readerStatus, resetReaderStatus } from './status'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useAnnotationsStore, pageToSpread } from '../state/annotations'
import {
  endPageStroke,
  extendOnCanvas,
  extendPageStroke,
  pageDrawing,
  paintPageStrokes,
  startPageStroke,
} from './pageInk'
import type { BoardStroke, BookNote } from '../services/types'
import { player } from '../state/player'
import { playOneShot } from '../scene/ambientSound'
import { approach } from '../lib/ease'

/**
 * Read mode. Three constraints that are easy to break:
 *
 *   - the gutter curl must decay to zero, or the sheet dives through the page
 *     block;
 *   - the turn rotates *negatively* about Y, or the leaf sweeps down through
 *     the table;
 *   - the camera *docks* so the spread fills the viewport — legibility is
 *     capped by screen pixels, not texture resolution.
 */

const PAGE_HEIGHT = 0.24
const PAGE_DEPTH = 0.0006
const BOOK_THICKNESS = 0.032
const TURN_SECONDS = 0.85
const BOW_AMPLITUDE = 0.055
const GUTTER_CURL = 0.1
const BLOCK_CLEARANCE = 0.0004
const FOV = 45
/** Texture pixels per screen pixel. The spike found 2x clearly better than 1x. */
const SUPERSAMPLE = 2

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const quantise = (px: number) => Math.max(512, Math.min(4096, Math.round(px / 256) * 256))

/**
 * A leaf in motion.
 *
 * `dragging` means a finger is on it and `progress` comes from the pointer, not
 * from the clock — that is what makes it feel like paper rather than like an
 * animation you triggered. Let go and it settles: to 1 if you carried it far
 * enough or flicked it, back to 0 if you did not, which is how you peek at the
 * next page and change your mind.
 */
type Turn = {
  dir: 1 | -1
  progress: number
  dragging: boolean
  /** Where it is settling to once you let go. */
  target: 0 | 1
}

/**
 * How far a bookmark stands out above the top edge of the page.
 *
 * The dock frames the spread exactly — that is what makes the type legible — so
 * anything proud of the page is cropped unless the frame is opened up to admit
 * it. It is therefore paid for only when a book actually has a bookmark in it,
 * rather than costing every book a few per cent of its text size forever.
 */
const RIBBON_PROUD = 0.015

/**
 * How far a note tab stands out of the fore-edge, sideways. Same bargain as
 * the ribbons: the dock only pays for the extra frame width when the open book
 * actually has a note in it.
 */
const TAB_PROUD = 0.012

/** Fraction of the viewport width a full turn takes. */
const DRAG_SPAN = 0.42
/** Carry a leaf past this and letting go completes the turn. */
const DRAG_COMMIT = 0.32
/** …or flick it faster than this, in fractions of a turn per second. */
const FLICK_SPEED = 1.1

/**
 * Shared empty list for the bookmark selector.
 *
 * Returning a fresh `[]` from a zustand selector is a re-render on every store
 * touch, which for a component that also writes to the store is an infinite
 * loop. One frozen instance keeps the selector referentially stable.
 */
const NO_BOOKMARKS: readonly number[] = Object.freeze([])
/** Same again for the notes and ink selectors, for the same reason. */
const NO_NOTES: readonly BookNote[] = Object.freeze([])
const NO_STROKES: readonly BoardStroke[] = Object.freeze([])

/**
 * Ribbon colours, dealt out in order.
 *
 * From a fixed palette in bookmark order, so the third slip is always the same
 * colour as long as the first two are still in.
 */
const RIBBONS = ['#a8384a', '#3f6b8a', '#4b7a4a', '#a87a2e', '#6b4a7a', '#2f6b6b']
/** The stitched edge of a slip: the same colour, darker. */
const RIBBON_EDGE = ['#6d2130', '#27455a', '#2f4e2f', '#6d4d18', '#452f4f', '#1c4444']

/** Leaf s has recto 2s+1 and verso 2s+2, so spread s shows 2s and 2s+1. */
const leftPage = (spread: number) => 2 * spread
const rightPage = (spread: number) => 2 * spread + 1

export function Reader() {
  const reading = useAppStore((s) => s.reading)
  const setReading = useAppStore((s) => s.setReading)
  const setMode = useAppStore((s) => s.setMode)
  const book = useLibraryStore((s) => (reading ? s.byId.get(reading) : undefined))

  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  const [doc, setDoc] = useState<PageSource | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [spread, setSpread] = useState(0)

  const rise = useMemo(() => gutterRise(PAGE_HEIGHT * 0.77, GUTTER_CURL), [])
  const [aspect, setAspect] = useState(0.77)
  const width = PAGE_HEIGHT * aspect

  const sheets = useMemo<{ left: Sheet; right: Sheet; turning: Sheet }>(() => {
    const left = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    const right = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    const turning = makeSheet(width, PAGE_HEIGHT, PAGE_DEPTH)
    left.mesh.position.z = -rise
    right.mesh.position.z = -rise
    turning.mesh.position.z = 0.0016
    turning.mesh.visible = false
    return { left, right, turning }
  }, [width, rise])

  const turnRef = useRef<Turn | null>(null)
  /**
   * One keyboard press remembered while a leaf is already in flight, started
   * the moment that leaf lands — tapping twice to skim two pages must not lose
   * the second tap. One, not a queue: a third press replaces the second.
   */
  const pendingRef = useRef<1 | -1 | null>(null)
  /**
   * True while a lift's faces are still rasterising — before `turnRef` exists.
   * The queue has to see this window too, or a quick second tap on a cold
   * spread starts a rival load instead of being remembered.
   */
  const armedRef = useRef(false)
  /** `lift`, mirrored out of the input effect so the frame loop can start it. */
  const liftRef = useRef<((dir: 1 | -1, held: boolean) => void) | null>(null)
  const spreadRef = useRef(spread)
  spreadRef.current = spread

  /** Pointer bookkeeping for a drag in flight. */
  const drag = useRef<{ startX: number; lastX: number; lastAt: number; speed: number } | null>(null)
  /** Set by the ribbons: returns true if a pointer press landed on one. */
  const jumpRef = useRef<((e: PointerEvent) => boolean) | null>(null)
  const ribbons = useRef<THREE.Group>(null)
  const noteTabs = useRef<THREE.Group>(null)

  /**
   * Whether the pen is picked up, mirrored into a ref so the pointer handlers
   * can read it without re-subscribing.
   */
  const [pen, setPen] = useState(false)
  const penRef = useRef(pen)
  penRef.current = pen
  useEffect(() => {
    readerStatus.pen = pen
  }, [pen])
  useEffect(() => {
    if (!reading) setPen(false)
  }, [reading])

  /** Where the book sits: in front of wherever you were standing. */
  const pose = useMemo(() => {
    const yaw = player.yaw
    return {
      position: new THREE.Vector3(
        player.x - Math.sin(yaw) * 0.62,
        1.22,
        player.z - Math.cos(yaw) * 0.62,
      ),
      yaw,
      tilt: THREE.MathUtils.degToRad(22),
    }
    // Captured once per book, deliberately: the book should not follow you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading])

  // ---- load ------------------------------------------------------------
  useEffect(() => {
    if (!reading || !book) return
    let cancelled = false
    setDoc(null)
    setFailure(null)
    // Open at the spread you left off, not at the cover: the position is
    // saved on every turn precisely so coming back resumes.
    setSpread(useLibraryStore.getState().readProgress[reading] ?? 0)

    resetReaderStatus(reading)
    // A press remembered in the last book must not turn a page in this one,
    // and a lift still rasterising there must not arm a turn in this one.
    pendingRef.current = null
    armedRef.current = false

    // A PDF is rasterised by pdf.js and an EPUB is set in type here; which of
    // the two this is, is the last thing in read mode that knows.
    let live: PageSource | null = null

    void openSource(book)
      .then((opened) => {
        if (cancelled) {
          opened.close()
          return
        }
        live = opened
        setAspect(opened.aspect)
        readerStatus.pages = opened.pages
        // A saved position can outrun the file if it changed on disk.
        setSpread((s) => Math.max(0, Math.min(s, Math.floor(opened.pages / 2))))
        setDoc(opened)
      })
      .catch((e) => {
        if (cancelled) return
        const why = e instanceof Error ? e.message : String(e)
        setFailure(why)
        readerStatus.failure = why
      })

    return () => {
      cancelled = true
      // Release the reader's hold; a PDF is destroyed once no cover or page
      // render still shares it. Without this every book ever opened stayed
      // resident in the pdf.js worker for the life of the app.
      live?.close()
    }
  }, [reading, book])

  // Closing the book must also let go of its textures: the component stays
  // mounted, so without this the last book's full-resolution page cache
  // survived until a different book was opened.
  useEffect(() => {
    if (reading) return
    setDoc(null)
    setFailure(null)
  }, [reading])

  // ---- page textures ---------------------------------------------------
  const targetPx = useMemo(
    () => quantise(size.height * gl.getPixelRatio() * SUPERSAMPLE),
    [size.height, gl],
  )

  const pages = useMemo(
    () =>
      doc
        ? makePageTextures(doc, targetPx, gl, (canvas, page) => {
            // The ink rides the rasterised page itself, so it bends with the
            // leaf and costs nothing the page did not already cost.
            const id = readerStatus.bookId
            if (id) paintPageStrokes(canvas, useAnnotationsStore.getState().strokesOn(id, page))
          })
        : null,
    [doc, targetPx, gl],
  )
  useEffect(() => () => pages?.dispose(), [pages])

  // The probe's window onto the page canvases, for the ink-visibility tests.
  useEffect(() => {
    readerHandles.pageCanvas = (page) => {
      const image = pages?.peek(page)?.image as unknown
      return image instanceof HTMLCanvasElement ? image : null
    }
    return () => {
      readerHandles.pageCanvas = null
    }
  }, [pages])

  /**
   * Put a spread on the static sheets, but only if both its pages are already
   * rasterised. Synchronous and all-or-nothing on purpose: this is what the
   * turn commits through, and a half-applied spread is the flash we are here to
   * remove.
   */
  const showSpread = useCallback(
    (s: number) => {
      if (!pages) return false
      const left = pages.peek(leftPage(s))
      const right = pages.peek(rightPage(s))
      if (left === undefined || right === undefined) return false

      sheets.left.back.map = left
      sheets.left.back.needsUpdate = true
      sheets.right.front.map = right
      sheets.right.front.needsUpdate = true

      readerStatus.spread = s
      readerStatus.showing = [leftPage(s), rightPage(s)]
      // Republished here rather than only on open: re-opening the book you are
      // already on does not re-run the load effect, so the count set there
      // would be whatever the last reset left behind.
      readerStatus.pages = doc?.pages ?? readerStatus.pages
      readerStatus.rendered = true
      // Whatever was being sought, this is now what is shown.
      readerStatus.seeking = false
      return true
    },
    [pages, sheets, doc],
  )

  useEffect(() => {
    if (!pages) return
    let cancelled = false

    pages.pin(spreadWindow(spread))
    if (!showSpread(spread)) {
      void Promise.all([pages.load(leftPage(spread)), pages.load(rightPage(spread))]).then(() => {
        if (!cancelled) showSpread(spread)
      })
    }

    // Rasterise the neighbours while nothing is happening, so the next turn —
    // in either direction — has its destination ready before the leaf lands.
    for (const page of spreadWindow(spread)) void pages.load(page)

    return () => {
      cancelled = true
    }
  }, [pages, spread, showSpread])

  // ---- input -----------------------------------------------------------
  const bookmarks = useAnnotationsStore((s) =>
    reading ? (s.bookmarks[reading] ?? NO_BOOKMARKS) : NO_BOOKMARKS,
  )
  const toggleBookmark = useAnnotationsStore((s) => s.toggleBookmark)
  const notes = useAnnotationsStore((s) => (reading ? (s.notes[reading] ?? NO_NOTES) : NO_NOTES))
  /** The distinct pages with a note on them: one tab per page, not per note. */
  const notedPages = useMemo(() => [...new Set(notes.map((n) => n.page))], [notes])
  const drawOnPage = useAnnotationsStore((s) => s.drawOnPage)
  const leftStrokes = useAnnotationsStore((s) =>
    reading ? (s.drawings[reading]?.[leftPage(spread)] ?? NO_STROKES) : NO_STROKES,
  )
  const rightStrokes = useAnnotationsStore((s) =>
    reading ? (s.drawings[reading]?.[rightPage(spread)] ?? NO_STROKES) : NO_STROKES,
  )
  const setProgress = useLibraryStore((s) => s.setProgress)
  // Spread s shows pages 2s and 2s+1, so the last page lives on spread
  // floor(N/2) — `ceil(N/2)` undercounted by one for even page counts, which
  // made the final page unreachable by "go to page".
  const spreadCount = doc ? Math.floor(doc.pages / 2) + 1 : 0

  /**
   * A wipe is the one edit that takes ink *off* a page, and the canvas cannot
   * unpaint — so a shrunken stroke list re-rasterises the page from the source
   * and the decorate hook repaints what is left. A stroke that lands (the list
   * grows) was already drawn live and needs nothing.
   */
  const inkWatermark = useRef({ spread: -1, left: 0, right: 0 })
  useEffect(() => {
    const prev = inkWatermark.current
    const sameSpread = prev.spread === spread
    inkWatermark.current = { spread, left: leftStrokes.length, right: rightStrokes.length }
    if (!pages || !sameSpread) return
    const wipedLeft = leftStrokes.length < prev.left
    const wipedRight = rightStrokes.length < prev.right
    if (!wipedLeft && !wipedRight) return
    void Promise.all([
      wipedLeft ? pages.refresh(leftPage(spread)) : null,
      wipedRight ? pages.refresh(rightPage(spread)) : null,
    ]).then(() => showSpread(spread))
  }, [leftStrokes, rightStrokes, pages, spread, showSpread])

  /**
   * Remember the page, so putting the book down open puts it down *here*.
   *
   * Written on every spread change rather than on close, because "close" is
   * `Esc`, closing the window, or walking away, and only the first of those is
   * something the reader would get to hear about.
   */
  useEffect(() => {
    // Gated on the document being open: before that, `spread` is still the
    // transient 0 of a mounting reader, and writing it would erase the very
    // position about to be restored.
    if (reading && doc) setProgress(reading, spread)
  }, [reading, doc, spread, setProgress])

  /**
   * Jump to a page somebody typed.
   *
   * Deliberately a jump and not a flurry of turns: "go to page 400" means open
   * it there, the way you would with a thumb, not leaf through two hundred
   * spreads. Any leaf in flight is put away first, exactly as grabbing a ribbon
   * does — a turn landing after the jump would undo it.
   */
  const jumpRequest = useAppStore((s) => s.jumpTo)
  const clearJump = useAppStore((s) => s.requestJump)
  useEffect(() => {
    if (jumpRequest === null || !doc) return
    const target = Math.max(0, Math.min(spreadCount - 1, jumpRequest))
    if (turnRef.current) {
      turnRef.current = null
      sheets.turning.mesh.visible = false
      readerStatus.turning = false
    }
    // A remembered press would land after the jump and undo it, like the turn.
    pendingRef.current = null
    // The HUD says "Finding the page…" until the sheets catch up.
    if (target !== spreadRef.current) readerStatus.seeking = true
    setSpread(target)
    clearJump(null)
  }, [jumpRequest, doc, spreadCount, sheets, clearJump])

  useEffect(() => {
    if (!reading) return

    /**
     * Which page is under the pointer, and where on it — raycast against the
     * two resting sheets themselves and read the hit's texture coordinates.
     * The uv is exact on the curled part near the gutter, where any flat-plane
     * substitute puts the ink centimetres from the pointer; and it is already
     * in page space, the frame the strokes are stored in.
     */
    const penCaster = new THREE.Raycaster()
    const penPointer = new THREE.Vector2()
    const penHit = (e: PointerEvent): { page: number; u: number; v: number } | null => {
      const rect = canvas.getBoundingClientRect()
      penPointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      penCaster.setFromCamera(penPointer, camera)
      const hit = penCaster.intersectObjects([sheets.left.mesh, sheets.right.mesh], false)[0]
      if (!hit?.uv) return null
      const s = spreadRef.current
      const page = hit.object === sheets.left.mesh ? leftPage(s) : rightPage(s)
      return { page, u: hit.uv.x, v: hit.uv.y }
    }

    /**
     * Lift a leaf. `held` starts it under the pointer instead of letting it
     * fall on its own; either way nothing moves until its two faces have
     * rasterised, so a leaf never swings blank.
     */
    const lift = (dir: 1 | -1, held: boolean) => {
      if (!doc || !pages || turnRef.current || armedRef.current) return
      const s = spreadRef.current
      if (dir === 1 && rightPage(s) >= doc.pages) return
      if (dir === -1 && s <= 0) return

      const front = dir === 1 ? 2 * s + 1 : 2 * s - 1
      const back = dir === 1 ? 2 * s + 2 : 2 * s

      armedRef.current = true
      void Promise.all([pages.load(front), pages.load(back)]).then(([a, b]) => {
        armedRef.current = false
        // A second press while these were rendering already started a turn.
        if (turnRef.current) return
        // And the reader may have closed under them: a leaf must not start
        // turning in a book nobody is reading any more.
        if (useAppStore.getState().reading !== reading) return
        // Nor in one whose spread moved under the load — a jump landed first,
        // and a turn from the old spread would quietly undo it.
        if (spreadRef.current !== s) return
        sheets.turning.front.map = a
        sheets.turning.front.needsUpdate = true
        sheets.turning.back.map = b
        sheets.turning.back.needsUpdate = true
        sheets.turning.mesh.visible = true
        readerStatus.turning = true
        // A click that ended before the faces rasterised has no pointer on the
        // leaf any more; installing it as `dragging` would strand a turn the
        // frame loop never advances and block every turn after it. A finished
        // click means a turn, so let it fall on its own.
        const dragging = held && drag.current !== null
        turnRef.current = { dir, progress: 0, dragging, target: 1 }

        // The leaf takes a moment to fall; use it to make sure the spread it
        // lands on can be committed the instant it does.
        for (const page of spreadWindow(s + dir)) void pages.load(page)
      })
    }
    // The frame loop consumes the remembered press the instant a turn lands,
    // and `lift` lives in this effect, so it reaches out through a ref.
    liftRef.current = lift

    const onKey = (e: KeyboardEvent) => {
      // While the page field or the settings panel is open, every key is a
      // keystroke in it.
      const app = useAppStore.getState()
      if (app.jumping || app.settingsOpen || app.annotating) return
      // Held, an arrow key would queue a turn per repeat and `B` would put a
      // bookmark in and take it out again thirty times a second. A page turn is
      // a press. (See the note in `Player.tsx`.)
      if (e.repeat) return

      if (e.code === 'KeyJ') {
        e.preventDefault()
        useAppStore.getState().setJumping(true)
        return
      }
      if (e.code === 'KeyP') {
        e.preventDefault()
        /**
         * Tear out the page you are looking at — which copies it and leaves the
         * book exactly as it was. Nothing is removed from anything: the sheet
         * records which book and which page, and is rasterised from the same
         * file next time it is drawn. "Tear out" is the gesture, not the effect.
         *
         * The recto, the right-hand page, because that is the one a hand reaches
         * for; on the last spread of an odd-paged book there is no recto, so the
         * verso is what you get.
         */
        const app = useAppStore.getState()
        // One sheet at a time. Silently replacing the one you were about to pin
        // up would throw work away, and the HUD says what to do about it.
        if (app.heldPin || !doc) return
        const s = spreadRef.current
        const page = rightPage(s) <= doc.pages ? rightPage(s) : leftPage(s)
        if (page < 1 || page > doc.pages) return
        app.setHeldPin({ kind: 'page', bookId: reading, page })
        playOneShot('rustle', 0.9, { rate: 1.05 })
        return
      }
      if (e.code === 'KeyN') {
        e.preventDefault()
        // The note lands on the recto by the tear-out convention, and the
        // field needs a page to land it on, so no book means no field.
        if (doc) useAppStore.getState().setAnnotating(true)
        return
      }
      if (e.code === 'KeyD') {
        e.preventDefault()
        // Pick the pen up, or put it down. While it is up a drag is a line,
        // not a page turn; the arrows still turn pages.
        if (doc) setPen((p) => !p)
        return
      }
      if (e.code === 'F1') {
        // The controls card advertises the reading keys; it has to be
        // reachable — and dismissable — while actually reading.
        e.preventDefault()
        const app = useAppStore.getState()
        app.setControlsOpen(!app.controlsOpen)
        return
      }
      if (e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault()
        // Mid-turn — or mid-load, before the leaf exists — the press is
        // remembered rather than swallowed, so tapping twice skims two pages.
        // Keyboard only: a drag is not a queueable wish.
        if (turnRef.current || armedRef.current) pendingRef.current = 1
        else lift(1, false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (turnRef.current || armedRef.current) pendingRef.current = -1
        else lift(-1, false)
      } else if (e.code === 'KeyB') {
        e.preventDefault()
        toggleBookmark(reading, spreadRef.current)
      } else if (e.key === 'Escape' || e.code === 'KeyR') {
        // Esc peels one layer at a time: the controls card first, the book
        // second — matching the walk controller, where Esc closes the card.
        if (e.key === 'Escape' && app.controlsOpen) {
          app.setControlsOpen(false)
          return
        }
        setReading(null)
        setMode('walk')
      }
    }

    // ---- dragging a page ----
    const canvas = gl.domElement

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return

      // A bookmark under the pointer is a jump, not a drag: the slips stand
      // proud of the page block precisely so they can be grabbed.
      const jumped = jumpRef.current?.(e)
      if (jumped) return

      if (penRef.current) {
        // The pen is up: a press on a page starts a line there, and a press
        // off the pages is nothing — never a turn, or drawing to the edge
        // would flip the page out from under the stroke.
        const hit = penHit(e)
        if (!hit || !doc || hit.page < 1 || hit.page > doc.pages) return
        startPageStroke(hit.page, hit.u, hit.v)
        canvas.setPointerCapture(e.pointerId)
        return
      }

      // Which half you start from decides which way the leaf goes, the same way
      // it does with a real book: right side turns forward, left side back.
      const dir: 1 | -1 = e.clientX > canvas.clientWidth / 2 ? 1 : -1
      drag.current = { startX: e.clientX, lastX: e.clientX, lastAt: e.timeStamp, speed: 0 }
      lift(dir, true)
      canvas.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (pageDrawing.page !== null) {
        // Ink goes straight onto the page's own canvas, a segment at a time,
        // and the texture re-uploads — the cost of drawing, paid only while
        // the pen is down. The stroke stays on the page it started on; carry
        // the pointer off it and the line simply waits for it to come back.
        const hit = penHit(e)
        if (!hit || !pages || hit.page !== pageDrawing.page) return
        if (extendPageStroke(hit.u, hit.v)) {
          const texture = pages.peek(pageDrawing.page)
          const image = texture?.image as unknown
          if (texture && image instanceof HTMLCanvasElement) {
            extendOnCanvas(image)
            texture.needsUpdate = true
          }
        }
        return
      }

      const state = drag.current
      const turn = turnRef.current
      if (!state || !turn || !turn.dragging) return

      const span = Math.max(1, canvas.clientWidth * DRAG_SPAN)
      // Forward turns are dragged right-to-left, back turns left-to-right.
      const travelled = (state.startX - e.clientX) * turn.dir
      const progress = Math.max(0, Math.min(1, travelled / span))

      const dt = Math.max(1, e.timeStamp - state.lastAt) / 1000
      state.speed = ((e.clientX - state.lastX) * -turn.dir) / span / dt
      state.lastX = e.clientX
      state.lastAt = e.timeStamp
      turn.progress = progress
    }

    const onPointerUp = (e: PointerEvent) => {
      if (pageDrawing.page !== null) {
        // Let go: the line is finished and only now becomes a fact — the
        // canvas already shows it, so nothing needs repainting.
        const done = endPageStroke()
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
        if (done && reading) drawOnPage(reading, done.page, done.stroke)
        return
      }

      const state = drag.current
      const turn = turnRef.current
      drag.current = null
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      if (!state || !turn || !turn.dragging) return

      turn.dragging = false
      // Carried far enough, or thrown hard enough. Otherwise it falls back and
      // the spread you were on is the spread you stay on.
      const committing = turn.progress > DRAG_COMMIT || state.speed > FLICK_SPEED
      turn.target = committing ? 1 : 0
    }

    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      liftRef.current = null
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
    }
  }, [reading, doc, pages, sheets, gl, camera, setReading, setMode, toggleBookmark, drawOnPage])

  /**
   * Grabbing a ribbon. Raycast in page coordinates rather than screen ones so
   * the slips stay hittable however the book happens to be posed.
   */
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const pointer = useMemo(() => new THREE.Vector2(), [])
  useEffect(() => {
    jumpRef.current = (e: PointerEvent) => {
      // Ribbons and note tabs alike: both carry the spread they mark.
      const grabbable = [
        ...(ribbons.current?.children ?? []),
        ...(noteTabs.current?.children ?? []),
      ]
      if (grabbable.length === 0) return false

      const rect = gl.domElement.getBoundingClientRect()
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(grabbable, true)[0]
      const target = hit?.object.userData.spread ?? hit?.object.parent?.userData.spread
      if (typeof target !== 'number' || target === spreadRef.current) return false

      // A jump, not a turn: you are not leafing through to get there, you are
      // opening the book at the slip you left in it.
      if (turnRef.current) {
        turnRef.current = null
        sheets.turning.mesh.visible = false
        readerStatus.turning = false
      }
      pendingRef.current = null
      setSpread(target)
      return true
    }
    return () => {
      jumpRef.current = null
    }
  }, [camera, gl, raycaster, pointer, sheets])

  // ---- per frame -------------------------------------------------------
  useFrame((_, rawDelta) => {
    if (!reading) return
    const delta = Math.min(rawDelta, 1 / 20)

    applyGutterCurl(sheets.left.bones, Math.PI, GUTTER_CURL)
    applyGutterCurl(sheets.right.bones, 0, -GUTTER_CURL)

    const turn = turnRef.current
    if (turn) {
      // Under the pointer the leaf goes where the pointer goes; let go and it
      // settles under its own weight, forwards or back.
      if (!turn.dragging) {
        const step = delta / TURN_SECONDS
        turn.progress =
          turn.target === 1
            ? Math.min(1, turn.progress + step)
            : Math.max(0, turn.progress - step)
      }

      readerStatus.progress = turn.progress
      const eased = easeInOut(turn.progress)
      // Negative: +Y rotation would sweep the leaf down through the table.
      const base = turn.dir === 1 ? -eased * Math.PI : -(1 - eased) * Math.PI
      applyBow(
        sheets.turning.bones,
        base,
        Math.sin(Math.PI * turn.progress),
        BOW_AMPLITUDE * turn.dir,
      )
      // Dropped back: no turn happened, so put the leaf away and leave the
      // spread alone. This is what makes a half-drag a peek rather than a
      // commitment.
      if (turn.target === 0 && !turn.dragging && turn.progress <= 0) {
        turnRef.current = null
        sheets.turning.mesh.visible = false
        readerStatus.turning = false
        readerStatus.progress = 0
        // No spread landed, so there is nothing for a remembered press to follow.
        pendingRef.current = null
        // A leaf let fall back is quieter than a turn that lands.
        playOneShot('swish', 0.4)
      }

      // Commit only once the destination is on the GPU, and do it in one frame:
      // paint the static sheets, then hide the leaf. If the pages are not ready
      // the leaf simply rests flat — already showing the new left page on its
      // back face — instead of exposing the spread we just turned away from.
      if (turn.target === 1 && turn.progress >= 1) {
        const next = spreadRef.current + turn.dir
        if (showSpread(next)) {
          turnRef.current = null
          sheets.turning.mesh.visible = false
          readerStatus.turning = false
          setSpread(next)
          playOneShot('swish')
          // A press that arrived mid-turn starts now, from the spread just
          // landed on; `lift` refuses one that would run off either cover.
          const queued = pendingRef.current
          pendingRef.current = null
          if (queued) {
            // `spreadRef` lags `setSpread` until the re-render.
            spreadRef.current = next
            liftRef.current?.(queued, false)
          }
        } else if (pages) {
          // The prefetch started these a second ago and `load` deduplicates, so
          // this normally costs a map lookup. It is here so that waiting can
          // never become hanging: a leaf must not rest flat forever waiting on
          // a render nobody asked for.
          void pages.load(leftPage(next))
          void pages.load(rightPage(next))
        }
      }
    }

    // Dock: the open spread should fill the frame, which is the only way the
    // type is large enough to read.
    const vfov = THREE.MathUtils.degToRad(FOV)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height))
    const halfHeight = PAGE_HEIGHT / 2 + (bookmarks.length ? RIBBON_PROUD : 0)
    const halfWidth = width + (notedPages.length ? TAB_PROUD : 0)
    const distance =
      Math.max(halfHeight / Math.tan(vfov / 2), halfWidth / Math.tan(hfov / 2)) * 1.05

    const normal = new THREE.Vector3(0, Math.sin(pose.tilt), Math.cos(pose.tilt)).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      pose.yaw,
    )
    const want = pose.position.clone().addScaledVector(normal, distance)

    camera.position.lerp(want, approach(6, delta))
    camera.lookAt(pose.position)
    if ((camera as THREE.PerspectiveCamera).fov !== FOV) {
      ;(camera as THREE.PerspectiveCamera).fov = FOV
      camera.updateProjectionMatrix()
    }
  })

  useEffect(() => {
    const { left, right, turning } = sheets
    return () => {
      left.dispose()
      right.dispose()
      turning.dispose()
    }
  }, [sheets])

  if (!reading || !book) return null

  return (
    <group position={pose.position} rotation={[0, pose.yaw, 0]}>
      <group rotation-x={-pose.tilt}>
        <mesh position={[-width / 2, 0, -(rise + BLOCK_CLEARANCE) - BOOK_THICKNESS / 4]}>
          <boxGeometry args={[width, PAGE_HEIGHT, BOOK_THICKNESS / 2]} />
          <meshStandardMaterial color="#efe8d8" roughness={1} />
        </mesh>
        <mesh position={[width / 2, 0, -(rise + BLOCK_CLEARANCE) - BOOK_THICKNESS / 4]}>
          <boxGeometry args={[width, PAGE_HEIGHT, BOOK_THICKNESS / 2]} />
          <meshStandardMaterial color="#efe8d8" roughness={1} />
        </mesh>
        <primitive object={sheets.left.mesh} />
        <primitive object={sheets.right.mesh} />
        <primitive object={sheets.turning.mesh} />

        {/* Bookmarks: slips of ribbon standing out of the top edge, placed
            along the width by how far into the book they are — so the shape of
            where you have been is visible without opening anything. */}
        <group ref={ribbons}>
          {bookmarks.map((mark, index) => {
            const t = spreadCount > 1 ? mark / (spreadCount - 1) : 0.5
            const x = (t - 0.5) * width * 1.9
            const here = mark === spread
            const colour = RIBBONS[index % RIBBONS.length]!
            const edge = RIBBON_EDGE[index % RIBBON_EDGE.length]!
            return (
              <group
                key={mark}
                // Half in, half out: a slip tucked between the pages with a tab
                // showing, rather than a flag planted on top of the book.
                position={[x, PAGE_HEIGHT / 2, -rise - BOOK_THICKNESS / 4]}
                userData={{ spread: mark }}
              >
                {/* A darker slip behind the coloured one, a whisker larger on
                    every side. Two ribbons of similar colour sitting next to
                    each other read as one wide ribbon without it. */}
                <mesh userData={{ spread: mark }}>
                  <boxGeometry args={[0.021, RIBBON_PROUD * 2 + 0.003, BOOK_THICKNESS / 2 + 0.001]} />
                  <meshStandardMaterial color={edge} roughness={0.9} />
                </mesh>
                <mesh position={[0, 0, 0.0012]} userData={{ spread: mark }}>
                  <boxGeometry args={[0.016, RIBBON_PROUD * 2, BOOK_THICKNESS / 2]} />
                  <meshStandardMaterial
                    color={colour}
                    roughness={0.85}
                    // The one you are on glows rather than changing colour, so
                    // it keeps the identity you learned it by.
                    emissive={here ? colour : '#000000'}
                    emissiveIntensity={here ? 0.55 : 0}
                  />
                </mesh>
              </group>
            )
          })}
        </group>

        {/* Notes: paper tabs standing out of the fore-edges, one per noted
            page — verso pages tab the left edge, recto the right — placed down
            the edge by how far into the book the page is, the way a real tab
            descends a well-thumbed reference. */}
        <group ref={noteTabs}>
          {notedPages.map((page) => {
            const mark = pageToSpread(page)
            const t = spreadCount > 1 ? mark / (spreadCount - 1) : 0.5
            const y = (0.5 - t) * (PAGE_HEIGHT - 0.03)
            const recto = page % 2 === 1
            const here = mark === spread
            return (
              <group
                key={page}
                // Half in, half out of the fore-edge, like the ribbons above.
                position={[recto ? width : -width, y, -rise - BOOK_THICKNESS / 4]}
                userData={{ spread: mark }}
              >
                <mesh userData={{ spread: mark }}>
                  <boxGeometry args={[TAB_PROUD * 2, 0.018, BOOK_THICKNESS / 2]} />
                  <meshStandardMaterial
                    color="#dcbf5a"
                    roughness={0.9}
                    // Same convention as the ribbons: the page you are on glows.
                    emissive={here ? '#dcbf5a' : '#000000'}
                    emissiveIntensity={here ? 0.55 : 0}
                  />
                </mesh>
              </group>
            )
          })}
        </group>
      </group>
      {failure && (
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[width * 1.6, 0.06]} />
          <meshBasicMaterial color="#2a211a" />
        </mesh>
      )}
    </group>
  )
}
