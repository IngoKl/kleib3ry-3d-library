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

  const width = sheet.kind === 'note' ? NOTE : SHEET.width
  const height = sheet.kind === 'note' ? NOTE : SHEET.height
  const art = sheet.kind === 'note' ? note : texture

  return (
    <group
      position={[sheet.x, sheet.y, sheet.z]}
      rotation-y={sheet.yaw}
      // Carried on the group so a hit anywhere on the sheet — paper or tack —
      // resolves to the sheet.
      userData={{ pinId: sheet.id }}
    >
      <group rotation-z={sheet.tilt}>
        {/* The paper. A page is white card until its raster arrives, which is
            what a page looks like anyway — so there is nothing to hide. */}
        <mesh position={[0, 0, STANDOFF]} castShadow receiveShadow>
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
              color={sheet.kind === 'note' ? NOTE_COLOURS[sheet.colour ?? 0] : '#f1ece0'}
              roughness={0.95}
              emissive={focused ? '#3a3323' : '#000000'}
            />
          )}
        </mesh>

        {/* A drawing pin, at the top. A note is stuck down rather than pinned,
            so it does not get one. */}
        {sheet.kind === 'page' && (
          <mesh position={[0, height / 2 - 0.014, STANDOFF + 0.006]} castShadow>
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
