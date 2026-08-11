import { isTauri } from '@tauri-apps/api/core'
import { browserDriver } from './browserDriver'
import { httpDriver } from './httpDriver'
import { tauriDriver } from './tauriDriver'
import type { DriverKind, LibraryService } from './types'

/**
 * The active driver, chosen once at startup.
 *
 * `isTauri()` checks for the injected IPC bridge, so the same bundle runs in the
 * desktop shell and in a plain browser tab. The third case cannot be detected
 * that way — a container's bundle is served by a plain HTTP server and looks
 * exactly like a static one — so it is chosen at *build* time instead:
 *
 *     npm run build:http      # bundle for the server, via .env.http
 *     npm run dev:http        # the same, against a server on :8080
 *
 * A runtime probe would be nicer to describe and worse to live with: `library`
 * is read synchronously the moment the store is created, so a probe would mean
 * an await before the app can start, and a container whose server was slow to
 * answer would come up as an empty stand-in library. A flag cannot be wrong
 * about which thing it is.
 */
const wanted = import.meta.env.VITE_DRIVER

export const library: LibraryService = isTauri()
  ? tauriDriver
  : wanted === 'http'
    ? httpDriver
    : browserDriver

/**
 * What each driver *is*, in the words [docs/modes.md](../../docs/modes.md) uses.
 *
 * Two of these are shipped ways to run kleib3ry and the third is not, which a
 * bare `kind` cannot say. `http` reads as "container" everywhere a person sees
 * it because that is what running it hosted means — the transport is an
 * implementation detail of the mode, not the name of it. Here rather than in
 * either card so the menu and the settings panel cannot come to disagree.
 */
export const DRIVER_LABELS: Record<DriverKind, string> = {
  tauri: 'Desktop App',
  http: 'Container',
  browser: 'Stand-in — no filesystem',
}

export type { DriverKind, LibraryService } from './types'
export { UnsupportedOperation } from './types'
