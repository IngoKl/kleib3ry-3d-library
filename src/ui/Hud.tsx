import { useEffect, useMemo, useState } from 'react'
import { readerStatus } from '../reader/status'
import { cat } from '../state/cat'
import { NEW_BOX, useLibraryStore } from '../state/library'
import { useAnnotationsStore } from '../state/annotations'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'
import { LAMPS } from '../world/derive'
import { ShelfLabelField } from './ShelfLabelField'
import { JumpToPageField } from './JumpToPageField'
import { NoteField } from './NoteField'
import { BookNoteField } from './BookNoteField'
import { SearchField } from './SearchField'
import { ControlsCard } from './ControlsCard'
import { SettingsCard } from './SettingsCard'
import { MainMenu } from './MainMenu'

/** What each pen in the whiteboard tray is called on the card. */
const INK_NAMES = ['Blue Marker', 'Red Marker', 'Green Marker']

/** What the crosshair calls each thing you can operate. Lamps fall through. */
const FIXTURE_NAMES: Partial<Record<string, string>> = {
  recordplayer: 'Record Player',
  crt: 'Television',
  coffeemaker: 'Coffee Maker',
  computer: 'The Catalogue',
  postits: 'A Pad of Notes',
  marker: 'A Whiteboard Marker',
  fireplace: 'The Fire',
  pendant: 'Ceiling Light',
  fairylights: 'Fairy Lights',
  lightswitch: 'Light Switch',
  boxstack: 'Spare Boxes',
}

/**
 * The overlay. Two things only:
 *
 *   - what is under the crosshair, and which key acts on it — the cards;
 *   - what the app is doing that nobody asked for: a scan, a parse error, a
 *     library still in its boxes.
 *
 * Choosing a library is the main menu; the switches are the settings panel.
 */
