import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Lighting } from './scene/Lighting'
import { Outside } from './scene/Outside'
import { Rooms } from './scene/Rooms'
import { Roofs } from './scene/Roofs'
import { Furniture } from './scene/Furniture'
import { Bookshelves } from './scene/Bookshelves'
import { ShelfLabels } from './scene/ShelfLabels'
import { Books } from './scene/Books'
import { BoxedBooks } from './scene/BoxedBooks'
import { LooseBooks } from './scene/LooseBooks'
import { Records } from './scene/Records'
import { Interaction } from './scene/Interaction'
import { Handling } from './scene/Handling'
import { PlacementGhost } from './scene/PlacementGhost'
import { Player } from './scene/Player'
import { HeldBook } from './scene/HeldBook'
import { HeldRecord } from './scene/HeldRecord'
import { HeldTape } from './scene/HeldTape'
import { HeldSheet } from './scene/HeldSheet'
import { Pinned } from './scene/Pinned'
import { Tapes } from './scene/Tapes'
import { Probe } from './scene/Probe'
import { Reader } from './reader/Reader'
import { readerStatus, resetReaderStatus } from './reader/status'
import { Hud } from './ui/Hud'
import { metrics } from './state/metrics'
import { EYE_HEIGHT, player, teleport } from './state/player'
import { useAppStore } from './state/store'
import { useLibraryStore } from './state/library'
import { useLightStore } from './state/lights'
import { useMediaStore } from './state/media'
import { useVideoStore } from './state/video'
import { useWorldStore } from './state/world'
import { warmCovers } from './state/covers'
import { library } from './services'
import type { LoosePlacement } from './services/types'
import { setWorldText } from './services/browserDriver'
import { roomAt } from './world/derive'
import { boxesIn } from './world/boxes'
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

  const loadLights = useLightStore((s) => s.load)
  const loadMedia = useMediaStore((s) => s.load)
  const loadVideo = useVideoStore((s) => s.load)

  // The world has to be up before the library, or there are no shelves to
  // reconcile against and every book would look like it had nowhere to go.
  // The records, the pictures and the light switches all hang off the library
  // folder too, so they come along behind it.
  useEffect(() => {
    void (async () => {
      await loadWorld()
      await loadRoot()
      await loadLibrary()
      await Promise.all([loadLights(), loadMedia(), loadVideo()])
      // Start the cover sweep only once everything else is up: it is a long,
      // low-priority walk through the whole catalogue, and it must never be
      // what the first frame is waiting on.
      warmCovers(useLibraryStore.getState().books)
    })().catch((e) => {
      // One rejection must not silently strand the app half-loaded with the
      // only trace in the console; the HUD shows the library error.
      useLibraryStore.setState({
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }, [loadWorld, loadRoot, loadLibrary, loadLights, loadMedia, loadVideo])

  useEffect(() => watchWorld(), [watchWorld])

  // Stand where the document says to, once. A live reload must not pick you up
  // and put you back at the door mid-browse.
  const spawned = useRef(false)
  useEffect(() => {
    const world = useWorldStore.getState().world
    if (!world || spawned.current) return
    spawned.current = true
    teleport(world.spawn.x, world.spawn.z, world.spawn.yaw, world.spawn.y)
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
        // Which storey you are on matters: the loft stands inside the great
        // room's plan, so a position alone does not name a room.
        return world ? (roomAt(world, player.x, player.z, player.floor)?.id ?? null) : null
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
      /** What a box is showing of what it holds: `{ offset, shown, total }`. */
      boxView: (boxId: string) => useAppStore.getState().boxViews[boxId] ?? null,
      /** The book ids currently visible on top of the piles. */
      visibleInBoxes: () => [...sceneRefs.boxedIds],
      seat: () => useAppStore.getState().seat,
      drawn: () => useAppStore.getState().drawn,
      rowsOf: (shelfId: string, row: number) =>
        useLibraryStore.getState().rows[`${shelfId}:${row}`] ?? [],
      savedRowsOf: (shelfId: string, row: number) =>
        useLibraryStore.getState().savedRows[`${shelfId}:${row}`] ?? [],
      boxedBooks: () => [...useLibraryStore.getState().boxed],
      /** The moving boxes this world has, in document order. */
      boxIds: () => {
        const world = useWorldStore.getState().world
        return world ? boxesIn(world).map((box) => box.id) : []
      },
      /**
       * Where the furniture actually is, so a test can stand in front of
       * something rather than at a coordinate that was true of one map.
       */
      places: () => {
        const world = useWorldStore.getState().world
        return {
          shelves: (world?.shelves ?? []).map((shelf) => ({
            id: shelf.id,
            x: shelf.x,
            z: shelf.z,
            rotationY: shelf.rotationY,
            rows: shelf.rows,
          })),
          boxes: (world ? boxesIn(world) : []).map((box) => ({
            id: box.id,
            x: box.x,
            z: box.z,
            height: box.height,
          })),
        }
      },
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
      /** Books lying about the room, and where each one came to rest. */
      looseBooks: () => ({ ...useLibraryStore.getState().loose }),
      /**
       * Put a book down in the room, as Q and O do. Aiming those keys needs a
       * pointer lock a headless driver has not got; what the tests are about
       * is what happens to a book once it is lying there.
       */
      putDownForTest: (id: string, placement: LoosePlacement) =>
        useLibraryStore.getState().putDown(id, placement),
      /** Every piece of furniture, where it actually is — boxes get shoved. */
      furniture: () =>
        (useWorldStore.getState().world?.furniture ?? []).map((item) => ({
          id: item.id,
          kind: item.kind,
          room: item.roomId,
          x: item.x,
          y: item.y,
          z: item.z,
        })),
      /** Strip every shelf and repack the library into the boxes. */
      packEverythingForTest: () => useLibraryStore.getState().packEverything(),
      labelOf: (shelfId: string) => useLibraryStore.getState().labelOf(shelfId),
      setLabelForTest: (shelfId: string, text: string) =>
        useLibraryStore.getState().setLabel(shelfId, text),
      /** Which lamps are lit, by furniture id. */
      lights: () => {
        const world = useWorldStore.getState().world
        const lights = useLightStore.getState()
        return Object.fromEntries(
          (world?.lights ?? []).map((lamp) => [lamp.id, lights.isOn(lamp.id, lamp.defaultOn)]),
        )
      },
      toggleLightForTest: (id: string) => {
        const world = useWorldStore.getState().world
        const lamp = world?.lights.find((candidate) => candidate.id === id)
        return lamp ? useLightStore.getState().toggle(id, lamp.defaultOn) : null
      },
      /** Whether it is night outside, and the switch the N key presses. */
      night: () => useLightStore.getState().night,
      toggleNightForTest: () => useLightStore.getState().toggleNight(),
      /** The records the music folder produced, and what is on the deck. */
      records: () => useMediaStore.getState().tracks.map((track) => track.id),
      nowPlaying: () => useMediaStore.getState().playing,
      tapes: () => useVideoStore.getState().tapes.map((tape) => tape.id),
      nowWatching: () => ({
        playing: useVideoStore.getState().playing,
        error: useVideoStore.getState().error,
      }),
      heldTape: () => useAppStore.getState().heldTape,
      /** Sheets pinned up round the house, and the one in your hand. */
      pins: () => useLibraryStore.getState().pins.map((sheet) => ({ ...sheet })),
      heldPin: () => useAppStore.getState().heldPin,
      pinTarget: () => useAppStore.getState().pinTarget,
      focusedPin: () => useAppStore.getState().focusedPin,
      artwork: () => useMediaStore.getState().artwork.map((picture) => picture.id),
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
        // The reader resets the status in an effect, after React commits; a
        // second read in one session would otherwise see the previous book's
        // `rendered` still standing and return its numbers.
        resetReaderStatus(id)
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
        // Far enough to see the far shore now that there is one. The fog does
        // the actual work of hiding the edge of the world; this only has to
        // reach past the sky dome.
        camera={{ fov: 72, near: 0.05, far: 400, position: [player.x, EYE_HEIGHT, player.z] }}
      >
        <Probe />
        <Lighting />
        <Outside />
        <Rooms />
        <Roofs />
        <Furniture />
        <Bookshelves />
        <ShelfLabels />
        <Books />
        <BoxedBooks />
        <LooseBooks />
        <Records />
        <Tapes />
        <Pinned />
        <PlacementGhost />
        <Interaction />
        <Handling />
        <Player />
        <HeldBook />
        <HeldRecord />
        <HeldTape />
        <HeldSheet />
        <Reader />
      </Canvas>
      <Hud />
    </div>
  )
}
