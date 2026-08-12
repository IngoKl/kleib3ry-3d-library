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
import { Drawing } from './scene/Drawing'
import { PlacementGhost } from './scene/PlacementGhost'
import { Player } from './scene/Player'
import { HeldBook } from './scene/HeldBook'
import { HeldRecord } from './scene/HeldRecord'
import { HeldTape } from './scene/HeldTape'
import { HeldSheet } from './scene/HeldSheet'
import { Pinned } from './scene/Pinned'
import { Tapes } from './scene/Tapes'
import { Weather } from './scene/Weather'
import { ChimneySmoke } from './scene/ChimneySmoke'
import { DustMotes } from './scene/DustMotes'
import { Cat } from './scene/Cat'
import { Body } from './scene/Body'
import { Sound } from './scene/Sound'
import { Probe } from './scene/Probe'
import { Reader } from './reader/Reader'
import { readerStatus, resetReaderStatus } from './reader/status'
import { Hud } from './ui/Hud'
import { metrics } from './state/metrics'
import { EYE_HEIGHT, player, teleport } from './state/player'
import { useAppStore } from './state/store'
import { useLibraryStore } from './state/library'
import { useAmbienceStore } from './state/ambience'
import { useMediaStore } from './state/media'
import { useVideoStore } from './state/video'
import { useWorldStore } from './state/world'
import { useSettings } from './state/settings'
import { cat } from './state/cat'
import { askCatForBook, callCat, petCat } from './scene/Cat'
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

  const loadAmbience = useAmbienceStore((s) => s.load)
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
      await Promise.all([loadAmbience(), loadMedia(), loadVideo()])
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
  }, [loadWorld, loadRoot, loadLibrary, loadAmbience, loadMedia, loadVideo])

  useEffect(() => watchWorld(), [watchWorld])

  /**
   * `F2` opens and closes the settings panel, and `Esc` closes it.
   *
   * Here rather than in the walk controller because the walk controller ignores
   * every key while the panel is open — which is what stops `W` walking you
   * through a wall while you drag a slider, and would also make the key that
   * opened the panel the one key that could not close it.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.tagName === 'INPUT'
      if (e.code === 'F2' && !typing) {
        e.preventDefault()
        const app = useAppStore.getState()
        app.setSettingsOpen(!app.settingsOpen)
      } else if (e.code === 'Escape' && !typing) {
        // The panels that take the keyboard each close themselves from their own
        // field; this is the way out when the focus has wandered off it — which
        // is one stray click away and used to leave `Esc` doing nothing at all.
        const app = useAppStore.getState()
        if (app.settingsOpen) app.setSettingsOpen(false)
        else if (app.searching) app.setSearching(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
      /**
       * Put a book on a particular shelf, as aiming and pressing E does.
       *
       * Exists because "which rows happen to be stocked" is not something a test
       * may assume: unpacking fills empty rows nearest the box first and stops when
       * the boxes run out, so with more shelves than books there are always rows
       * with nothing on them. A test about what happens to the books *on* a
       * bookcase has to be able to put some there.
       */
      shelveForTest: (id: string, shelfId: string, row: number, index = 0) =>
        useLibraryStore.getState().shelve(id, shelfId, row, index),
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
        const lights = useAmbienceStore.getState()
        return Object.fromEntries(
          (world?.lights ?? []).map((lamp) => [lamp.id, lights.isOn(lamp.id, lamp.defaultOn)]),
        )
      },
      toggleLightForTest: (id: string) => {
        const world = useWorldStore.getState().world
        const lamp = world?.lights.find((candidate) => candidate.id === id)
        return lamp ? useAmbienceStore.getState().toggle(id, lamp.defaultOn) : null
      },
      /** Whether it is night outside, and the switch the N key presses. */
      night: () => useAmbienceStore.getState().night,
      toggleNightForTest: () => useAmbienceStore.getState().toggleNight(),
      /** Whether it is raining, and the switch the K key presses. */
      raining: () => useAmbienceStore.getState().rain,
      toggleRainForTest: () => useAmbienceStore.getState().toggleRain(),
      /**
       * The cat: where it is and what it is up to.
       *
       * It moves every frame and lives outside React for that reason, so this
       * is a snapshot rather than a handle.
       */
      cat: () => ({ ...cat }),
      /**
       * Call it, fuss it, ask it for a book — as `V`, `E` and `F` do.
       *
       * Aiming at a *moving animal* from a headless driver is a pose hunt with a
       * moving target, and what these tests are about is what the cat then does.
       * The same argument `emptyBoxForTest` makes about a box.
       */
      callCatForTest: () => callCat(),
      /**
       * Put the cat somewhere. The steering is deliberately unplanned, so a
       * journey across the building is a test of pathfinding it does not have.
       */
      placeCatForTest: (x: number, z: number, floor = 0) => {
        cat.x = x
        cat.z = z
        cat.floor = floor
        cat.via = null
        cat.stuck = 0
      },
      petCatForTest: () => petCat(),
      fetchBookForTest: () => askCatForBook(),
      /** Go in, as pressing the button on the main menu does. */
      startForTest: () => useAppStore.getState().start(),
      /** The records the music folder produced, and what is on the deck. */
      records: () => useMediaStore.getState().tracks.map((track) => track.id),
      nowPlaying: () => useMediaStore.getState().playing,
      tapes: () => useVideoStore.getState().tapes.map((tape) => tape.id),
      nowWatching: () => ({
        playing: useVideoStore.getState().playing,
        error: useVideoStore.getState().error,
      }),
      focusedTape: () => useAppStore.getState().focusedTape,
      heldTape: () => useAppStore.getState().heldTape,
      /**
       * The whiteboard marker, and what has been drawn with it.
       *
       * `takeMarkerForTest` is the same one line `E` on the marker runs. Aiming
       * at a 14 cm pen on a desk from a headless driver is a pose hunt, and what
       * these tests are about is what the marker then does — the same argument
       * `emptyBoxForTest` makes about a box.
       */
      heldMarker: () => useAppStore.getState().heldMarker,
      boardTarget: () => useAppStore.getState().boardTarget,
      takeMarkerForTest: (id: string) => useAppStore.getState().setHeldMarker(id),
      inkForTest: () => useAppStore.getState().markerInk,
      drawingsOn: (boardId: string) => useLibraryStore.getState().drawings[boardId] ?? [],
      wipeBoardForTest: (boardId: string) => useLibraryStore.getState().wipeBoard(boardId),

      /** Records: what is in hand, what has been filed by hand, what is put down. */
      heldRecord: () => useAppStore.getState().heldRecord,
      takeRecordForTest: (id: string | null) => useAppStore.getState().setHeldRecord(id),
      fileRecordForTest: (id: string, crateId: string) =>
        useLibraryStore.getState().fileRecord(id, crateId),
      putRecordDownForTest: (id: string, at: { x: number; y: number; z: number; yaw: number }) =>
        useLibraryStore.getState().putRecordDown(id, at),
      filedRecords: () => ({ ...useLibraryStore.getState().filedRecords }),
      looseRecords: () => ({ ...useLibraryStore.getState().looseRecords }),
      /** Which crate each record is drawn in, off the scene rather than the store. */
      recordCrates: () =>
        Object.fromEntries(
          sceneRefs.recordIds.map((id, i) => [id, sceneRefs.recordCrates[i] ?? null]),
        ),

      /** Sheets pinned up round the house, and the one in your hand. */
      pins: () => useLibraryStore.getState().pins.map((sheet) => ({ ...sheet })),
      heldPin: () => useAppStore.getState().heldPin,
      pinTarget: () => useAppStore.getState().pinTarget,
      focusedPin: () => useAppStore.getState().focusedPin,
      artwork: () => useMediaStore.getState().artwork.map((picture) => picture.id),
      /**
       * How high off the floor each whiteboard actually *is*, measured off the
       * meshes rather than off the document.
       *
       * Asked of the scene because that is where it went wrong: the derived
       * world had the board at the right height all along and the renderer drew
       * it centred on its own base, half a board too low. Nothing above the
       * scene graph can see that.
       */
      boards: () =>
        (sceneRefs.boards?.children ?? []).map((piece) => {
          const box = new THREE.Box3().setFromObject(piece)
          return { id: String(piece.userData.furnitureId ?? ''), bottom: box.min.y, top: box.max.y }
        }),
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
        // Clear the previous book's numbers, but only when it *is* a different
        // book: re-opening the one already loaded re-runs nothing in the reader,
        // so a reset there would blank a status nothing is going to refill.
        if (readerStatus.bookId !== id) resetReaderStatus(id)
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

  /**
   * Low performance mode, at the one place it cannot be applied per frame.
   *
   * Antialiasing and the shadow map are decided when the WebGL context is
   * created, so changing them means a new canvas — hence the `key`. Remounting
   * the scene mid-session is jarring and is the right trade for a switch you
   * throw once: everything that matters is in the stores, so the room comes back
   * exactly as you left it, and the alternative is a setting that only takes
   * effect on the next launch.
   */
  const lowPerformance = useSettings((s) => s.lowPerformance)

  return (
    <div className="app">
      <Canvas
        key={lowPerformance ? 'low' : 'full'}
        shadows={!lowPerformance}
        dpr={lowPerformance ? 1 : [1, 2]}
        gl={{
          antialias: !lowPerformance,
          powerPreference: lowPerformance ? 'default' : 'high-performance',
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
        <Cat />
        <Weather />
        <ChimneySmoke />
        <DustMotes />
        <PlacementGhost />
        <Interaction />
        <Handling />
        <Drawing />
        <Player />
        <Body />
        <Sound />
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
