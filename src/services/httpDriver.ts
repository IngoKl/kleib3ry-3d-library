import type {
  AnnotationsDocument,
  IndexedArtwork,
  IndexedBook,
  IndexedRom,
  IndexedTape,
  IndexedTrack,
  LayoutDocument,
  LibraryService,
  AmbienceState,
  SavePaths,
  ScanProgress,
  ScanSummary,
} from './types'

/**
 * The same library over HTTP, from a container. Every method is one request
 * against `server/src/main.rs`, in the same order, and nothing above
 * `src/services/` changed to gain it.
 *
 * Two real differences from the desktop: `canPickFolder` is false, because the
 * folder is whatever was mounted and a picker would walk the server's disk; and
 * scan progress is polled, because a websocket for one number would be a second
 * protocol to keep working.
 */

/** Same-origin, because the server serves the front end it talks to. */
const API = '/api'

/** How often to ask how a scan is getting on. */
const PROGRESS_MS = 250

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init)
  if (!response.ok) {
    // The server puts its reason in the body as plain text, which is what the
    // HUD's error line wants.
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

/** A GET that treats 404 as "there is no such document yet", not as a failure. */
async function optional<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

async function send(path: string, method: string, body: BodyInit, type: string): Promise<void> {
  // A plain fetch is aborted at unload, losing whatever the debounce still
  // held. `keepalive` outlives the page but is refused over 64 KB, so a large
  // layout falls back to a best-effort fetch rather than failing every save.
  const keepalive = typeof body === 'string' && body.length < 60_000
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': type },
    body,
    keepalive,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `${response.status} ${response.statusText}`)
  }
}

let progressCallback: ((progress: ScanProgress) => void) | null = null
let poller: ReturnType<typeof setInterval> | undefined
/**
 * The poller starts before the POST that begins the scan, so the first tick can
 * land while the server is still between accepting and marking itself busy.
 * Without this, that tick reads "not running" and the poller switches off.
 */
let seenRunning = false

/**
 * Started by `scan` rather than by `onScanProgress`, so an idle library makes no
 * requests: the subscription is a place to put the callback, not a reason to poll.
 */
function watchProgress() {
  clearInterval(poller)
  seenRunning = false
  poller = setInterval(() => {
    void fetch(`${API}/scan/progress`)
      .then((response) => (response.ok ? response.json() : null))
      .then((update: (ScanProgress & { running: boolean }) | null) => {
        if (!update) return
        if (update.running) seenRunning = true
        if (update.total > 0) {
          progressCallback?.({
            done: update.done,
            total: update.total,
            current: update.current,
          })
        }
        // Only once it has been running: "not running" before the scan has
        // started is the server not having got to the POST yet, not the end.
        if (seenRunning && !update.running) {
          clearInterval(poller)
          poller = undefined
        }
      })
      // A dropped poll is not worth failing a scan over; the next one is 250 ms
      // away and the scan's own result is what actually reports the outcome.
      .catch(() => {})
  }, PROGRESS_MS)
}

export const httpDriver: LibraryService = {
  kind: 'http',
  canPickFolder: false,
  canIndex: true,
  canFetchPapers: true,

  async getRoot() {
    const { root } = await ask<{ root: string | null }>('/root')
    return root
  },

  async setRoot() {
    // The mount is the library. Changing it means changing the `docker run`
    // line, which is the honest answer rather than a setting that cannot work.
    throw new Error('the library folder is whatever was mounted into the container')
  },

  async pickRoot() {
    return null
  },

  async scan() {
    watchProgress()
    try {
      return await ask<ScanSummary>('/scan', { method: 'POST' })
    } finally {
      // Stop polling even if the scan failed, or a failed scan leaves a request
      // every quarter second going forever.
      clearInterval(poller)
      poller = undefined
    }
  },

  onScanProgress(listener) {
    progressCallback = listener
    return () => {
      if (progressCallback === listener) progressCallback = null
    }
  },

  async listBooks() {
    return ask<IndexedBook[]>('/books')
  },

  async readBook(id) {
    const response = await fetch(`${API}/book/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`cannot read ${id}: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },

  async saveRenderedCover(id, dataUrl) {
    const { path } = await ask<{ path: string }>(`/cover/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: dataUrl,
    })
    return path
  },

  async fetchPaper(id) {
    // The failure that matters carries a message — a bad id, or one arXiv has
    // nothing under — so the body is thrown rather than the status code.
    const response = await fetch(`${API}/paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: id,
    })
    if (!response.ok) throw new Error((await response.text()).trim() || `${response.status}`)
    return (await response.json()) as IndexedBook
  },

  async loadWorld() {
    const response = await fetch(`${API}/world`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    // Text, not JSON: the document is hand-edited and its comments have to
    // survive the round trip.
    return response.text()
  },

  async writeDefaultWorld(text) {
    const { written } = await ask<{ written: boolean }>('/world', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    })
    return written
  },

  async worldStamp() {
    const { stamp } = await ask<{ stamp: string | null }>('/world/stamp')
    return stamp
  },

  async savePaths() {
    return ask<SavePaths>('/paths')
  },

  async loadLayout() {
    return optional<LayoutDocument>('/layout')
  },

  async saveLayout(layout) {
    await send('/layout', 'PUT', JSON.stringify(layout), 'application/json')
  },

  async listTracks() {
    return ask<IndexedTrack[]>('/music')
  },

  async listArtwork() {
    return ask<IndexedArtwork[]>('/artwork')
  },

  async listTapes() {
    return ask<IndexedTape[]>('/video')
  },

  async listRoms() {
    return ask<IndexedRom[]>('/roms')
  },

  async readRom(id) {
    const response = await fetch(`${API}/rom/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`cannot read ${id}: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },

  async loadAmbience() {
    return optional<AmbienceState>('/ambience')
  },

  async saveAmbience(state) {
    await send('/ambience', 'PUT', JSON.stringify(state), 'application/json')
  },

  async loadAnnotations() {
    return optional<AnnotationsDocument>('/annotations')
  },

  async saveAnnotations(doc) {
    await send('/annotations', 'PUT', JSON.stringify(doc), 'application/json')
  },

  // No filesystem on this side of the wire: the settings card offers the
  // digest as a download instead.
  async exportAnnotationsMarkdown() {
    return null
  },

  /**
   * An absolute server-side path becomes a URL under `/media/`. The index hands
   * out the same absolute paths the desktop gives Tauri's asset protocol, so
   * they pass through rather than gaining a second naming scheme; the server
   * checks each against `is_allowed` before opening anything.
   *
   * Encoded per segment, or a `#` or `?` in a filename — which `encodeURI`
   * leaves bare — reads as a fragment or a query.
   */
  assetUrl(path) {
    return `/media/${path
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`
  },
}
