import { useEffect, useMemo, useState } from 'react'
import { readerStatus } from '../reader/status'
import { cat } from '../state/cat'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'
import { LAMPS } from '../world/derive'
import { ShelfLabelField } from './ShelfLabelField'
import { JumpToPageField } from './JumpToPageField'
import { NoteField } from './NoteField'
import { SearchField } from './SearchField'
import { ControlsCard } from './ControlsCard'
import { SettingsCard } from './SettingsCard'
import { MainMenu } from './MainMenu'

/**
 * The overlay.
 *
 * It used to be one long panel down the right-hand side carrying everything the
 * app could say about itself — the library folder, the scan button, the record
 * count, the night switch, the renderer statistics — which meant the room was
 * permanently behind a column of administration. What is left here is only the
 * two things an overlay is for:
 *
 *   - **what is under the crosshair, and which key acts on it.** Those are the
 *     cards, and they are the interface;
 *   - **what the app is doing that you did not ask for**: a scan running, a
 *     document that will not parse, a library still in its boxes. Errors and
 *     progress are not settings and must not be behind a panel.
 *
 * Everything else moved. Choosing a library is the main menu, because it is a
 * decision you make before you are in a room; the switches are the settings
 * panel, because a switch you set once a month should not be in front of you
 * for the other thirty days.
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
  const tapes = useVideoStore((s) => s.tapes)
  const watching = useVideoStore((s) => s.playing)
  const watchPaused = useVideoStore((s) => s.paused)
  const lightsOn = useLightStore((s) => s.on)
  const brewing = useAppStore((s) => s.brewing)

  // Why the reader is showing nothing, on the same poll as the render stats:
  // `readerStatus` lives outside React, and the failure plane in the scene has
  // no way to carry text — without this the message existed only for tests.
  const [readerFailure, setReaderFailure] = useState<string | null>(null)
  /** The cat's mood, likewise: it changes every frame and is read on a poll. */
  const [purring, setPurring] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setReaderFailure(readerStatus.failure)
      setPurring(cat.purr > 0.2)
    }, 250)
    return () => clearInterval(id)
  }, [])

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
  const fixtureName =
    fixture?.kind === 'recordplayer'
      ? 'record player'
      : fixture?.kind === 'crt'
        ? 'television'
        : fixture?.kind === 'coffeemaker'
          ? 'coffee maker'
          : fixture?.kind === 'computer'
            ? 'the catalogue'
            : fixture?.kind === 'postits'
              ? 'a pad of notes'
              : fixture?.kind === 'fireplace'
                ? 'the fire'
                : fixture?.kind === 'pendant'
                  ? 'ceiling light'
                  : 'lamp'
  const fixtureVerb =
    fixture && LAMPS.has(fixture.kind)
      ? fixtureLit
        ? 'switch it off'
        : 'switch it on'
      : fixture?.kind === 'recordplayer'
        ? nowPlaying && !paused
          ? 'pause'
          : 'play'
        : fixture?.kind === 'crt'
          ? // An empty set says so rather than helping itself to a tape: putting
            // one in is a thing you do with your hands.
            watching === null
            ? 'no tape in it'
            : watchPaused
              ? 'play'
              : 'pause'
          : fixture?.kind === 'computer'
            ? 'look something up'
            : fixture?.kind === 'postits'
              ? 'take one and write on it'
              : brewing === fixture?.id
                ? 'brewing…'
                : 'put the coffee on'

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
                {focused.author ?? 'unknown'} · {focused.format}
                {focused.pageCount ? ` · ${focused.pageCount} pp` : ''}
              </p>
              {/* A book in a box lies cover up, so there is nothing to turn round —
                  F is for a book on a shelf, where the cover faces its neighbour.
                  The box it is lying in is offered alongside it, because otherwise
                  you would have to find a patch of bare cardboard to point at. */}
              <p className="focus-key">
                <kbd>E</kbd> take
                {focusedBox ? (
                  <>
                    {' · '}
                    <kbd>G</kbd> shelve this box (
                    {(boxes[focusedBox]?.length ?? 0).toLocaleString()})
                    {browsing && (
                      <>
                        {' · '}
                        <kbd>,</kbd>
                        <kbd>.</kbd> browse
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {' · '}
                    <kbd>F</kbd> {drawn ? 'put back' : 'show cover'}
                  </>
                )}
              </p>
            </div>
          )}

          {/* The cat. Its own card, and the only one that is about somebody
              rather than something. */}
          {walking && focusedCat && (
            <div className="focus-card" data-testid="cat-card">
              <p className="focus-title">the cat</p>
              <p className="focus-author">{purring ? 'purring' : 'looking at you'}</p>
              <p className="focus-key">
                <kbd>E</kbd> give it a fuss · <kbd>F</kbd> ask it for a book
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
                  <kbd>L</kbd> write on this bookcase
                </p>
              </div>
            )}

          {walking && focusedSeat && !seat && (
            <div className="focus-card" data-testid="seat-card">
              <p className="focus-key">
                <kbd>E</kbd> sit down{held ? ' with it' : ''}
              </p>
            </div>
          )}

          {walking && focusedRecord && !held && (
            <div className="focus-card" data-testid="record-card">
              <p className="focus-title">{record?.album ?? record?.title ?? 'a record'}</p>
              <p className="focus-author">{record?.artist ?? 'unknown'}</p>
              <p className="focus-key">
                <kbd>E</kbd> take it out
              </p>
            </div>
          )}

          {walking && heldRecord && (
            <div className="held-card" data-testid="held-record-card">
              <p className="held-label">holding a record</p>
              <p className="focus-title">
                {heldRecordTrack?.album ?? heldRecordTrack?.title ?? 'a record'}
              </p>
              <p className="focus-author">{heldRecordTrack?.artist ?? 'unknown'}</p>
              <p className="focus-key">
                {focusedFixture ? (
                  <>
                    <kbd>E</kbd> put it on
                  </>
                ) : crateTarget ? (
                  <>
                    <kbd>E</kbd> file it back
                  </>
                ) : (
                  <span className="warn">aim at the deck, or at a crate</span>
                )}
                {' · '}
                <kbd>Q</kbd> file it back
              </p>
            </div>
          )}

          {/* A sheet in hand. Its own card rather than a line on the book card,
              because you can be holding both — a page torn out of the book still in
              your other hand is the whole point of the gesture. */}
          {walking && heldPin && (
            <div className="held-card" data-testid="held-sheet-card">
              <p className="held-label">
                {heldPin.kind === 'page' ? 'holding a page' : 'holding a note'}
              </p>
              <p className="focus-title">
                {heldPin.kind === 'page'
                  ? (byId.get(heldPin.bookId)?.title ?? 'a page')
                  : heldPin.text}
              </p>
              {heldPin.kind === 'page' && (
                <p className="focus-author">page {heldPin.page} · the book keeps its own</p>
              )}
              <p className="focus-key">
                {pinTarget ? (
                  <>
                    <kbd>E</kbd> pin it up
                  </>
                ) : (
                  <span className="warn">aim at a wall, or at the whiteboard</span>
                )}
                {!held && (
                  <>
                    {' · '}
                    <kbd>Q</kbd> throw it away
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
                  if (!sheet) return 'a sheet of paper'
                  return sheet.kind === 'note'
                    ? (sheet.text ?? 'a note')
                    : (byId.get(sheet.bookId ?? '')?.title ?? 'a page')
                })()}
              </p>
              <p className="focus-key">
                <kbd>E</kbd> take it down
              </p>
            </div>
          )}

          {walking && focusedTape && !held && (
            <div className="focus-card" data-testid="tape-card">
              <p className="focus-title">{tape?.title ?? 'a tape'}</p>
              <p className="focus-author">{tape?.series ?? 'unlabelled'}</p>
              <p className="focus-key">
                <kbd>E</kbd> take it out
              </p>
            </div>
          )}

          {walking && heldTape && (
            <div className="held-card" data-testid="held-tape-card">
              <p className="held-label">holding a tape</p>
              <p className="focus-title">{heldTapeItem?.title ?? 'a tape'}</p>
              <p className="focus-author">{heldTapeItem?.series ?? 'unlabelled'}</p>
              <p className="focus-key">
                {focusedFixture ? (
                  <>
                    <kbd>E</kbd> put it in
                  </>
                ) : tapeCrateTarget ? (
                  <>
                    <kbd>E</kbd> put it back
                  </>
                ) : (
                  <span className="warn">aim at the television, or at the crate</span>
                )}
                {' · '}
                <kbd>Q</kbd> put it back
              </p>
            </div>
          )}

          {walking && focusedFixture && !held && !focusedRecord && !focusedTape && (
            <div className="focus-card" data-testid="fixture-card">
              <p className="focus-title">{fixtureName}</p>
              <p className="focus-key">
                <kbd>E</kbd> {fixtureVerb}
              </p>
            </div>
          )}

          {walking && carriedBox && (
            <div className="held-card" data-testid="carry-card">
              <p className="held-label">carrying</p>
              <p className="focus-title">{carriedBox}</p>
              <p className="focus-key">
                <kbd>X</kbd> set it down
              </p>
            </div>
          )}

          {walking && focusedBox && !focused && !held && !seat && (
            <div className="focus-card" data-testid="box-card">
              <p className="focus-title">moving box</p>
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
                    <kbd>G</kbd> shelve them all
                    {browsing && (
                      <>
                        {' · '}
                        <kbd>,</kbd>
                        <kbd>.</kbd> or scroll to browse
                      </>
                    )}
                  </>
                ) : (
                  <span className="dim">empty</span>
                )}
              </p>
            </div>
          )}

          {walking && seat && (
            <div className="held-card" data-testid="seated-card">
              <p className="held-label">sitting</p>
              <p className="focus-key">
                <kbd>E</kbd> stand up
                {held && (
                  <>
                    {' · '}
                    <kbd>R</kbd> read
                  </>
                )}
              </p>
            </div>
          )}

          {walking && held && (
            <div className="held-card" data-testid="held-card">
              <p className="held-label">holding</p>
              <p className="focus-title">{held.title}</p>
              <p className="focus-author">{held.author ?? 'unknown'}</p>
              <p className="focus-key">
                {shelfTarget ? (
                  <>
                    <kbd>E</kbd> shelve here
                  </>
                ) : boxTarget ? (
                  <>
                    <kbd>E</kbd> drop in the box
                  </>
                ) : surfaceTarget ? (
                  <>
                    <kbd>E</kbd> set it down here
                  </>
                ) : (
                  <span className="warn">look at a shelf, a box or a table</span>
                )}
                {' · '}
                <kbd>Q</kbd> drop it · <kbd>O</kbd> leave it open · <kbd>R</kbd> read
              </p>
            </div>
          )}

          {mode === 'read' && reading && (
            <div className="held-card" data-testid="reading-card">
              <p className="held-label">reading</p>
              <p className="focus-title">{reading.title}</p>
              {readerFailure ? (
                <p className="focus-key" data-testid="reader-failure">
                  this book will not open — {readerFailure} · <kbd>Esc</kbd> close
                </p>
              ) : (
                <p className="focus-key">
                  drag a page across · <kbd>←</kbd>
                  <kbd>→</kbd> turn · <kbd>B</kbd> bookmark · <kbd>J</kbd> go to page ·{' '}
                  <kbd>Esc</kbd> close
                </p>
              )}
            </div>
          )}

          {walking && !pointerLocked && (
            <div className="lock-hint" data-testid="lock-hint">
              click to look around · <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> move · <kbd>E</kbd> take, shelve, sit, switch on · <kbd>Q</kbd> drop ·{' '}
              <kbd>G</kbd> empty a box · <kbd>V</kbd> call the cat · <kbd>F1</kbd> all controls ·{' '}
              <kbd>F2</kbd> settings
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
                scanning {progress.done} / {progress.total} — {progress.current}
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
                settings <kbd>F2</kbd>
              </button>
              <button data-testid="open-controls" onClick={() => setControlsOpen(!controlsOpen)}>
                controls <kbd>F1</kbd>
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
      <SearchField />
      <ControlsCard />
      <SettingsCard />
      <MainMenu />
    </>
  )
}
