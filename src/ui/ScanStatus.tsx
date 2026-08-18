import { useLibraryStore } from '../state/library'
import { describeEta, etaMs } from '../lib/scanEta'

/**
 * The running scan: how far it has got, roughly how long is left, and the file
 * it is on. One component, because the HUD, the settings panel and the main
 * menu all want the same three lines. Renders nothing while no scan runs, and
 * refreshes on the scan's own progress events rather than on a clock.
 */
export function ScanStatus() {
  const scanning = useLibraryStore((s) => s.scanning)
  const progress = useLibraryStore((s) => s.progress)
  const scanStarted = useLibraryStore((s) => s.scanStarted)

  if (!scanning) return null
  if (!progress || progress.total === 0) {
    return (
      <p className="note" data-testid="scan-progress">
        Scanning — looking through the folder…
      </p>
    )
  }

  const { done, total, current } = progress
  const elapsed = scanStarted !== null ? performance.now() - scanStarted : 0
  const left = etaMs(done, total, elapsed)

  return (
    <div className="scan-status" data-testid="scan-progress">
      <p className="note">
        Scanning {done.toLocaleString()} of {total.toLocaleString()} ·{' '}
        {Math.floor((done / total) * 100)}%{left !== null && ` · ${describeEta(left)}`}
      </p>
      <div className="scan-bar" aria-hidden="true">
        <div className="scan-bar-fill" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <p className="note dim scan-current">{current}</p>
    </div>
  )
}
