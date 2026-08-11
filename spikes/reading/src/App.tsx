import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Book, PAGE_HEIGHT, type BookApi } from './Book'
import { PageTextureCache, loadDocument } from './pdf'
import { initialMetrics, type Metrics, type Settings } from './types'
import { Hud } from './Hud'

const DEFAULTS: Settings = {
  supersample: 2,
  anisotropy: true,
  mipmaps: true,
  shadows: true,
  tiltRad: THREE.MathUtils.degToRad(18),
  dpr: Math.min(2, window.devicePixelRatio || 1),
  textureBudgetMB: 400,
}

const FOV = 45

/** Distance at which an open spread just fills the viewport. */
function dockDistance(pageWidth: number, viewAspect: number) {
  const vfov = THREE.MathUtils.degToRad(FOV)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * viewAspect)
  const byHeight = PAGE_HEIGHT / 2 / Math.tan(vfov / 2)
  const byWidth = pageWidth / Math.tan(hfov / 2)
  return Math.max(byHeight, byWidth) * 1.04
}

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [aspect, setAspect] = useState(612 / 792)
  const [spread, setSpread] = useState(0)
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState('sample.pdf')

  const metrics = useRef<Metrics>(initialMetrics())
  const api = useRef<BookApi | null>(null)
  const cacheRef = useRef<PageTextureCache | null>(null)
  const [cache, setCache] = useState<PageTextureCache | null>(null)
  const dockRef = useRef<(() => void) | null>(null)

  const open = useCallback(async (src: string | ArrayBuffer, label: string) => {
    try {
      setError(null)
      const next = await loadDocument(src)
      const page = await next.getPage(1)
      const view = page.getViewport({ scale: 1 })
      cacheRef.current?.disposeAll()
      setAspect(view.width / view.height)
      setSpread(0)
      setDoc(next)
      setSource(`${label} — ${next.numPages} pages`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void open('/sample.pdf', 'sample.pdf')
  }, [open])

  useEffect(() => {
    cache?.applyFilterSettings(settings.anisotropy, settings.mipmaps)
  }, [cache, settings.anisotropy, settings.mipmaps])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') api.current?.turn(1)
      if (e.key === 'ArrowLeft') api.current?.turn(-1)
      if (e.key === 'd') dockRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Verification surface for headless/driven checks.
  useEffect(() => {
    const spike = {
      metrics: () => ({ ...metrics.current, spread, source }),
      settings: () => settings,
      set: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
      turn: (dir: 1 | -1) => api.current?.turn(dir),
      pose: (dir: 1 | -1, progress: number | null) => api.current?.pose(dir, progress),
      dock: () => dockRef.current?.(),
      ready: () => doc !== null && metrics.current.actualTexturePx > 0,
      /** Flip back and forth for `seconds`, reporting the frame-rate floor. */
      stress: (seconds = 6) =>
        new Promise<{ avg: number; min: number; frames: number }>((resolve) => {
          const samples: number[] = []
          let dir: 1 | -1 = 1
          const started = performance.now()
          const tick = () => {
            samples.push(metrics.current.fps)
            if (!api.current?.isTurning()) {
              api.current?.turn(dir)
              dir = dir === 1 ? -1 : 1
            }
            if (performance.now() - started < seconds * 1000) {
              requestAnimationFrame(tick)
            } else {
              const valid = samples.filter((n) => n > 0)
              resolve({
                avg: valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length),
                min: Math.min(...valid),
                frames: valid.length,
              })
            }
          }
          requestAnimationFrame(tick)
        }),
    }
    ;(window as unknown as { __spike: typeof spike }).__spike = spike
  }, [doc, settings, spread, source])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    await open(await file.arrayBuffer(), file.name)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void onFile(e.dataTransfer.files?.[0])
      }}
    >
      <Canvas
        dpr={settings.dpr}
        shadows={settings.shadows}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: FOV, near: 0.01, far: 50, position: [0, 0.1, 0.32] }}
      >
        <color attach="background" args={['#15120f']} />
        <Scene
          doc={doc}
          aspect={aspect}
          cache={cache}
          setCache={(c) => {
            cacheRef.current = c
            setCache(c)
          }}
          settings={settings}
          spread={spread}
          setSpread={setSpread}
          metrics={metrics}
          api={api}
          dockRef={dockRef}
        />
      </Canvas>

      <Hud
        metrics={metrics}
        settings={settings}
        setSettings={setSettings}
        spread={spread}
        doc={doc}
        source={source}
        error={error}
        maxAnisotropy={cache?.maxAnisotropy ?? 0}
        onTurn={(d) => api.current?.turn(d)}
        onDock={() => dockRef.current?.()}
        onFile={onFile}
      />
    </div>
  )
}

