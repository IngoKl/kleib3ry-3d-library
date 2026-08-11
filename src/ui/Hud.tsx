import { useEffect, useState } from 'react'
import { library } from '../services'
import { metrics, type RenderMetrics } from '../state/metrics'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

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
  const seat = useAppStore((s) => s.seat)
  const drawn = useAppStore((s) => s.drawn)
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

  useEffect(() => {
    const id = setInterval(() => setRender({ ...metrics }), 250)
    return () => clearInterval(id)
  }, [])

  const focused = focusedId ? byId.get(focusedId) : undefined
  const held = heldId ? byId.get(heldId) : undefined
  const reading = readingId ? byId.get(readingId) : undefined
  const walking = mode === 'walk'

  return (
    <>
      {walking && (
        <div
          className={`crosshair ${
            focused || shelfTarget || focusedSeat || focusedBox || boxTarget
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
          <p className="focus-key">
            <kbd>E</kbd> take · <kbd>F</kbd> {drawn ? 'put back' : 'show cover'}
          </p>
        </div>
      )}

      {walking && focusedSeat && !held && !seat && (
        <div className="focus-card" data-testid="seat-card">
          <p className="focus-key">
            <kbd>E</kbd> sit down
          </p>
        </div>
      )}

      {walking && focusedBox && !focused && !held && !seat && (
        <div className="focus-card" data-testid="box-card">
          <p className="focus-title">moving box</p>
          <p className="focus-author">
            {(boxes[focusedBox]?.length ?? 0).toLocaleString()} books
          </p>
          <p className="focus-key">
            {boxes[focusedBox]?.length ? (
              <>
                <kbd>G</kbd> shelve them all
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
            ) : (
              <span className="warn">look at a shelf or a box to put it down</span>
            )}
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
            <kbd>→</kbd> turn · <kbd>B</kbd> bookmark · <kbd>Esc</kbd> close
          </p>
        </div>
      )}

      {walking && !pointerLocked && (
        <div className="lock-hint" data-testid="lock-hint">
          click to look around · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>shift</kbd> run · <kbd>ctrl</kbd> kneel ·{' '}
          <kbd>E</kbd> take, shelve, sit · <kbd>G</kbd> empty a box · <kbd>F</kbd> show cover
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
          {/* A newly indexed library is entirely in boxes, which is only
              obvious once you know that unpacking is a thing you do. */}
          {boxed > 0 && shelved === 0 && (
            <p className="note" data-testid="unpack-hint">
              Nothing is shelved yet. Look at a box and press <kbd>G</kbd> to unpack it onto the
              shelves, or take books out one at a time with <kbd>E</kbd>.
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

        <div className="row">
          <button onClick={() => setStatsOpen((open) => !open)}>
            {statsOpen ? 'hide' : 'show'} stats
          </button>
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
  )
}
