import { isTauri } from '@tauri-apps/api/core'
import { browserDriver } from './browserDriver'
import { tauriDriver } from './tauriDriver'
import type { LibraryService } from './types'

/**
 * The active driver, chosen once at startup. `isTauri()` checks for the
 * injected IPC bridge, so the same bundle runs in the desktop shell and in a
 * plain browser tab.
 */
export const library: LibraryService = isTauri() ? tauriDriver : browserDriver

export type { LibraryService } from './types'
export { UnsupportedOperation } from './types'
