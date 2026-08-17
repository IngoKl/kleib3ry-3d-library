import { isTauri } from '@tauri-apps/api/core'
import { browserDriver } from './browserDriver'
import { httpDriver } from './httpDriver'
import { tauriDriver } from './tauriDriver'
import type { DriverKind, LibraryService } from './types'

/**
 * The active driver, chosen once at startup. `isTauri()` checks for the injected
 * IPC bridge; http and browser are indistinguishable at runtime, so http is
 * selected at build time via `VITE_DRIVER=http`.
 *
 * Not a runtime probe: `library` is read synchronously when the first store is
 * created, and a slow server would come up as an empty stand-in library.
 */
const wanted = import.meta.env.VITE_DRIVER

export const library: LibraryService = isTauri()
  ? tauriDriver
  : wanted === 'http'
    ? httpDriver
    : browserDriver

/**
 * What each driver is called in the UI, in `docs/modes.md`'s words — `http`
 * reads as "Container" because that is the mode, not the transport. Here so the
 * menu and the settings panel cannot disagree.
 */
export const DRIVER_LABELS: Record<DriverKind, string> = {
  tauri: 'Desktop App',
  http: 'Container',
  browser: 'Stand-in — no filesystem',
}

export type { DriverKind, LibraryService } from './types'
export { UnsupportedOperation } from './types'