type SceneProps = {
  doc: PDFDocumentProxy | null
  aspect: number
  cache: PageTextureCache | null
  setCache: (c: PageTextureCache) => void
  settings: Settings
  spread: number
  setSpread: (n: number) => void
  metrics: React.RefObject<Metrics>
  api: React.RefObject<BookApi | null>
  dockRef: React.RefObject<(() => void) | null>
}

function Scene({
  doc,
  aspect,
  cache,
  setCache,
  settings,
  spread,
  setSpread,
  metrics,
  api,
  dockRef,
}: SceneProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useRef<React.ComponentRef<typeof OrbitControls> | null>(null)

  useEffect(() => {
    if (!cache) setCache(new PageTextureCache(gl))
  }, [gl, cache, setCache])

  // Read live values through a ref so docking stays a stable, explicit action:
  // changing the tilt must leave the camera where it is, otherwise the view is
  // always perpendicular and the oblique-angle case can never be tested.
  const live = useRef({ aspect, tilt: settings.tiltRad, w: size.width, h: size.height })
  live.current = { aspect, tilt: settings.tiltRad, w: size.width, h: size.height }

  const dock = useCallback(() => {
    const { aspect: a, tilt, w, h } = live.current
    const d = dockDistance(PAGE_HEIGHT * a, w / h)
    camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt))
    camera.lookAt(0, 0, 0)
    controls.current?.target.set(0, 0, 0)
    controls.current?.update()
  }, [camera])

  useEffect(() => {
    dockRef.current = dock
  }, [dock, dockRef])

  // Dock once the document's true aspect is known.
  useEffect(() => {
    if (doc) dock()
  }, [doc, dock])

  return (
    <>
      <FpsProbe metrics={metrics} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#fff3e0', '#2b2118', 0.5]} />
      <directionalLight
        position={[0.55, 0.9, 0.7]}
        intensity={2.1}
        castShadow={settings.shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-0.4}
        shadow-camera-right={0.4}
        shadow-camera-top={0.4}
        shadow-camera-bottom={-0.4}
        shadow-camera-near={0.05}
        shadow-camera-far={3}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-0.8, 0.3, 0.4]} intensity={0.45} />

      {cache && (
        <Book
          doc={doc}
          aspect={aspect}
          cache={cache}
          settings={settings}
          spread={spread}
          onSpread={setSpread}
          metrics={metrics}
          api={api}
        />
      )}

      {/* desk, for context and to receive the book's shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.135, 0]} receiveShadow>
        <planeGeometry args={[3, 3]} />
        <meshStandardMaterial color="#3a2b20" roughness={0.85} />
      </mesh>

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={0.08}
        maxDistance={2}
      />
    </>
  )
}

function FpsProbe({ metrics }: { metrics: React.RefObject<Metrics> }) {
  const acc = useRef({ frames: 0, elapsed: 0, window: [] as number[] })
  useFrame((_, delta) => {
    const a = acc.current
    a.frames += 1
    a.elapsed += delta
    if (a.elapsed >= 0.25) {
      const fps = a.frames / a.elapsed
      metrics.current.fps = fps
      a.window.push(fps)
      if (a.window.length > 20) a.window.shift()
      metrics.current.fpsMin = Math.min(...a.window)
      a.frames = 0
      a.elapsed = 0
    }
  })
  return null
}
