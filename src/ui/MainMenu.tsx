import { useEffect, useState } from 'react'
import { library } from '../services'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useAnnotationsStore } from '../state/annotations'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useArcadeStore } from '../state/arcade'
import { useWorldStore } from '../state/world'
import { forgetCovers, warmCovers } from '../state/covers'
import { teleport } from '../state/player'
import { forgetLibrary, recentLibraries, rememberLibrary } from '../state/settings'
import { ScanStatus } from './ScanStatus'

/** A touch over the CSS fade, so the last frame painted is already transparent. */
const LEAVE_MS = 340

/**
 * Which library, and then in. The room loads behind this so going in is instant,
 * at the cost of one rule in `roomHasKeyboard`: while the menu is up nothing
 * reaches the room. The recent list is per-machine, because a list of other
 * libraries must not travel inside one of them.
 */
export function MainMenu() {
  const started = useAppStore((s) => s.started)
  const start = useAppStore((s) => s.start)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const libraryRoot = useAppStore((s) => s.libraryRoot)
  const rootLoaded = useAppStore((s) => s.rootLoaded)

  const worldName = useWorldStore((s) => s.world?.doc.name ?? null)
  const worldLoaded = useWorldStore((s) => s.loaded)
  const worldError = useWorldStore((s) => s.error)
  const books = useLibraryStore((s) => s.books.length)
  const libraryLoaded = useLibraryStore((s) => s.loaded)
  const libraryError = useLibraryStore((s) => s.error)

  const [recent, setRecent] = useState<string[]>(() => recentLibraries())
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  // Only where the driver can open one: remembering the container's mounted
  // path fills the list with entries no driver can act on.
  useEffect(() => {
    if (!started || !libraryRoot || !library.canPickFolder) return
    rememberLibrary(libraryRoot)
  }, [started, libraryRoot])

  // A timeout unmounts, not `transitionend`: the tests wait for the menu to be
  // gone, and a transition event never fires where nothing paints.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!started) {
      setGone(false)
      return
    }
    // The button keeps DOM focus through the fade and `pointer-events: none`
    // does nothing for the keyboard, so Space would fire it again.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const timer = window.setTimeout(() => setGone(true), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [started])

  if (gone) return null

  const ready = rootLoaded && worldLoaded && libraryLoaded

  /** The world goes first, or there are no shelves to reconcile against. */
  const openFolder = async (path: string | null) => {
    const chosen = path ?? (await library.pickRoot().catch(() => null))
    if (!chosen) return
    setOpening(chosen)
    setOpenError(null)
    // Keyed by content hash, so the last library's artwork would not be wrong —
    // only megabytes about books no longer on any shelf.
    if (chosen !== libraryRoot) forgetCovers()
    try {
      await library.setRoot(chosen)
      useAppStore.setState({ libraryRoot: chosen })
      await useWorldStore.getState().load()
      await useLibraryStore.getState().load()
      // Everything else that hangs off the folder, all of it that library's:
      // without this you stand in the new rooms with the old library's music on
      // the shelf, and the first bookmark writes its marginalia over the file.
      await Promise.all([
        useAnnotationsStore.getState().load(),
        useAmbienceStore.getState().load(),
        useMediaStore.getState().load(),
        useVideoStore.getState().load(),
        useArcadeStore.getState().load(),
      ])
      // And stand where the new document says to, rather than at the coordinates
      // of a room that is no longer there.
      const world = useWorldStore.getState().world
      if (world) teleport(world.spawn.x, world.spawn.z, world.spawn.yaw, world.spawn.y)
      warmCovers(useLibraryStore.getState().books)
      // A folder other than the one that was open has not been looked at yet:
      // scan it now rather than sending anyone to find the button in settings.
      // Fire and forget — the scan reports through the status lines above.
      if (library.canIndex && chosen !== libraryRoot) void useLibraryStore.getState().scan()
      rememberLibrary(chosen)
      setRecent(recentLibraries())
    } catch (error) {
      // A recent path that has gone, or IPC refusing the folder: the
      // menu says so instead of a button that silently does nothing.
      setOpenError(`Could not open ${chosen}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className={started ? 'menu menu-leaving' : 'menu'} data-testid="main-menu">
      <div className="menu-card">
        <h1 className="menu-title">kleib3ry — 3D Virtual Personal Library</h1>
        <p className="menu-sub">A library you can walk into</p>

        <p className="controls-heading">This Library</p>
        {/* "No root yet" means something different in each driver: a mounted
            folder the server has not answered for yet is not a stand-in. */}
        <p className="menu-current" data-testid="menu-current">
          {libraryRoot ??
            (library.kind === 'tauri'
              ? 'No folder chosen yet'
              : library.kind === 'http'
                ? 'The folder mounted into the container'
                : 'A generated stand-in')}
        </p>
        <p className="note">
          {ready
            ? `${worldName ?? 'The room'} · ${books.toLocaleString()} books`
            : 'Reading the folder…'}
        </p>
        {worldError && <p className="note warn">{worldError}</p>}
        {libraryError && <p className="note warn">{libraryError}</p>}
        {openError && <p className="note warn">{openError}</p>}
        <ScanStatus />

        {/* Only where the driver can actually switch folders: in hosted mode the
            root is the mounted folder, and a list of buttons whose click can only
            throw is worse than no list. */}
        {library.canPickFolder && recent.length > 0 && (
          <>
            <p className="controls-heading">Recently Open</p>
            <ul className="menu-recent">
              {recent.map((path) => (
                <li key={path}>
                  <button
                    className={path === libraryRoot ? 'on' : ''}
                    disabled={opening !== null}
                    onClick={() => void openFolder(path)}
                    title={path}
                  >
                    {path}
                  </button>
                  <button
                    className="menu-forget"
                    aria-label={`Forget ${path}`}
                    disabled={opening !== null}
                    onClick={() => {
                      forgetLibrary(path)
                      setRecent(recentLibraries())
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* `canPickFolder` is false in both non-desktop drivers for opposite
            reasons, so the message is keyed off the driver rather than off it. */}
        {library.kind === 'http' && (
          <p className="note">
            Hosted mode: the library is the folder mounted into the container, so there is nothing
            to choose. To read a different one, mount a different folder.
          </p>
        )}
        {library.kind === 'browser' && (
          <p className="note warn">
            This build has no filesystem, so the library is a generated stand-in. Run{' '}
            <code>npm run tauri:dev</code> for the desktop app, or{' '}
            <code>npm run docker:build</code> for the container, to open a folder of your own.
          </p>
        )}

        <div className="row-controls menu-actions">
          <button
            data-testid="choose-library"
            disabled={!library.canPickFolder || opening !== null}
            onClick={() => void openFolder(null)}
          >
            {opening ? 'Opening…' : 'Choose a Folder…'}
          </button>
          <button
            data-testid="menu-settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Settings
          </button>
          <button className="on" data-testid="enter-library" onClick={() => start()}>
            {ready ? 'Go In' : 'Go In (still loading)'}
          </button>
        </div>
      </div>
    </div>
  )
}
