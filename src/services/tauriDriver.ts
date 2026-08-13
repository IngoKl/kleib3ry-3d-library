import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
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
 * One persistent subscription with a swappable callback, rather than a listen
 * per scan: `listen` resolves asynchronously, and a scan started before the
 * subscription landed lost its first progress events — on a small library, all
 * of them. `scan` awaits the registration instead.
 */
let scanCallback: ((progress: ScanProgress) => void) | null = null
let scanSubscription: Promise<unknown> | null = null

/** Desktop driver: native filesystem access through the Rust core. */
export const tauriDriver: LibraryService = {
  kind: 'tauri',
  canPickFolder: true,
  canIndex: true,

  async getRoot() {
    return invoke<string | null>('get_library_root')
  },

  async setRoot(path) {
    await invoke('set_library_root', { path })
  },

  async pickRoot() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: 'Choose the folder that holds your books',
    })
    if (typeof picked !== 'string') return null
    await invoke('set_library_root', { path: picked })
    return picked
  },

  async scan() {
    // Progress events emitted before the listener registration settles would
    // be dropped; the registration is cheap and the scan is not, so wait.
    await scanSubscription
    return invoke<ScanSummary>('scan_library')
  },

  onScanProgress(listener) {
    scanCallback = listener
    scanSubscription ??= listen<ScanProgress>('scan:progress', (event) =>
      scanCallback?.(event.payload),
    )
    return () => {
      if (scanCallback === listener) scanCallback = null
    }
  },

  async listBooks() {
    return invoke<IndexedBook[]>('list_books')
  },

  async readBook(id) {
    // The Rust side answers with a raw binary response, so a large PDF does not
    // go through JSON on the way here.
    const bytes = await invoke<ArrayBuffer | number[]>('read_book_file', { id })
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes)
  },

  async saveRenderedCover(id, dataUrl) {
    return invoke<string>('save_rendered_cover', { id, dataUrl })
  },

  async loadWorld() {
    return invoke<string | null>('get_world')
  },

  async writeDefaultWorld(text) {
    return invoke<boolean>('write_default_world', { text })
  },

  async worldStamp() {
    return invoke<string | null>('world_stamp')
  },

  async savePaths() {
    return invoke<SavePaths>('save_paths')
  },

  async loadLayout() {
    return invoke<LayoutDocument | null>('get_layout')
  },

  async saveLayout(layout) {
    await invoke('save_layout', { layout })
  },

  async listTracks() {
    return invoke<IndexedTrack[]>('list_music')
  },

  async listArtwork() {
    return invoke<IndexedArtwork[]>('list_artwork')
  },

  async listTapes() {
    return invoke<IndexedTape[]>('list_videos')
  },

  async listRoms() {
    return invoke<IndexedRom[]>('list_roms')
  },

  async readRom(id) {
    // The same raw binary channel `readBook` uses, and the same transport
    // wrinkle: an ArrayBuffer on the real IPC bridge, a number array elsewhere.
    const bytes = await invoke<ArrayBuffer | number[]>('read_rom_file', { id })
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes)
  },

  async loadAmbience() {
    return invoke<AmbienceState | null>('get_ambience')
  },

  async saveAmbience(state) {
    await invoke('save_ambience', { state })
  },

  async loadAnnotations() {
    return invoke<AnnotationsDocument | null>('get_annotations')
  },

  async saveAnnotations(doc) {
    await invoke('save_annotations', { doc })
  },

  async exportAnnotationsMarkdown(markdown) {
    return invoke<string>('export_annotations', { markdown })
  },

  assetUrl(path) {
    return convertFileSrc(path)
  },
}
