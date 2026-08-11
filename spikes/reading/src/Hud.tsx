import { useEffect, useState } from 'react'
import * as THREE from 'three'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { initialMetrics, type Metrics, type Settings } from './types'

type Props = {
  metrics: React.RefObject<Metrics>
  settings: Settings
  setSettings: React.Dispatch<React.SetStateAction<Settings>>
  spread: number
  doc: PDFDocumentProxy | null
  source: string
  error: string | null
  maxAnisotropy: number
  onTurn: (dir: 1 | -1) => void
  onDock: () => void
  onFile: (file: File | undefined) => void
}

const SUPERSAMPLE = [1, 1.5, 2, 3]
const DPR = [1, 1.5, 2]
const TILT_DEG = [0, 18, 35, 55]

export function Hud({
  metrics,
  settings,
  setSettings,
  spread,
  doc,
  source,
  error,
  maxAnisotropy,
  onTurn,
  onDock,
  onFile,
}: Props) {
  const [snapshot, setSnapshot] = useState<Metrics>(initialMetrics())
  useEffect(() => {
    const id = setInterval(() => setSnapshot({ ...metrics.current }), 250)
    return () => clearInterval(id)
  }, [metrics])

  const verdictClass =
    snapshot.pageDevicePx >= 900 ? 'ok' : snapshot.pageDevicePx >= 650 ? 'warn' : 'bad'

  return (
    <>
      <div className="panel panel-left">
        <h1>3D reading spike</h1>
        <p className="source">{error ? <span className="bad">{error}</span> : source}</p>

        <dl>
          <dt>fps</dt>
          <dd className={snapshot.fpsMin >= 58 ? 'ok' : snapshot.fpsMin >= 45 ? 'warn' : 'bad'}>
            {snapshot.fps.toFixed(0)} <span className="dim">(min {snapshot.fpsMin.toFixed(0)})</span>
          </dd>

          <dt>page on screen</dt>
          <dd className={verdictClass}>
            {snapshot.pageDevicePx.toFixed(0)} px
            <span className="dim"> device / {snapshot.pageCssPx.toFixed(0)} css</span>
          </dd>

          <dt>page texture</dt>
          <dd>
            {snapshot.actualTexturePx.toFixed(0)} px
            <span className="dim"> (want {snapshot.targetTexturePx})</span>
          </dd>

          <dt>texel ratio</dt>
          <dd className={snapshot.texelRatio >= 1.8 ? 'ok' : snapshot.texelRatio >= 1 ? 'warn' : 'bad'}>
            {snapshot.texelRatio.toFixed(2)}×
          </dd>

          <dt>texture memory</dt>
          <dd>{snapshot.textureMB.toFixed(0)} MB</dd>

          <dt>max anisotropy</dt>
          <dd>{maxAnisotropy}×</dd>

          <dt>spread</dt>
          <dd>
            pages {2 * spread}–{2 * spread + 1} of {doc?.numPages ?? '—'}
          </dd>
        </dl>

        <p className="note">
          Legibility is capped by <em>page on screen</em>, not texture size: ~1080 device px of page
          height is roughly parity with a real e-reader.
        </p>
      </div>

      <div className="panel panel-right">
        <Row label="supersample">
          {SUPERSAMPLE.map((v) => (
            <button
              key={v}
              className={settings.supersample === v ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, supersample: v }))}
            >
              {v}×
            </button>
          ))}
        </Row>

        <Row label="device pixel ratio">
          {DPR.map((v) => (
            <button
              key={v}
              className={settings.dpr === v ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, dpr: v }))}
            >
              {v}×
            </button>
          ))}
        </Row>

        <Row label="book tilt">
          {TILT_DEG.map((deg) => (
            <button
              key={deg}
              className={Math.round(THREE.MathUtils.radToDeg(settings.tiltRad)) === deg ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, tiltRad: THREE.MathUtils.degToRad(deg) }))}
            >
              {deg}°
            </button>
          ))}
        </Row>

        <Row label="filtering">
          <button
            className={settings.anisotropy ? 'on' : ''}
            onClick={() => setSettings((s) => ({ ...s, anisotropy: !s.anisotropy }))}
          >
            aniso
          </button>
          <button
            className={settings.mipmaps ? 'on' : ''}
            onClick={() => setSettings((s) => ({ ...s, mipmaps: !s.mipmaps }))}
          >
            mips
          </button>
          <button
            className={settings.shadows ? 'on' : ''}
            onClick={() => setSettings((s) => ({ ...s, shadows: !s.shadows }))}
          >
            shadows
          </button>
        </Row>

        <Row label="pages">
          <button onClick={() => onTurn(-1)}>◀ back</button>
          <button onClick={() => onTurn(1)}>forward ▶</button>
          <button onClick={onDock}>dock camera</button>
        </Row>

        <Row label="own pdf">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
          />
        </Row>

        <p className="note">← → turn · d dock · drag to orbit · scroll to zoom</p>
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-controls">{children}</div>
    </div>
  )
}
