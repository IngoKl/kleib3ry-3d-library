import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { NOTE, NOTE_COLOURS, SHEET, noteTexture, onPageReady, pageTextureFor, peekPage } from './pinArt'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import type { PinnedSheet } from '../services/types'

/**
 * The pages and notes stuck to the walls.
 *
 * Real meshes rather than instances, unlike almost everything else you can point
 * at in here — and deliberately so. Every sheet carries a *different* texture:
 * a page out of a different book, a note with different words on it. An atlas
 * cell of the size a page needs to be readable is most of an atlas, so there is
 * nothing to gain by batching them, and there are a dozen of these rather than a
 * thousand. Two draw calls each, and you made each one by hand.
 */

/** How far off the wall a sheet sits, so it never z-fights the plaster. */
const STANDOFF = 0.004

/**
 * How thick the paper is.
 *
 * A sheet used to be a single plane, which is right up until you stand beside
 * one: a note seen from the side was a coloured line, and a board of them at a
 * glancing angle disappeared entirely. Paper has a body. A note is a small pad
 * of them stuck down, so it gets rather more than a page does.
 */
const PAGE_BODY = 0.0009
const NOTE_BODY = 0.0035

/** One sheet: a page, or a note, with a tack through the top of it. */
function Sheet({ sheet, focused }: { sheet: PinnedSheet; focused: boolean }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(() =>
    sheet.kind === 'page' && sheet.bookId ? (peekPage(sheet.bookId, sheet.page ?? 1) ?? null) : null,
  )

  // A note's artwork is made here and belongs to this sheet; a page's is cached
  // globally and shared, so only the note is disposed of on unmount.
  const note = useMemo(
    () => (sheet.kind === 'note' ? noteTexture(sheet.text ?? '', sheet.colour ?? 0) : null),
    [sheet.kind, sheet.text, sheet.colour],
  )
  useEffect(() => () => note?.dispose(), [note])

  useEffect(() => {
    if (sheet.kind !== 'page' || !sheet.bookId) return
    const page = sheet.page ?? 1
    let cancelled = false
    void pageTextureFor(sheet.bookId, page).then((loaded) => {
      if (!cancelled) setTexture(loaded)
    })
    // A page that arrives while several sheets show the same one has to reach
    // all of them, and only one of them started the render.
    const listener = (key: string) => {
      if (key === `${sheet.bookId}:${page}`) setTexture(peekPage(sheet.bookId!, page) ?? null)
    }
    onPageReady.add(listener)
    return () => {
      cancelled = true
      onPageReady.delete(listener)
    }
  }, [sheet.kind, sheet.bookId, sheet.page])

  const isNote = sheet.kind === 'note'
  const width = isNote ? NOTE : SHEET.width
  const height = isNote ? NOTE : SHEET.height
  const art = isNote ? note : texture
  const paper = isNote ? NOTE_COLOURS[(sheet.colour ?? 0) % NOTE_COLOURS.length]! : '#f1ece0'
  const body = isNote ? NOTE_BODY : PAGE_BODY

  return (
    <group
      position={[sheet.x, sheet.y, sheet.z]}
      rotation-y={sheet.yaw}
      // Carried on the group so a hit anywhere on the sheet — paper or tack —
      // resolves to the sheet.
      userData={{ pinId: sheet.id }}
    >
      <group rotation-z={sheet.tilt}>
        {/* The body of the paper: a slab, so the sheet has an edge to catch the
            light and a shadow to sit in. This is what carries `castShadow` —
            a plane's shadow is a line. */}
        <mesh position={[0, 0, STANDOFF + body / 2]} castShadow receiveShadow>
          <boxGeometry args={[width, height, body]} />
          <meshStandardMaterial color={paper} roughness={0.95} />
        </mesh>

        {/* The printed face, a hair proud of the body. A page is white card
            until its raster arrives, which is what a page looks like anyway —
            so there is nothing to hide. */}
        <mesh position={[0, 0, STANDOFF + body + 0.0002]} receiveShadow>
          <planeGeometry args={[width, height]} />
          {/* Keyed so the raster arriving mounts a *new* material: swapping a
              map into a live one reuses its map-less shader and draws black,
              which is the trap the picture frames and the television both fell
              into before this. */}
          {art ? (
            <meshStandardMaterial
              key="art"
              map={art}
              roughness={0.92}
              side={THREE.FrontSide}
              emissive={focused ? '#3a3323' : '#000000'}
            />
          ) : (
            <meshStandardMaterial
              key="blank"
              color={paper}
              roughness={0.95}
              emissive={focused ? '#3a3323' : '#000000'}
            />
          )}
        </mesh>

        {/* The bottom corner, lifting. Only a note gets one: a note is stuck
            down by a gummed strip along its top and curls away from the wall
            from the bottom up, which is the single detail that stops a coloured
            square reading as a sticker printed on the plaster. */}
        {isNote && (
          <mesh
            position={[width * 0.28, -height * 0.4, STANDOFF + body + 0.004]}
            rotation-x={0.55}
            rotation-z={-0.22}
            castShadow
          >
            <planeGeometry args={[width * 0.44, height * 0.3]} />
            <meshStandardMaterial color={paper} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* A drawing pin, at the top. A note is stuck down rather than pinned,
            so it does not get one. */}
        {!isNote && (
          <mesh position={[0, height / 2 - 0.014, STANDOFF + body + 0.006]} castShadow>
            <sphereGeometry args={[0.008, 8, 6]} />
            <meshStandardMaterial color="#b4443c" roughness={0.4} metalness={0.2} />
          </mesh>
        )}
      </group>
    </group>
  )
}

export function Pinned() {
  const pins = useLibraryStore((s) => s.pins)
  const focusedPin = useAppStore((s) => s.focusedPin)
  const group = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    sceneRefs.pinned = group.current
    return () => {
      sceneRefs.pinned = null
    }
  }, [pins])

  return (
    <group ref={group}>
      {pins.map((sheet) => (
        <Sheet key={sheet.id} sheet={sheet} focused={focusedPin === sheet.id} />
      ))}
    </group>
  )
}
