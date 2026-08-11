import { useEffect, useMemo, useState } from 'react'
import { library } from '../services'
import { metrics, type RenderMetrics } from '../state/metrics'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { useSettings } from '../state/settings'
import { floorAt, supportAt } from '../world/derive'

/**
 * Settings.
 *
 * Everything that used to live down the right-hand side of the screen. The
 * reason for moving it is not tidiness: a panel that is always open is a panel
 * you are always reading past, and the room is the point. A switch you touch
 * once a month belongs behind a key.
 *
 * The sections are ordered by how often anybody opens them for that reason —
 * display first, because "the room is stuttering" is the one thing somebody
 * comes here to fix; the library folder last, because by the time you are in a
 * room you have already chosen it.
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
        {on ? 'on' : 'off'}
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
  /**
   * The renderer's numbers, on a poll.
   *
   * They live here rather than in the HUD because a permanent frame counter over
   * the room is a development tool wearing an interface's clothes — and because
   * the one moment anybody wants them is the moment they have opened this panel
   * to look for low performance mode.
   */
  const [render, setRender] = useState<RenderMetrics>({ ...metrics })
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setRender({ ...metrics }), 250)
    return () => clearInterval(id)
  }, [open])

  /**
   * Give the mouse back.
   *
   * A panel full of buttons and sliders opened while the pointer is captured is
   * a panel you cannot touch — the same reason the note field and the catalogue
   * release it. Nothing takes the lock back: clicking the room does that, which
   * is the gesture that already means "I am in there again".
   */
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
  const night = useLightStore((s) => s.night)
  const toggleNight = useLightStore((s) => s.toggleNight)
  const rain = useLightStore((s) => s.rain)
  const toggleRain = useLightStore((s) => s.toggleRain)

  const scanning = useLibraryStore((s) => s.scanning)
  const scan = useLibraryStore((s) => s.scan)
  const lastScan = useLibraryStore((s) => s.lastScan)
  const shelved = useLibraryStore((s) => s.packed.length)
  const packEverything = useLibraryStore((s) => s.packEverything)
  const packLooseBooks = useLibraryStore((s) => s.packLooseBooks)
  const loose = useLibraryStore((s) => s.loose)
  const world = useWorldStore((s) => s.world)
  const savePaths = useWorldStore((s) => s.paths)

  const tracks = useMediaStore((s) => s.tracks)
  const musicError = useMediaStore((s) => s.error)
  const tapes = useVideoStore((s) => s.tapes)
  const videoError = useVideoStore((s) => s.error)

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

  if (!open) return null

  return (
    <div className="settings-card" data-testid="settings-card">
      <div className="settings-head">
        <p className="field-label">settings</p>
        <button onClick={() => setOpen(false)}>
          close <kbd>F2</kbd>
        </button>
      </div>

      <p className="controls-heading">display</p>
      <Toggle
        label="low performance mode"
        hint="No shadows, no window light, one pixel per pixel. For an older machine."
        on={settings.lowPerformance}
        testId="low-performance"
        onChange={(next) => settings.set('lowPerformance', next)}
      />
      <Toggle
        label="show my body"
        hint="Look down and see your own legs."
        on={settings.showBody}
        testId="show-body"
        onChange={(next) => settings.set('showBody', next)}
      />
      <Toggle
        label="interface"
        hint="The cards and the status strip. H does this too."
        on={!hudHidden}
        onChange={() => toggleHud()}
      />
      <Slider
        label="mouse sensitivity"
        value={settings.sensitivity}
        min={0.2}
        max={3}
        step={0.05}
        format={(value) => `${value.toFixed(2)}x`}
        onChange={(next) => settings.set('sensitivity', next)}
      />

      <p className="controls-heading">sound</p>
      <Slider
        label="volume"
        value={settings.volume}
        min={0}
        max={1}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(next) => settings.set('volume', next)}
      />
      <Toggle
        label="sound in the room"
        hint="The deck and the television get quieter as you walk away, and come from where they stand."
        on={settings.positionalAudio}
        testId="positional-audio"
        onChange={(next) => settings.set('positionalAudio', next)}
      />
      <p className="note">
        {tracks.length === 0 ? 'nothing in music/ yet' : `${tracks.length} records`} ·{' '}
        {tapes.length === 0 ? 'nothing in video/ yet' : `${tapes.length} tapes`}
      </p>
      {musicError && <p className="note warn">{musicError}</p>}
      {videoError && <p className="note warn">{videoError}</p>}

      <p className="controls-heading">outside</p>
      <Toggle
        label="night"
        hint="N does this in the room."
        on={night}
        testId="toggle-night"
        onChange={() => toggleNight()}
      />
      <Toggle
        label="rain"
        hint="K does this in the room."
        on={rain}
        testId="toggle-rain"
        onChange={() => toggleRain()}
      />

      <p className="controls-heading">this library</p>
      <p className="path" data-testid="library-root">
        {!rootLoaded ? 'checking…' : (libraryRoot ?? 'not chosen yet')}
      </p>
      <p className="note" data-testid="world-file">
        the room: {savePaths?.world ?? 'checking…'} — edit that file and it reloads as you save it
      </p>
      <div className="row-controls">
        <button onClick={() => void pickRoot()} disabled={!library.canPickFolder}>
          choose folder…
        </button>
        <button
          onClick={() => void scan()}
          disabled={!library.canIndex || scanning || !libraryRoot}
        >
          {scanning ? 'scanning…' : 'scan'}
        </button>
      </div>
      {!scanning && lastScan && (
        <p className="note">
          {lastScan.added} new · {lastScan.unchanged} unchanged · {lastScan.removed} gone
          {lastScan.failed > 0 && ` · ${lastScan.failed} unreadable`}
        </p>
      )}

      {/* The way back from an arrangement you have decided against. Buttons
          rather than keys because each moves the whole library at once, and
          they say how many rather than asking twice. */}
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

      {!library.canIndex && (
        <p className="note warn">
          Browser mode shows a generated stand-in library. Run <code>npm run tauri:dev</code> to
          index your own files.
        </p>
      )}

      <p className="controls-heading">the renderer</p>
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

      <div className="row-controls settings-foot">
        <button onClick={() => settings.reset()}>reset settings</button>
        <button onClick={() => setOpen(false)}>done</button>
      </div>
    </div>
  )
}
