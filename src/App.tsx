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
import { Props } from './scene/Props'
import { Records } from './scene/Records'
import { Interaction } from './scene/Interaction'
import { Handling } from './scene/Handling'
import { Drawing } from './scene/Drawing'
import { ArcadeSystem } from './scene/Arcade'
import { PlacementGhost } from './scene/PlacementGhost'
import { Player } from './scene/Player'
import { HeldBook } from './scene/HeldBook'
import { HeldProp } from './scene/HeldProp'
import { HeldRecord } from './scene/HeldRecord'
import { HeldTape } from './scene/HeldTape'
import { HeldRom } from './scene/HeldRom'
import { HeldSheet } from './scene/HeldSheet'
import { Headlamp } from './scene/Headlamp'
import { Pinned } from './scene/Pinned'
import { Tapes } from './scene/Tapes'
import { Weather } from './scene/Weather'
import { ChimneySmoke } from './scene/ChimneySmoke'
import { DustMotes } from './scene/DustMotes'
import { LampGlow } from './scene/LampGlow'
import { ContactShadows } from './scene/ContactShadows'
import { SceneEnvironment } from './scene/SceneEnvironment'
import { Cat } from './scene/Cat'
import { Courier } from './scene/Courier'
import { Body } from './scene/Body'
import { Sound } from './scene/Sound'
import { Probe } from './scene/Probe'
import { Reader } from './reader/Reader'
import { readerHandles, readerStatus, resetReaderStatus } from './reader/status'
import { PAGE_INK } from './reader/pageInk'
import { inkAt } from './data/inks'
import { Hud } from './ui/Hud'
import { metrics } from './state/metrics'
import { EYE_HEIGHT, player, teleport } from './state/player'
import { cableRide } from './state/cableCar'
import { useAppStore } from './state/store'
import { useLibraryStore } from './state/library'
import { useAnnotationsStore } from './state/annotations'
import { useAmbienceStore } from './state/ambience'
import { useMediaStore } from './state/media'
import { useVideoStore } from './state/video'
import { arcadeMachine, useArcadeStore } from './state/arcade'
import { useWorldStore } from './state/world'
import { effectiveQuality, useSettings } from './state/settings'
import { cat } from './state/cat'
import { askCatForBook, callCat, petCat } from './scene/Cat'
import { warmCovers } from './state/covers'
import { library } from './services'
import type { LoosePlacement, PlacedProp } from './services/types'
import { setWorldText } from './services/browserDriver'
import { deliverySpot, roomAt } from './world/derive'
import { courier } from './state/courier'
import { boxesIn } from './world/boxes'
import { sceneRefs } from './scene/refs'
import { poolBindings } from './scene/lightPool'
import { ASSIGNABLE_SLOTS } from './scene/spineAtlas'

