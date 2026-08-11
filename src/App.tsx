import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Lighting } from './scene/Lighting'
import { Rooms } from './scene/Rooms'
import { Furniture } from './scene/Furniture'
import { Bookshelves } from './scene/Bookshelves'
import { Books } from './scene/Books'
import { BoxedBooks } from './scene/BoxedBooks'
import { Interaction } from './scene/Interaction'
import { PlacementGhost } from './scene/PlacementGhost'
import { Player } from './scene/Player'
import { HeldBook } from './scene/HeldBook'
import { Probe } from './scene/Probe'
import { Reader } from './reader/Reader'
import { readerStatus } from './reader/status'
import { Hud } from './ui/Hud'
import { metrics } from './state/metrics'
import { EYE_HEIGHT, player, teleport } from './state/player'
import { useAppStore } from './state/store'
import { useLibraryStore } from './state/library'
import { useWorldStore } from './state/world'
import { library } from './services'
import { setWorldText } from './services/browserDriver'
import { roomAt } from './world/derive'
import { sceneRefs } from './scene/refs'
import { ASSIGNABLE_SLOTS } from './scene/spineAtlas'

export default function App() {
  const loadRoot = useAppStore((s) => s.loadRoot)
  const rootLoaded = useAppStore((s) => s.rootLoaded)
  const loadLibrary = useLibraryStore((s) => s.load)
  const libraryLoaded = useLibraryStore((s) => s.loaded)
  const loadWorld = useWorldStore((s) => s.load)
  const watchWorld = useWorldStore((s) => s.watch)
  const worldLoaded = useWorldStore((s) => s.loaded)

  // The world has to be up before the library, or there are no shelves to
  // reconcile against and every book would look like it had nowhere to go.
  useEffect(() => {
    void (async () => {
      await loadWorld()
      await loadRoot()
      await loadLibrary()
    })()
  }, [loadWorld, loadRoot, loadLibrary])

  useEffect(() => watchWorld(), [watchWorld])

  // Stand where the document says to, once. A live reload must not pick you up
  // and put you back at the door mid-browse.
  const spawned = useRef(false)
  useEffect(() => {
    const world = useWorldStore.getState().world
    if (!world || spawned.current) return
    spawned.current = true
    teleport(world.spawn.x, world.spawn.z, world.spawn.yaw)
  }, [worldLoaded])

  // Verification surface. Pointer lock is unavailable to a headless driver, so
  // teleport/look exist to put the player somewhere specific without a mouse.
  useEffect(() => {
    const app = {
      ready: () => rootLoaded && libraryLoaded && worldLoaded && metrics.frames > 5,
      stats: () => {
        const shelf = useLibraryStore.getState()
        const world = useWorldStore.getState()
        return {
          ...metrics,
          ...useAppStore.getState(),
          books: shelf.books.length,
          shelved: shelf.packed.length,
          boxed: shelf.boxed.length,
          boxes: Object.keys(shelf.boxes).length,
          reconciliation: shelf.reconciliation,
          scanning: shelf.scanning,
          libraryError: shelf.error,
          worldError: world.error,
          rooms: world.world?.rooms.length ?? 0,
          shelves: world.world?.shelves.length ?? 0,
          worldRevision: world.revision,
        }
      },
      player: () => ({ ...player }),
      /** Which room the player is standing in, by id. */
      room: () => {
        const world = useWorldStore.getState().world
        return world ? (roomAt(world, player.x, player.z)?.id ?? null) : null
      },
      focusedBook: () => {
        const { focusedBook } = useAppStore.getState()
        return focusedBook ? (useLibraryStore.getState().byId.get(focusedBook) ?? null) : null
      },
      heldBook: () => {
        const { held } = useAppStore.getState()
        return held ? (useLibraryStore.getState().byId.get(held) ?? null) : null
      },
      shelfTarget: () => useAppStore.getState().shelfTarget,
      focusedSeat: () => useAppStore.getState().focusedSeat,
      focusedBox: () => useAppStore.getState().focusedBox,
      boxTarget: () => useAppStore.getState().boxTarget,
      seat: () => useAppStore.getState().seat,
      drawn: () => useAppStore.getState().drawn,
      rowsOf: (shelfId: string, row: number) =>
        useLibraryStore.getState().rows[`${shelfId}:${row}`] ?? [],
      savedRowsOf: (shelfId: string, row: number) =>
        useLibraryStore.getState().savedRows[`${shelfId}:${row}`] ?? [],
      boxedBooks: () => [...useLibraryStore.getState().boxed],
      boxContents: (boxId: string) => [...(useLibraryStore.getState().boxes[boxId] ?? [])],
      savedBoxContents: (boxId: string) => [
        ...(useLibraryStore.getState().savedBoxes[boxId] ?? []),
      ],
      /**
       * Unpack a box onto the shelves, as pressing G while looking at it does.
       * Aiming at one from a headless driver is a pose hunt; what the tests are
       * about is where the books end up.
       */
      emptyBoxForTest: (boxId: string) =>
        useLibraryStore.getState().emptyBoxOntoShelves(boxId),
      spines: () => ({
        printed: sceneRefs.printedSpines,
        slots: ASSIGNABLE_SLOTS,
        reprinted: sceneRefs.spinesReprinted,
      }),
      teleport,
      look: (yaw: number, pitch = 0) => {
        player.yaw = yaw
        player.pitch = pitch
      },
      scan: () => useLibraryStore.getState().scan(),
      reloadLibrary: () => useLibraryStore.getState().load(),
      /** The live world document, as text. */
      worldText: () => useWorldStore.getState().text,
      /**
       * Stand in for editing `library.json` and saving it. Browser driver only —
       * on the desktop the file itself is the interface.
       */
      editWorld: async (text: string) => {
        if (library.kind !== 'browser') throw new Error('editWorld is browser-only')
        setWorldText(text)
        await useWorldStore.getState().refresh()
        return useWorldStore.getState().error
      },
      reader: () => ({ ...readerStatus }),
      bookmarksOf: (id: string) => [...(useLibraryStore.getState().bookmarks[id] ?? [])],
      setModeForTest: (mode: string) => useAppStore.getState().setMode(mode as 'walk' | 'read'),
      /** Open a book and wait until a page has actually rasterised. */
      readForTest: async (id: string) => {
        useAppStore.getState().setReading(id)
        useAppStore.getState().setMode('read')
        for (let i = 0; i < 100; i++) {
          if (readerStatus.rendered || readerStatus.failure) break
          await new Promise((r) => setTimeout(r, 150))
        }
        return { ...readerStatus }
      },
    }
    ;(window as unknown as { __app: typeof app }).__app = app
  }, [rootLoaded, libraryLoaded, worldLoaded])

  return (
    <div className="app">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ fov: 72, near: 0.05, far: 60, position: [player.x, EYE_HEIGHT, player.z] }}
      >
        <color attach="background" args={['#0e0c0a']} />
        <Probe />
        <Lighting />
        <Rooms />
        <Furniture />
        <Bookshelves />
        <Books />
        <BoxedBooks />
        <PlacementGhost />
        <Interaction />
        <Player />
        <HeldBook />
        <Reader />
      </Canvas>
      <Hud />
    </div>
  )
}