export function Hud() {
  const mode = useAppStore((s) => s.mode)
  const focusedId = useAppStore((s) => s.focusedBook)
  const heldId = useAppStore((s) => s.held)
  const readingId = useAppStore((s) => s.reading)
  const shelfTarget = useAppStore((s) => s.shelfTarget)
  const focusedSeat = useAppStore((s) => s.focusedSeat)
  const focusedBox = useAppStore((s) => s.focusedBox)
  const boxTarget = useAppStore((s) => s.boxTarget)
  const boxViews = useAppStore((s) => s.boxViews)
  const seat = useAppStore((s) => s.seat)
  const drawn = useAppStore((s) => s.drawn)
  const focusedFixture = useAppStore((s) => s.focusedFixture)
  const focusedRecord = useAppStore((s) => s.focusedRecord)
  const heldRecord = useAppStore((s) => s.heldRecord)
  const crateTarget = useAppStore((s) => s.crateTarget)
  const focusedTape = useAppStore((s) => s.focusedTape)
  const heldPin = useAppStore((s) => s.heldPin)
  const pinTarget = useAppStore((s) => s.pinTarget)
  const focusedPin = useAppStore((s) => s.focusedPin)
  const heldMarker = useAppStore((s) => s.heldMarker)
  const markerInk = useAppStore((s) => s.markerInk)
  const boardTarget = useAppStore((s) => s.boardTarget)
  const focusedCat = useAppStore((s) => s.focusedCat)
  const pins = useLibraryStore((s) => s.pins)
  const heldTape = useAppStore((s) => s.heldTape)
  const tapeCrateTarget = useAppStore((s) => s.tapeCrateTarget)
  const focusedShelf = useAppStore((s) => s.focusedShelf)
  const hudHidden = useAppStore((s) => s.hudHidden)
  const setControlsOpen = useAppStore((s) => s.setControlsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const controlsOpen = useAppStore((s) => s.controlsOpen)
  const surfaceTarget = useAppStore((s) => s.surfaceTarget)
  const carriedBox = useAppStore((s) => s.carriedBox)
  const pointerLocked = useAppStore((s) => s.pointerLocked)
  const started = useAppStore((s) => s.started)

  const byId = useLibraryStore((s) => s.byId)
  const books = useLibraryStore((s) => s.books)
  const shelved = useLibraryStore((s) => s.packed.length)
  const boxed = useLibraryStore((s) => s.boxed.length)
  const boxes = useLibraryStore((s) => s.boxes)
  const reconciliation = useLibraryStore((s) => s.reconciliation)
  const scanning = useLibraryStore((s) => s.scanning)
  const progress = useLibraryStore((s) => s.progress)
  const error = useLibraryStore((s) => s.error)

  const worldName = useWorldStore((s) => s.world?.doc.name ?? null)
  const worldError = useWorldStore((s) => s.error)
  const world = useWorldStore((s) => s.world)

  const tracks = useMediaStore((s) => s.tracks)
  const nowPlaying = useMediaStore((s) => s.playing)
  const paused = useMediaStore((s) => s.paused)
  const deck = useMediaStore((s) => s.deck)
  const tapes = useVideoStore((s) => s.tapes)
  const watching = useVideoStore((s) => s.playing)
  const watchPaused = useVideoStore((s) => s.paused)
  const lightsOn = useAmbienceStore((s) => s.on)
  const brewing = useAppStore((s) => s.brewing)

  // Why the reader is showing nothing, on the same poll as the render stats:
  // `readerStatus` lives outside React, and the failure plane in the scene has
  // no way to carry text — without this the message existed only for tests.
  const [readerFailure, setReaderFailure] = useState<string | null>(null)
  /** The open spread, on the same poll, so the card can list its notes. */
  const [readerSpread, setReaderSpread] = useState(0)
  /** Whether the pen is up, likewise. */
  const [readerPen, setReaderPen] = useState(false)
  /** The cat's mood, likewise: it changes every frame and is read on a poll. */
  const [purring, setPurring] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setReaderFailure(readerStatus.failure)
      setReaderSpread(readerStatus.spread)
      setReaderPen(readerStatus.pen)
      setPurring(cat.purr > 0.2)
    }, 250)
    return () => clearInterval(id)
  }, [])

  const bookNotes = useAnnotationsStore((s) => (readingId ? s.notes[readingId] : undefined))
  const deleteNote = useAnnotationsStore((s) => s.deleteNote)
  const bookDrawings = useAnnotationsStore((s) => (readingId ? s.drawings[readingId] : undefined))
  const wipePage = useAnnotationsStore((s) => s.wipePage)
  // The two pages the open spread shows: 2s and 2s+1.
  const visiblePages = [2 * readerSpread, 2 * readerSpread + 1]
  const visibleNotes = (bookNotes ?? []).filter((n) => visiblePages.includes(n.page))
  const inkedPages = visiblePages.filter((p) => (bookDrawings?.[p]?.length ?? 0) > 0)

  const focused = focusedId ? byId.get(focusedId) : undefined
  const held = heldId ? byId.get(heldId) : undefined
  const reading = readingId ? byId.get(readingId) : undefined
  const walking = mode === 'walk'

  // Only offer browsing when the box is holding back more than it is showing.
  const view = focusedBox ? boxViews[focusedBox] : undefined
  const browsing = Boolean(view && view.total > view.shown)

  const record = focusedRecord ? tracks.find((track) => track.id === focusedRecord) : undefined
  const heldRecordTrack = heldRecord ? tracks.find((track) => track.id === heldRecord) : undefined
  const tape = focusedTape ? tapes.find((t) => t.id === focusedTape) : undefined
  const heldTapeItem = heldTape ? tapes.find((t) => t.id === heldTape) : undefined
  const fixture = focusedFixture
    ? world?.furniture.find((item) => item.id === focusedFixture)
    : undefined
  const fixtureLit = fixture ? (lightsOn[fixture.id] ?? (fixture.on ?? true)) : false
  // What a switch plate would do next. Only asked when one is under the
  // crosshair — it walks every lamp in the building.
  const anyLightOn =
    fixture?.kind === 'lightswitch' &&
    (world?.lights ?? []).some((lamp) => lightsOn[lamp.id] ?? lamp.defaultOn)
  const fixtureName = (fixture && FIXTURE_NAMES[fixture.kind]) ?? 'Lamp'

  /** What E would do to the thing under the crosshair, in the words of the room. */
  const fixtureVerb = (() => {
    if (!fixture) return ''
    if (LAMPS.has(fixture.kind)) return fixtureLit ? 'switch it off' : 'switch it on'
    switch (fixture.kind) {
      case 'lightswitch':
        return anyLightOn ? 'switch every light off' : 'switch every light on'
      // A deck with nothing on it says so, and there is one of each record: it
      // is on whichever deck you carried it to, and no other.
      case 'recordplayer':
        if (nowPlaying === null || deck !== fixture.id) return 'no record on it'
        return paused ? 'play' : 'pause'
      // An empty set says so rather than taking a tape by itself.
      case 'crt':
        if (watching === null) return 'no tape in it'
        return watchPaused ? 'play' : 'pause'
      case 'computer':
        return 'look something up'
      case 'postits':
        return 'take one and write on it'
      case 'marker':
        return 'pick it up'
      case 'boxstack':
        return 'make a box up'
      default:
        return brewing === fixture.id ? 'brewing…' : 'put the coffee on'
    }
  })()

  /** Anything the app wants to say that nobody asked it to. */
  const notices = useMemo(
    () =>
      Boolean(
        worldError ||
          error ||
          reconciliation ||
          scanning ||
          (boxed > 0 && shelved === 0) ||
          books.length === 0,
      ),
    [worldError, error, reconciliation, scanning, boxed, shelved, books.length],
  )

  return (
    <>
      {!hudHidden && started && (
        <>
          {walking && (
            <div
              className={`crosshair ${
                focused ||
                shelfTarget ||
                focusedSeat ||
                focusedBox ||
                boxTarget ||
                focusedFixture ||
                focusedRecord ||
                crateTarget ||
                focusedTape ||
                tapeCrateTarget ||
                pinTarget ||
                focusedPin ||
                boardTarget ||
                focusedCat ||
                surfaceTarget
                  ? 'crosshair-active'
                  : ''
              }`}
              aria-hidden="true"
            >
              <span />
              <span />
            </div>
          )}

          {walking && focused && !held && !focusedPin && !heldPin && (
            <div className="focus-card" data-testid="focus-card">
              <p className="focus-title">{focused.title}</p>
              <p className="focus-author">
                {focused.author ?? 'Unknown'} · {focused.format}
                {focused.pageCount ? ` · ${focused.pageCount} pp` : ''}
              </p>
              {/* A book in a box lies cover up, so there is nothing to turn round —
                  F is for a book on a shelf, where the cover faces its neighbour.
                  The box it is lying in is offered alongside it, because otherwise
                  you would have to find a patch of bare cardboard to point at. */}
              <p className="focus-key">
                <kbd>E</kbd> Take
                {focusedBox ? (
                  <>
                    {' · '}
                    <kbd>G</kbd> Shelve this box (
                    {(boxes[focusedBox]?.length ?? 0).toLocaleString()})
                    {browsing && (
                      <>
                        {' · '}
                        <kbd>,</kbd>
                        <kbd>.</kbd> Browse
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {' · '}
                    <kbd>F</kbd> {drawn ? 'Put back' : 'Show cover'}
                  </>
                )}
              </p>
            </div>
          )}

          {/* The cat: the only card that is about somebody rather than something. */}
          {walking && focusedCat && (
            <div className="focus-card" data-testid="cat-card">
              <p className="focus-title">The Cat</p>
              <p className="focus-author">{purring ? 'Purring' : 'Looking at you'}</p>
              <p className="focus-key">
                <kbd>E</kbd> Give it a fuss · <kbd>F</kbd> Ask it for a book
              </p>
            </div>
          )}

          {/* A bare bookcase offers its label. Only when nothing else is under the
              crosshair — a case full of books is spoken for by the book card. */}
          {walking &&
            focusedShelf &&
            !focused &&
            !focusedBox &&
            !focusedSeat &&
            !focusedRecord &&
            !focusedFixture &&
            !focusedPin &&
            !focusedCat &&
            !heldPin &&
            !held &&
            !heldRecord &&
            !seat && (
              <div className="focus-card" data-testid="shelf-card">
                <p className="focus-key">
                  <kbd>L</kbd> Write on this bookcase
                </p>
              </div>
            )}

          {walking && focusedSeat && !seat && (
            <div className="focus-card" data-testid="seat-card">
              <p className="focus-key">
                <kbd>E</kbd> Sit down{held ? ' with it' : ''}
              </p>
            </div>
          )}

          {walking && focusedRecord && !held && (
            <div className="focus-card" data-testid="record-card">
              <p className="focus-title">{record?.album ?? record?.title ?? 'A Record'}</p>
              <p className="focus-author">{record?.artist ?? 'Unknown'}</p>
              <p className="focus-key">
                <kbd>E</kbd> Pick it up
              </p>
            </div>
          )}

          {walking && heldRecord && (
            <div className="held-card" data-testid="held-record-card">
              <p className="held-label">Holding a Record</p>
              <p className="focus-title">
                {heldRecordTrack?.album ?? heldRecordTrack?.title ?? 'A Record'}
              </p>
              <p className="focus-author">{heldRecordTrack?.artist ?? 'Unknown'}</p>
              <p className="focus-key">
                {focusedFixture ? (
                  <>
                    <kbd>E</kbd> Put it on
                  </>
                ) : crateTarget ? (
                  <>
                    <kbd>E</kbd> File it here
                  </>
                ) : surfaceTarget ? (
                  <>
                    <kbd>E</kbd> Set it down here
                  </>
                ) : (
                  <span className="warn">Aim at the deck, a crate or a table</span>
                )}
                {' · '}
                <kbd>Q</kbd> File it back
              </p>
            </div>
          )}

          {/* The marker. Drawing is a held mouse button rather than a key, which
              is the only thing on any card that is not. */}
          {walking && heldMarker && (
            <div className="held-card" data-testid="held-marker-card">
              <p className="held-label">Holding a Marker</p>
              <p className="focus-title">{INK_NAMES[markerInk] ?? 'Marker'}</p>
              <p className="focus-key">
                {boardTarget ? (
                  <>hold the left mouse button to draw</>
                ) : (
                  <span className="warn">Aim at a whiteboard</span>
                )}
                {' · '}
                <kbd>F</kbd> Change pen{boardTarget ? ' · ' : ''}
                {boardTarget && (
                  <>
                    <kbd>G</kbd> Wipe the board
                  </>
                )}
                {' · '}
                <kbd>Q</kbd> Put it back
              </p>
            </div>
          )}

          {/* A sheet in hand. Its own card because you can be holding a book too. */}
          {walking && heldPin && (
            <div className="held-card" data-testid="held-sheet-card">
              <p className="held-label">
                {heldPin.kind === 'page' ? 'Holding a Page' : 'Holding a Note'}
              </p>
              <p className="focus-title">
                {heldPin.kind === 'page'
                  ? (byId.get(heldPin.bookId)?.title ?? 'A Page')
                  : heldPin.text}
              </p>
              {heldPin.kind === 'page' && (
                <p className="focus-author">Page {heldPin.page} · the book keeps its own</p>
              )}
              <p className="focus-key">
                {pinTarget ? (
                  <>
                    <kbd>E</kbd> Pin it up
                  </>
                ) : (
                  <span className="warn">Aim at a wall, or at the whiteboard</span>
                )}
                {!held && (
                  <>
                    {' · '}
                    <kbd>Q</kbd> Throw it away
                  </>
                )}
              </p>
            </div>
          )}

          {walking && focusedPin && !heldPin && (
            <div className="focus-card" data-testid="pin-card">
              <p className="focus-title">
                {(() => {
                  const sheet = pins.find((item) => item.id === focusedPin)
                  if (!sheet) return 'A Sheet of Paper'
                  return sheet.kind === 'note'
                    ? (sheet.text ?? 'A Note')
                    : (byId.get(sheet.bookId ?? '')?.title ?? 'A Page')
                })()}
              </p>
              <p className="focus-key">
                <kbd>E</kbd> Take it down
              </p>
            </div>
          )}

          {walking && focusedTape && !held && (
            <div className="focus-card" data-testid="tape-card">
              <p className="focus-title">{tape?.title ?? 'A Tape'}</p>
              <p className="focus-author">{tape?.series ?? 'Unlabelled'}</p>
              <p className="focus-key">
                <kbd>E</kbd> Take it out
              </p>
            </div>
          )}

          {walking && heldTape && (
            <div className="held-card" data-testid="held-tape-card">
              <p className="held-label">Holding a Tape</p>
              <p className="focus-title">{heldTapeItem?.title ?? 'A Tape'}</p>
              <p className="focus-author">{heldTapeItem?.series ?? 'Unlabelled'}</p>
              <p className="focus-key">
                {focusedFixture ? (
                  <>
                    <kbd>E</kbd> Put it in
                  </>
                ) : tapeCrateTarget ? (
                  <>
                    <kbd>E</kbd> Put it back
                  </>
                ) : (
                  <span className="warn">Aim at the television, or at the crate</span>
                )}
                {' · '}
                <kbd>Q</kbd> Put it back
              </p>
            </div>
          )}

          {walking && focusedFixture && !held && !focusedRecord && !focusedTape && (
            <div className="focus-card" data-testid="fixture-card">
              <p className="focus-title">{fixtureName}</p>
              <p className="focus-key">
                <kbd>E</kbd> {fixtureVerb}
                {/* Whatever is loaded also comes back out. */}
                {fixture?.kind === 'recordplayer' && deck === fixture.id && nowPlaying && (
                  <>
                    {' · '}
                    <kbd>F</kbd> Take the record off
                  </>
                )}
                {fixture?.kind === 'crt' && watching && (
                  <>
                    {' · '}
                    <kbd>F</kbd> Take the tape out
                  </>
                )}
              </p>
            </div>
          )}

          {walking && carriedBox && (
            <div className="held-card" data-testid="carry-card">
              <p className="held-label">Carrying</p>
              <p className="focus-title">{carriedBox === NEW_BOX ? 'A New Box' : 'Moving Box'}</p>
              <p className="focus-key">
                <kbd>X</kbd> {carriedBox === NEW_BOX ? 'Stand it up here' : 'Set it down'}
              </p>
            </div>
          )}

          {walking && focusedBox && !focused && !held && !seat && (
            <div className="focus-card" data-testid="box-card">
              <p className="focus-title">Moving Box</p>
              <p className="focus-author">
                {view && view.total > view.shown
                  ? `${(view.offset + 1).toLocaleString()}–${(
                      view.offset + view.shown
                    ).toLocaleString()} of ${view.total.toLocaleString()}`
                  : `${(boxes[focusedBox]?.length ?? 0).toLocaleString()} books`}
              </p>
              <p className="focus-key">
                {boxes[focusedBox]?.length ? (
                  <>
                    <kbd>G</kbd> Shelve them all
                    {browsing && (
                      <>
                        {' · '}
                        <kbd>,</kbd>
                        <kbd>.</kbd> or scroll to browse
                      </>
                    )}
                    {' · '}
                    <kbd>X</kbd> Carry it
                  </>
                ) : (
                  <>
                    <span className="dim">Empty</span> · <kbd>X</kbd> Carry it ·{' '}
                    <kbd>⌫</kbd> Break it down
                  </>
                )}
              </p>
            </div>
          )}

          {walking && seat && (
            <div className="held-card" data-testid="seated-card">
              <p className="held-label">Sitting</p>
              <p className="focus-key">
                <kbd>E</kbd> Stand up
                {held && (
                  <>
                    {' · '}
                    <kbd>R</kbd> Read
                  </>
                )}
              </p>
            </div>
          )}

          {walking && held && (
            <div className="held-card" data-testid="held-card">
              <p className="held-label">Holding</p>
              <p className="focus-title">{held.title}</p>
              <p className="focus-author">{held.author ?? 'Unknown'}</p>
              <p className="focus-key">
                {shelfTarget ? (
                  <>
                    <kbd>E</kbd> Shelve here
                  </>
                ) : boxTarget ? (
                  <>
                    <kbd>E</kbd> Drop in the box
                  </>
                ) : surfaceTarget ? (
                  <>
                    <kbd>E</kbd> Set it down here
                  </>
                ) : (
                  <span className="warn">Look at a shelf, a box or a table</span>
                )}
                {' · '}
                <kbd>Q</kbd> Drop it · <kbd>O</kbd> Leave it open · <kbd>R</kbd> Read
              </p>
            </div>
          )}

          {mode === 'read' && reading && (
            <div className="held-card" data-testid="reading-card">
              <p className="held-label">Reading</p>
              <p className="focus-title">{reading.title}</p>
              {readerFailure ? (
                <p className="focus-key" data-testid="reader-failure">
                  This book will not open — {readerFailure} · <kbd>Esc</kbd> Close
                </p>
              ) : readerPen ? (
                <p className="focus-key">
                  The pen is up — drag to draw on the page · <kbd>←</kbd>
                  <kbd>→</kbd> Turn · <kbd>D</kbd> Put the pen down
                </p>
              ) : (
                <p className="focus-key">
                  Drag a page across · <kbd>←</kbd>
                  <kbd>→</kbd> Turn · <kbd>B</kbd> Bookmark · <kbd>N</kbd> Note ·{' '}
                  <kbd>D</kbd> Pen · <kbd>P</kbd> Copy this page · <kbd>J</kbd> Go to page ·{' '}
                  <kbd>Esc</kbd> Close
                </p>
              )}
              {inkedPages.length > 0 && (
                <p className="note">
                  <button
                    data-testid="wipe-page"
                    onClick={() => {
                      if (readingId) for (const p of inkedPages) wipePage(readingId, p)
                    }}
                  >
                    Wipe the Drawing
                  </button>
                </p>
              )}
              {visibleNotes.map((note) => (
                <p className="note" key={note.id} data-testid="reader-note">
                  p. {note.page} — {note.text}{' '}
                  <button
                    data-testid="delete-note"
                    aria-label="Delete this note"
                    onClick={() => readingId && deleteNote(readingId, note.id)}
                  >
                    ×
                  </button>
                </p>
              ))}
            </div>
          )}

          {walking && !pointerLocked && (
            <div className="lock-hint" data-testid="lock-hint">
              Click to look around · <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> Move · <kbd>E</kbd> Take, shelve, sit, switch on · <kbd>Q</kbd> Drop ·{' '}
              <kbd>G</kbd> Empty a box · <kbd>V</kbd> Call the cat · <kbd>F1</kbd> All controls ·{' '}
              <kbd>F2</kbd> Settings
            </div>
          )}

          {/*
            The status strip. Deliberately small, deliberately top-right, and
            deliberately not a control panel: what it carries is the state of the
            library and anything going wrong with it. It says nothing at all when
            there is nothing to say beyond how many books there are.
          */}
          <div className={`status ${notices ? 'status-loud' : ''}`} data-testid="status">
            <p className="status-name">{worldName ?? '…'}</p>
            <p className="note" data-testid="book-count">
              {books.length.toLocaleString()} books · {shelved.toLocaleString()} shelved
              {boxed > 0 && ` · ${boxed.toLocaleString()} in boxes`}
            </p>

            {scanning && progress && (
              <p className="note" data-testid="scan-progress">
                Scanning {progress.done} / {progress.total} — {progress.current}
              </p>
            )}

            {/* A newly indexed library is entirely in boxes, which is only
                obvious once you know that unpacking is a thing you do. */}
            {boxed > 0 && shelved === 0 && (
              <p className="note" data-testid="unpack-hint">
                Look at a box and press <kbd>G</kbd> to unpack it.
              </p>
            )}
            {reconciliation && (
              <p className="note warn" data-testid="reconciliation">
                {reconciliation}
              </p>
            )}
            {error && <p className="note warn">{error}</p>}
            {worldError && (
              <p className="note warn" data-testid="world-error">
                {worldError}
              </p>
            )}

            <div className="row-controls">
              <button data-testid="open-settings" onClick={() => setSettingsOpen(true)}>
                Settings <kbd>F2</kbd>
              </button>
              <button data-testid="open-controls" onClick={() => setControlsOpen(!controlsOpen)}>
                Controls <kbd>F1</kbd>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Typed conversations and the key legend outlive the chrome: hiding the
          HUD should not eat a label mid-sentence or the card that says how to
          bring it back. The menus outlive it for a stronger reason — the HUD is
          hidden *by* a key, and the settings panel is where you turn it back on. */}
      <ShelfLabelField />
      <JumpToPageField />
      <NoteField />
      <BookNoteField />
      <SearchField />
      <ControlsCard />
      <SettingsCard />
      <MainMenu />
    </>
  )
}
