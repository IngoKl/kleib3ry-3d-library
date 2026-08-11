import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  IndexedBook,
  LayoutDocument,
  LibraryService,
  SavePaths,
  ScanProgress,
  ScanSummary,
} from './types'

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
    return invoke<ScanSummary>('scan_library')
  },

  onScanProgress(listener) {
    // `listen` resolves to the unlisten function; callers get a synchronous
    // teardown that waits for the subscription before removing it.
    const pending = listen<ScanProgress>('scan:progress', (event) => listener(event.payload))
    return () => {
      void pending.then((unlisten) => unlisten())
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

  assetUrl(path) {
    return convertFileSrc(path)
  },
}