export default function App() {
  const loadRoot = useAppStore((s) => s.loadRoot)
  const rootLoaded = useAppStore((s) => s.rootLoaded)
  const loadLibrary = useLibraryStore((s) => s.load)
  const libraryLoaded = useLibraryStore((s) => s.loaded)
  const loadWorld = useWorldStore((s) => s.load)
  const watchWorld = useWorldStore((s) => s.watch)
  const worldLoaded = useWorldStore((s) => s.loaded)

  const loadAnnotations = useAnnotationsStore((s) => s.load)
  const annotationsLoaded = useAnnotationsStore((s) => s.loaded)
  const loadAmbience = useAmbienceStore((s) => s.load)
  const loadMedia = useMediaStore((s) => s.load)
  const loadVideo = useVideoStore((s) => s.load)
  const loadArcade = useArcadeStore((s) => s.load)

  // The world before the library, or there are no shelves to reconcile against
  // and every book looks like it has nowhere to go.
  useEffect(() => {
    void (async () => {
      await loadWorld()
      await loadRoot()
      await loadLibrary()
      await Promise.all([loadAnnotations(), loadAmbience(), loadMedia(), loadVideo(), loadArcade()])
      // Last: a long, low-priority walk through the whole catalogue, which must
      // never be what the first frame waits on.
      warmCovers(useLibraryStore.getState().books)
    })().catch((e) => {
      // One rejection must not silently strand the app half-loaded with the
      // only trace in the console; the HUD shows the library error.
      useLibraryStore.setState({
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }, [loadWorld, loadRoot, loadLibrary, loadAnnotations, loadAmbience, loadMedia, loadVideo, loadArcade])

  useEffect(() => watchWorld(), [watchWorld])

  /**
   * `F2` toggles the settings panel, `Esc` closes it. Here rather than in the
   * walk controller, which ignores every key while the panel is open — so the
   * key that opened it would be the one key that could not close it.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.tagName === 'INPUT'
      if (e.code === 'F2' && !typing) {
        e.preventDefault()
        const app = useAppStore.getState()
        app.setSettingsOpen(!app.settingsOpen)
      } else if (e.code === 'Escape' && !typing) {
        // The way out when focus has wandered off a panel's own field. A
        // consumed Esc stops here, or the reader and the arcade — which
        // register later — would also close the book and leave the machine.
        const app = useAppStore.getState()
        if (app.settingsOpen) app.setSettingsOpen(false)
        else if (app.searching) app.setSearching(false)
        else if (app.jumping) app.setJumping(false)
        else if (app.annotating) app.setAnnotating(false)
        else if (app.noting) app.setNoting(false)
        else if (app.labelling !== null) app.setLabelling(null)
        else if (app.phoning !== null) app.setPhoning(null)
        else return
        e.stopImmediatePropagation()
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
      ready: () =>
        rootLoaded && libraryLoaded && annotationsLoaded && worldLoaded && metrics.frames > 5,
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
      /**
       * How many point lights exist, and how many carry anything. The count is
       * what every lit material is compiled against, so one that moves as you
       * walk means the pool is recompiling shaders mid-stride.
       */
      pointLights: () => {
        let mounted = 0
        let lit = 0
        sceneRefs.scene?.traverse((node) => {
          if (!(node as THREE.PointLight).isPointLight) return
          mounted += 1
          if ((node as THREE.PointLight).intensity > 0.01) lit += 1
        })
        return { mounted, lit, bound: poolBindings.filter((id): id is string => id !== null) }
      },
      player: () => ({ ...player }),
      /** The cable car's ride state, for waits: boarding to arrival is one flag. */
      cableCar: () => ({ riding: cableRide.riding, lineT: cableRide.lineT }),
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
      /** The same for a record crate, plus the id of the sleeve drawn out. */
      crateView: (crateId: string) => useAppStore.getState().crateViews[crateId] ?? null,
      /** Riffle a crate without a crosshair: pointer lock is unavailable here. */
      browseCrateForTest: (crateId: string, direction: 1 | -1) =>
        useAppStore.getState().browseCrate(crateId, direction),
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
      /** So a test stands in front of something, not at a coordinate true of one map. */
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
          crates: (world?.furniture ?? [])
            .filter((item) => item.kind === 'recordshelf')
            .map((crate) => ({ id: crate.id, x: crate.x, z: crate.z })),
        }
      },
      boxContents: (boxId: string) => [...(useLibraryStore.getState().boxes[boxId] ?? [])],
      savedBoxContents: (boxId: string) => [
        ...(useLibraryStore.getState().savedBoxes[boxId] ?? []),
      ],
      /** As `G` on a box does. Aiming headlessly is a pose hunt; the point is where books land. */
      emptyBoxForTest: (boxId: string) =>
        useLibraryStore.getState().emptyBoxOntoShelves(boxId),
      /** Books lying about the room, and where each one came to rest. */
      looseBooks: () => ({ ...useLibraryStore.getState().loose }),
      /** As `Q` and `O` do. Aiming them needs a pointer lock a headless driver has not got. */
      putDownForTest: (id: string, placement: LoosePlacement) =>
        useLibraryStore.getState().putDown(id, placement),
      /**
       * As aiming and pressing `E` does. A test cannot assume which rows are
       * stocked, so one about books on a bookcase needs a way to put some there.
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
      /** A snapshot, not a handle: the cat moves every frame and lives outside React. */
      cat: () => ({ ...cat }),
      /**
       * As `V`, `E` and `F` do. Aiming at a moving animal headlessly is a pose
       * hunt with a moving target; the point is what the cat then does.
       */
      callCatForTest: () => callCat(),
      /** The steering is unplanned, so a journey across the building tests pathfinding it lacks. */
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
       * The ROM listing, the machine's state, and the cartridge in hand.
       * `insertRomForTest` is the call `E` on the machine makes; the point is
       * whether the machine then boots and draws.
       */
      roms: () => useArcadeStore.getState().roms.map((rom) => rom.id),
      arcade: () => {
        const machine = arcadeMachine()
        return {
          inserted: useArcadeStore.getState().inserted,
          error: useArcadeStore.getState().error,
          running: machine !== null && !machine.halted,
          litPixels: machine ? machine.screen.reduce((sum, px) => sum + px, 0) : 0,
        }
      },
      heldRom: () => useAppStore.getState().heldRom,
      insertRomForTest: (id: string) => useArcadeStore.getState().insert(id),
      ejectRomForTest: () => useArcadeStore.getState().eject(),
      /**
       * The marker and what has been drawn with it. `takeMarkerForTest` is the
       * one line `E` runs; aiming at a 14 cm pen headlessly is a pose hunt.
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

      /**
       * Where each prop stands, and the one in your hand. The `ForTest`
       * gestures exist because aiming at a 6 cm can headlessly is a pose hunt.
       */
      props: () => ({ ...useLibraryStore.getState().props }),
      heldProp: () => useAppStore.getState().heldProp,
      placePropForTest: (prop: PlacedProp) => useLibraryStore.getState().placeProp(prop),
      takePropForTest: (id: string) => {
        const taken = useLibraryStore.getState().removeProp(id)
        if (taken) {
          // The same fork E takes: the headlamp goes on your head, not in hand.
          if (taken.kind === 'headlamp') useAppStore.getState().setWornLamp('headlamp')
          else useAppStore.getState().setHeldProp({ kind: taken.kind, full: taken.full })
        }
        return taken ?? null
      },
      /** Drink or eat what is in hand, as `F` does. The boost lands in `player().boostUntil`. */
      consumeForTest: () => useAppStore.getState().consume(),
      /** The headlamp: whose head it is on, and the switch `E` throws. */
      wornLamp: () => useAppStore.getState().wornLamp,
      wearLampForTest: (id: string | null) => useAppStore.getState().setWornLamp(id),
      /** Where a delivery would be left, and the courier if one is out there. */
      deliverySpotForTest: () => {
        const world = useWorldStore.getState().world
        return world ? deliverySpot(world) : null
      },
      courier: () => ({ ...courier, about: useAppStore.getState().courierAbout }),

      /** Sheets pinned up round the house, and the one in your hand. */
      pins: () => useLibraryStore.getState().pins.map((sheet) => ({ ...sheet })),
      heldPin: () => useAppStore.getState().heldPin,
      pinTarget: () => useAppStore.getState().pinTarget,
      focusedPin: () => useAppStore.getState().focusedPin,
      artwork: () => useMediaStore.getState().artwork.map((picture) => picture.id),
      /**
       * Measured off the meshes rather than the document: a board mounted at
       * the wrong height is invisible to anything above the scene graph.
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
      /** What is actually being drawn. Not serialisable — call it from page-side code. */
      sceneForTest: () => sceneRefs.scene,
      teleport,
      look: (yaw: number, pitch = 0) => {
        player.yaw = yaw
        player.pitch = pitch
      },
      scan: () => useLibraryStore.getState().scan(),
      reloadLibrary: () => useLibraryStore.getState().load(),
      /** The live world document, as text. */
      worldText: () => useWorldStore.getState().text,
      /** Stands in for editing `library.json`. Browser driver only: elsewhere the file is the interface. */
      editWorld: async (text: string) => {
        if (library.kind !== 'browser') throw new Error('editWorld is browser-only')
        setWorldText(text)
        await useWorldStore.getState().refresh()
        return useWorldStore.getState().error
      },
      reader: () => ({ ...readerStatus }),
      bookmarksOf: (id: string) => [...(useAnnotationsStore.getState().bookmarks[id] ?? [])],
      notesOf: (id: string) => [...(useAnnotationsStore.getState().notes[id] ?? [])],
      addNoteForTest: (id: string, page: number, text: string) =>
        useAnnotationsStore.getState().addNote(id, page, text),
      deleteNoteForTest: (id: string, noteId: string) =>
        useAnnotationsStore.getState().deleteNote(id, noteId),
      pageDrawingsOf: (id: string, page: number) => [
        ...useAnnotationsStore.getState().strokesOn(id, page),
      ],
      wipePageForTest: (id: string, page: number) =>
        useAnnotationsStore.getState().wipePage(id, page),
      /**
       * How much pen ink the rasterised page actually shows. A stroke whose
       * paint missed the canvas is invisible ink, and only pixels catch it.
       */
      inkPixelsOnPage: (page: number) => {
        const canvas = readerHandles.pageCanvas?.(page)
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return 0
        const ink = inkAt(PAGE_INK)
        const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16))
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let count = 0
        // Every fourth pixel is plenty: a stroke is thousands of them.
        for (let i = 0; i < data.length; i += 16) {
          if (
            Math.abs(data[i]! - r!) < 40 &&
            Math.abs(data[i + 1]! - g!) < 40 &&
            Math.abs(data[i + 2]! - b!) < 40
          ) {
            count += 1
          }
        }
        return count
      },
      setModeForTest: (mode: string) => useAppStore.getState().setMode(mode as 'walk' | 'read'),
      /** Open a book and wait until a page has actually rasterised. */
      readForTest: async (id: string) => {
        // Only for a different book: re-opening the loaded one re-runs nothing
        // in the reader, so a reset would blank a status nothing refills.
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
  }, [rootLoaded, libraryLoaded, annotationsLoaded, worldLoaded])

  /**
   * Antialiasing and the shadow map are fixed when the WebGL context is created,
   * so changing them means a new canvas — hence the `key`. Resolution scale is
   * deliberately not among them: R3F re-applies `dpr` on the live context, so
   * the dial most worth dragging costs nothing to drag.
   */
  const settings = useSettings()
  const quality = effectiveQuality(settings)
  // Supersampling already resolves edges, so the multisample buffer above 1.5×
  // is paying twice for the same thing.
  const antialias = quality.resolutionScale < 1.5 && !settings.lowPerformance

  return (
    <div className="app">
      <Canvas
        key={`${antialias ? 'aa' : 'raw'}-${quality.shadowQuality}`}
        shadows={quality.shadowQuality !== 'off'}
        dpr={quality.resolutionScale}
        gl={{
          antialias,
          powerPreference: settings.lowPerformance ? 'default' : 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        // Far enough to see the far shore. The fog hides the edge of the world;
        // this only has to reach past the sky dome.
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
        <Props />
        <Records />
        <Tapes />
        <Pinned />
        <Cat />
        <Courier />
        <Weather />
        <ChimneySmoke />
        <DustMotes />
        <LampGlow />
        <ContactShadows />
        <SceneEnvironment />
        <PlacementGhost />
        <Interaction />
        <Handling />
        <Drawing />
        <ArcadeSystem />
        <Player />
        <Body />
        <Sound />
        <HeldBook />
        <HeldProp />
        <HeldRecord />
        <HeldTape />
        <HeldRom />
        <HeldSheet />
        <Headlamp />
        <Reader />
      </Canvas>
      {/* A breath of vignette and grain over the picture — DOM, not a render
          pass, so it costs the scene nothing and pointer lock passes through. */}
      <div className="veil" aria-hidden="true" />
      <Hud />
    </div>
  )
}
