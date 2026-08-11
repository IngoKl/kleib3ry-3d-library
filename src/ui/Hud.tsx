import { useEffect, useMemo, useState } from 'react'
import { library } from '../services'
import { metrics, type RenderMetrics } from '../state/metrics'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'
import { LAMPS, floorAt, supportAt } from '../world/derive'
import { ShelfLabelField } from './ShelfLabelField'
import { JumpToPageField } from './JumpToPageField'
import { ControlsCard } from './ControlsCard'

export function Hud() {
  const [render, setRender] = useState<RenderMetrics>({ ...metrics })
  const [statsOpen, setStatsOpen] = useState(false)

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
  const focusedShelf = useAppStore((s) => s.focusedShelf)
  const hudHidden = useAppStore((s) => s.hudHidden)
  const controlsOpen = useAppStore((s) => s.controlsOpen)
  const setControlsOpen = useAppStore((s) => s.setControlsOpen)
  const toggleHud = useAppStore((s) => s.toggleHud)
  const surfaceTarget = useAppStore((s) => s.surfaceTarget)
  const carriedBox = useAppStore((s) => s.carriedBox)
  const pointerLocked = useAppStore((s) => s.pointerLocked)
  const libraryRoot = useAppStore((s) => s.libraryRoot)
  const rootLoaded = useAppStore((s) => s.rootLoaded)
  const pickRoot = useAppStore((s) => s.pickRoot)
  const driver = useAppStore((s) => s.driver)

  const books = useLibraryStore((s) => s.books)
  const byId = useLibraryStore((s) => s.byId)
  const shelved = useLibraryStore((s) => s.packed.length)
  const boxed = useLibraryStore((s) => s.boxed.length)
  const boxes = useLibraryStore((s) => s.boxes)
  const reconciliation = useLibraryStore((s) => s.reconciliation)
  const scanning = useLibraryStore((s) => s.scanning)
  const progress = useLibraryStore((s) => s.progress)
  const lastScan = useLibraryStore((s) => s.lastScan)
  const error = useLibraryStore((s) => s.error)
  const scan = useLibraryStore((s) => s.scan)

  const worldName = useWorldStore((s) => s.world?.doc.name ?? null)
  const worldError = useWorldStore((s) => s.error)
  const savePaths = useWorldStore((s) => s.paths)
  const world = useWorldStore((s) => s.world)

  const tracks = useMediaStore((s) => s.tracks)
  const nowPlaying = useMediaStore((s) => s.playing)
  const paused = useMediaStore((s) => s.paused)
  const musicError = useMediaStore((s) => s.error)
  const lightsOn = useLightStore((s) => s.on)
  const night = useLightStore((s) => s.night)
  const toggleNight = useLightStore((s) => s.toggleNight)
  const brewing = useAppStore((s) => s.brewing)
  const packEverything = useLibraryStore((s) => s.packEverything)
  const packLooseBooks = useLibraryStore((s) => s.packLooseBooks)
  const loose = useLibraryStore((s) => s.loose)

  // Books lying on a floor, as opposed to left on a table — the same test the
  // action itself applies, so the count on the button is the count that moves.
  const strayCount = useMemo(() => {
    if (!world) return 0
    return Object.values(loose).filter((at) => {
      const floor = floorAt(world, at.x, at.z, at.y + 0.1)
      if (floor === null) return true
      return supportAt(world, at.x, at.z, at.y + 0.1) <= floor + 0.02
    }).length
  }, [world, loose])

  useEffect(() => {
    const id = setInterval(() => setRender({ ...metrics }), 250)
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
  const fixture = focusedFixture
    ? world?.furniture.find((item) => item.id === focusedFixture)
    : undefined
  const fixtureLit = fixture ? lightsOn[fixture.id] ?? (fixture.on ?? true) : false
  const fixtureName =
    fixture?.kind === 'recordplayer'
      ? 'record player'
      : fixture?.kind === 'coffeemaker'
        ? 'coffee maker'
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
        : brewing === fixture?.id
          ? 'brewing…'
          : 'put the coffee on'

  return (
    <>
      {!hudHidden && (
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

      {walking && focused && !held && (
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
                <kbd>G</kbd> shelve this box ({(boxes[focusedBox]?.length ?? 0).toLocaleString()})
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

      {/* A bare bookcase offers its label. Only when nothing else is under the
          crosshair — a case full of books is spoken for by the book card. */}
      {walking &&
        focusedShelf &&
        !focused &&
        !focusedBox &&
        !focusedSeat &&
        !focusedRecord &&
        !focusedFixture &&
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

      {walking && focusedFixture && !held && !focusedRecord && (
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
            <kbd>Q</kbd> drop it · <kbd>O</kbd> leave it open
            {held.format === 'pdf' && (
              <>
                {' · '}
                <kbd>R</kbd> read
              </>
            )}
          </p>
        </div>
      )}

      {mode === 'read' && reading && (
        <div className="held-card" data-testid="reading-card">
          <p className="held-label">reading</p>
          <p className="focus-title">{reading.title}</p>
          <p className="focus-key">
            drag a page across · <kbd>←</kbd>
            <kbd>→</kbd> turn · <kbd>B</kbd> bookmark · <kbd>J</kbd> go to page ·{' '}
            <kbd>Esc</kbd> close
          </p>
        </div>
      )}

      {walking && !pointerLocked && (
        <div className="lock-hint" data-testid="lock-hint">
          click to look around · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>E</kbd> take, shelve, sit, switch on · <kbd>Q</kbd> drop ·{' '}
          <kbd>G</kbd> empty a box · <kbd>L</kbd> label a shelf · <kbd>N</kbd> night ·{' '}
          <kbd>H</kbd> hide hud · <kbd>F1</kbd> all controls
        </div>
      )}

      <div className="panel panel-right">
        <div className="row">
          <span className="row-label">this library</span>
          <p className="path" data-testid="world-file">
            {savePaths?.world ?? 'checking…'}
          </p>
          <p className="note">
            {worldName ?? '…'} — edit that file and the room reloads as you save it.
          </p>
          {worldError && (
            <p className="note warn" data-testid="world-error">
              {worldError}
            </p>
          )}
        </div>

        <div className="row">
          <span className="row-label">library folder</span>
          <p className="path" data-testid="library-root">
            {!rootLoaded ? 'checking…' : (libraryRoot ?? 'not chosen yet')}
          </p>
          <div className="row-controls">
            <button onClick={() => void pickRoot()} disabled={!library.canPickFolder}>
              choose folder…
            </button>
            <button onClick={() => void scan()} disabled={!library.canIndex || scanning || !libraryRoot}>
              {scanning ? 'scanning…' : 'scan'}
            </button>
          </div>

          {scanning && progress && (
            <p className="note" data-testid="scan-progress">
              {progress.done} / {progress.total} — {progress.current}
            </p>
          )}
          {!scanning && lastScan && (
            <p className="note">
              {lastScan.added} new · {lastScan.unchanged} unchanged · {lastScan.removed} gone
              {lastScan.failed > 0 && ` · ${lastScan.failed} unreadable`}
            </p>
          )}
          {error && <p className="note warn">{error}</p>}

          <p className="note" data-testid="book-count">
            {books.length.toLocaleString()} books · {shelved.toLocaleString()} shelved
            {boxed > 0 && ` · ${boxed.toLocaleString()} in boxes`}
          </p>
          {/* The way back from an arrangement you have decided against. It is a
              button rather than a key because it moves the whole library at
              once, and it says how many rather than asking twice. */}
          <div className="row-controls">
            <button
              data-testid="pack-everything"
              disabled={shelved === 0}
              onClick={() => packEverything()}
              title="Every book off every shelf and back into the boxes"
            >
              clear the shelves
            </button>
            <button
              data-testid="pack-strays"
              disabled={strayCount === 0}
              onClick={() => packLooseBooks()}
              title="Every book lying on a floor, into the nearest box — books left on tables stay put"
            >
              box the strays{strayCount > 0 ? ` (${strayCount})` : ''}
            </button>
          </div>

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
          {!library.canIndex && (
            <p className="note warn">
              Browser mode shows a generated stand-in library. Run{' '}
              <code>npm run tauri:dev</code> to index your own files.
            </p>
          )}
        </div>

        {/* Records and pictures come out of the same folder as the books, so
            "there is no music" should look like a folder you have not filled
            rather than like something being broken. */}
        <div className="row">
          <span className="row-label">records</span>
          <p className="note" data-testid="record-count">
            {tracks.length === 0
              ? 'nothing in music/ yet'
              : `${tracks.length.toLocaleString()} on the shelf`}
            {nowPlaying && ` · ${paused ? 'paused' : 'playing'}`}
          </p>
          {musicError && <p className="note warn">{musicError}</p>}
        </div>

        <div className="row">
          <span className="row-label">outside</span>
          <div className="row-controls">
            <button data-testid="toggle-night" onClick={() => toggleNight()}>
              {night ? 'make it day' : 'make it night'}
            </button>
          </div>
          <p className="note">
            or press <kbd>N</kbd> in the room
          </p>
        </div>

        <div className="row">
          <div className="row-controls">
            <button data-testid="open-controls" onClick={() => setControlsOpen(!controlsOpen)}>
              controls <kbd>F1</kbd>
            </button>
            <button onClick={() => toggleHud()} title="Press H to bring it back">
              hide hud <kbd>H</kbd>
            </button>
            <button onClick={() => setStatsOpen((open) => !open)}>
              {statsOpen ? 'hide' : 'show'} stats
            </button>
          </div>
        </div>

        {statsOpen && (
          <dl>
            <dt>fps</dt>
            <dd>
              {render.fps.toFixed(0)} <span className="dim">min {render.fpsMin.toFixed(0)}</span>
            </dd>
            <dt>draw calls</dt>
            <dd>{render.drawCalls}</dd>
            <dt>triangles</dt>
            <dd>{render.triangles.toLocaleString()}</dd>
            <dt>file driver</dt>
            <dd className={driver === 'tauri' ? 'ok' : 'warn'}>{driver}</dd>
          </dl>
        )}
      </div>
        </>
      )}

      {/* Typed conversations and the key legend outlive the chrome: hiding the
          HUD should not eat a label mid-sentence or the card that says how to
          bring it back. */}
      <ShelfLabelField />
      <JumpToPageField />
      <ControlsCard />
    </>
  )
}
