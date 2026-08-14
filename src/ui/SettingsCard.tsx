import { useEffect, useMemo, useState } from 'react'
import { DRIVER_LABELS, library } from '../services'
import { composeAnnotationsMarkdown } from '../data/annotationsMarkdown'
import { metrics, type RenderMetrics } from '../state/metrics'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { annotationsDocument, useAnnotationsStore } from '../state/annotations'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { eveningNow, useSettings } from '../state/settings'
import { floorAt, supportAt } from '../world/derive'

/**
 * Settings, behind F2. Sections are ordered by how often they are opened:
 * display first, the library folder last.
 */

function Toggle({
  label,
  hint,
  on,
  onChange,
  testId,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (next: boolean) => void
  testId?: string
}) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <button
        className={on ? 'on' : ''}
        data-testid={testId}
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>
  )
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (next: number) => void
}) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="setting-value">{format(value)}</span>
      </div>
    </div>
  )
}

export function SettingsCard() {
  const open = useAppStore((s) => s.settingsOpen)
  /** The renderer's numbers, on a poll. Here rather than permanently on screen. */
  const [render, setRender] = useState<RenderMetrics>({ ...metrics })
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setRender({ ...metrics }), 250)
    return () => clearInterval(id)
  }, [open])

  // Give the mouse back: a panel of buttons under a captured pointer is unusable.
  // Clicking the room takes the lock again.
  useEffect(() => {
    if (open && document.pointerLockElement) document.exitPointerLock()
  }, [open])

  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const hudHidden = useAppStore((s) => s.hudHidden)
  const toggleHud = useAppStore((s) => s.toggleHud)
  const libraryRoot = useAppStore((s) => s.libraryRoot)
  const rootLoaded = useAppStore((s) => s.rootLoaded)
  const pickRoot = useAppStore((s) => s.pickRoot)
  const driver = useAppStore((s) => s.driver)

  const settings = useSettings()
  const night = useAmbienceStore((s) => s.night)
  const toggleNight = useAmbienceStore((s) => s.toggleNight)
  const rain = useAmbienceStore((s) => s.rain)
  const toggleRain = useAmbienceStore((s) => s.toggleRain)

  const scanning = useLibraryStore((s) => s.scanning)
  const scan = useLibraryStore((s) => s.scan)
  const lastScan = useLibraryStore((s) => s.lastScan)
  const shelved = useLibraryStore((s) => s.packed.length)
  const packEverything = useLibraryStore((s) => s.packEverything)
  const packLooseBooks = useLibraryStore((s) => s.packLooseBooks)
  const loose = useLibraryStore((s) => s.loose)
  const world = useWorldStore((s) => s.world)
  const savePaths = useWorldStore((s) => s.paths)

  const annotatedBooks = useAnnotationsStore(
    (s) => new Set([...Object.keys(s.bookmarks), ...Object.keys(s.notes)]).size,
  )
  const [exported, setExported] = useState<string | null>(null)

  const exportAnnotations = async () => {
    const markdown = composeAnnotationsMarkdown(annotationsDocument(), new Date())
    const path = await library.exportAnnotationsMarkdown(markdown).catch(() => null)
    if (path) {
      setExported(`Written to ${path}`)
      return
    }
    // No filesystem on this host — hand the same text over as a download.
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'annotations.md'
    a.click()
    URL.revokeObjectURL(url)
    setExported('Downloaded annotations.md')
  }

  const tracks = useMediaStore((s) => s.tracks)
  const musicError = useMediaStore((s) => s.error)
  const tapes = useVideoStore((s) => s.tapes)
  const videoError = useVideoStore((s) => s.error)

  // Books on a floor rather than left on a table — the same test the action
  // applies, so the count on the button is the count that moves.
  const strayCount = useMemo(() => {
    if (!world) return 0
    return Object.values(loose).filter((at) => {
      const floor = floorAt(world, at.x, at.z, at.y + 0.1)
      if (floor === null) return true
      return supportAt(world, at.x, at.z, at.y + 0.1) <= floor + 0.02
    }).length
  }, [world, loose])

  if (!open) return null

  return (
    <div className="settings-card" data-testid="settings-card">
      <div className="settings-head">
        <p className="field-label">Settings</p>
        <button onClick={() => setOpen(false)}>
          Close <kbd>F2</kbd>
        </button>
      </div>

      <p className="controls-heading">Display</p>
      <Toggle
        label="Low Performance Mode"
        hint="No shadows, no window light, one pixel per pixel. For an older machine."
        on={settings.lowPerformance}
        testId="low-performance"
        onChange={(next) => settings.set('lowPerformance', next)}
      />
      <Toggle
        label="Show My Body"
        hint="Look down and see your own legs."
        on={settings.showBody}
        testId="show-body"
        onChange={(next) => settings.set('showBody', next)}
      />
      <Toggle
        label="Interface"
        hint="The cards and the status strip. H does this too."
        on={!hudHidden}
        onChange={() => toggleHud()}
      />
      <Slider
        label="Mouse Sensitivity"
        value={settings.sensitivity}
        min={0.2}
        max={3}
        step={0.05}
        format={(value) => `${value.toFixed(2)}x`}
        onChange={(next) => settings.set('sensitivity', next)}
      />

      <p className="controls-heading">Sound</p>
      <Slider
        label="Volume"
        value={settings.volume}
        min={0}
        max={1}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(next) => settings.set('volume', next)}
      />
      <Slider
        label="Rain Volume"
        hint="How loud the weather is, on top of the volume above."
        value={settings.rainVolume}
        min={0}
        max={1}
        step={0.05}
        format={(value) => (value === 0 ? 'off' : `${Math.round(value * 100)}%`)}
        onChange={(next) => settings.set('rainVolume', next)}
      />
      <Slider
        label="Small Sounds"
        hint="The fire's crackle, the cat's purr, the dust on a record — on top of the volume above."
        value={settings.ambientVolume}
        min={0}
        max={1}
        step={0.05}
        format={(value) => (value === 0 ? 'off' : `${Math.round(value * 100)}%`)}
        onChange={(next) => settings.set('ambientVolume', next)}
      />
      <Toggle
        label="Sound in the Room"
        hint="The deck and the television get quieter as you walk away, and come from where they stand."
        on={settings.positionalAudio}
        testId="positional-audio"
        onChange={(next) => settings.set('positionalAudio', next)}
      />
      <p className="note">
        {tracks.length === 0 ? 'Nothing in music/ yet' : `${tracks.length} records`} ·{' '}
        {tapes.length === 0 ? 'nothing in video/ yet' : `${tapes.length} tapes`}
      </p>
      {musicError && <p className="note warn">{musicError}</p>}
      {videoError && <p className="note warn">{videoError}</p>}

      <p className="controls-heading">Outside</p>
      <Toggle
        label="Night"
        hint="N does this in the room."
        on={night}
        testId="toggle-night"
        onChange={() => toggleNight()}
      />
      <Toggle
        label="Match the Clock"
        hint="Night follows this machine's clock when a library opens. N still works after that."
        on={settings.matchClock}
        testId="match-clock"
        onChange={(next) => {
          settings.set('matchClock', next)
          // Apply now rather than on the next launch: switching it on in the
          // evening should bring the evening with it.
          if (next && night !== eveningNow()) toggleNight()
        }}
      />
      <Toggle
        label="Rain"
        hint="K does this in the room. You hear it too — quieter indoors, louder by a window."
        on={rain}
        testId="toggle-rain"
        onChange={() => toggleRain()}
      />

      <p className="controls-heading">This Library</p>
      <p className="path" data-testid="library-root">
        {!rootLoaded ? 'Checking…' : (libraryRoot ?? 'Not chosen yet')}
      </p>
      <p className="note" data-testid="world-file">
        The room: {savePaths?.world ?? 'checking…'} — edit that file and it reloads as you save it
      </p>
      <p className="note" data-testid="annotations-file">
        Bookmarks and notes: {savePaths?.annotations ?? 'checking…'} — plain JSON with page
        numbers, yours to read
      </p>
      <div className="row-controls">
        <button onClick={() => void pickRoot()} disabled={!library.canPickFolder}>
          Choose Folder…
        </button>
        <button
          onClick={() => void scan()}
          disabled={!library.canIndex || scanning || !libraryRoot}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
        <button
          data-testid="export-annotations"
          onClick={() => void exportAnnotations()}
          disabled={annotatedBooks === 0}
          title="A Markdown digest of every bookmark and note, by book"
        >
          Export Annotations
        </button>
      </div>
      {exported && (
        <p className="note" data-testid="export-result">
          {exported}
        </p>
      )}
      {!scanning && lastScan && (
        <p className="note">
          {lastScan.added} new · {lastScan.unchanged} unchanged · {lastScan.removed} gone
          {lastScan.failed > 0 && ` · ${lastScan.failed} unreadable`}
        </p>
      )}
      <Toggle
        label="One Box per Folder"
        hint="New books arrive boxed by their folder under books/, instead of spread evenly."
        on={settings.boxPerFolder}
        testId="box-per-folder"
        onChange={(next) => {
          settings.set('boxPerFolder', next)
          // Any books still unplaced re-deal into the boxes under the new rule
          // straight away, rather than on the next scan.
          useLibraryStore.getState().rebuild()
        }}
      />

      {/* Buttons rather than keys: each moves the whole library at once. */}
      <div className="row-controls">
        <button
          data-testid="pack-everything"
          disabled={shelved === 0}
          onClick={() => packEverything()}
          title="Every book off every shelf and back into the boxes"
        >
          Clear the Shelves
        </button>
        <button
          data-testid="pack-strays"
          disabled={strayCount === 0}
          onClick={() => packLooseBooks()}
          title="Every book lying on a floor, into the nearest box — books left on tables stay put"
        >
          Box the Strays{strayCount > 0 ? ` (${strayCount})` : ''}
        </button>
      </div>

      {library.kind === 'http' && (
        <p className="note">
          Hosted mode: this is the folder mounted into the container. Choosing another one would
          mean letting the browser walk the server&rsquo;s disk, so the button is off rather than
          broken. Mount a different folder to read a different library.
        </p>
      )}
      {!library.canIndex && (
        <p className="note warn">
          Browser mode shows a generated stand-in library. Run <code>npm run tauri:dev</code> to
          index your own files.
        </p>
      )}

      <p className="controls-heading">The Renderer</p>
      <dl>
        <dt>FPS</dt>
        <dd>
          {render.fps.toFixed(0)} <span className="dim">min {render.fpsMin.toFixed(0)}</span>
        </dd>
        <dt>Draw Calls</dt>
        <dd>{render.drawCalls}</dd>
        <dt>Triangles</dt>
        <dd>{render.triangles.toLocaleString()}</dd>
        {/* Only the stand-in driver is a warning; the container is a shipped mode. */}
        <dt>Running As</dt>
        <dd className={driver === 'browser' ? 'warn' : 'ok'}>
          {DRIVER_LABELS[driver]} <span className="dim">({driver})</span>
        </dd>
      </dl>

      <div className="row-controls settings-foot">
        <button onClick={() => settings.reset()}>Reset Settings</button>
        <button onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  )
}
