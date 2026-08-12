import { useEffect, useState } from 'react'
import { library } from '../services'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { warmCovers } from '../state/covers'
import { teleport } from '../state/player'
import { forgetLibrary, recentLibraries, rememberLibrary } from '../state/settings'

/**
 * The main menu: which library, and then in.
 *
 * The room loads *behind* this, so going in is instant. The cost is a rule
 * enforced in `roomHasKeyboard`: while the menu is up, nothing reaches the room.
 *
 * The recent list is per-machine, in `localStorage` — a list of other libraries
 * must not travel inside one of them.
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

  // A folder that opened is a folder worth offering next time.
  useEffect(() => {
    if (!started || !libraryRoot) return
    rememberLibrary(libraryRoot)
  }, [started, libraryRoot])

  if (started) return null

  const ready = rootLoaded && worldLoaded && libraryLoaded

  /**
   * Open a different folder and rebuild everything that hangs off it. The world
   * goes first, or there are no shelves to reconcile against. Same order as `App`.
   */
  const openFolder = async (path: string | null) => {
    const chosen = path ?? (await library.pickRoot().catch(() => null))
    if (!chosen) return
    setOpening(chosen)
    try {
      await library.setRoot(chosen)
      useAppStore.setState({ libraryRoot: chosen })
      await useWorldStore.getState().load()
      await useLibraryStore.getState().load()
      // Everything else that hangs off the folder. The lamps, the records, the
      // pictures and the tapes are all *that library's*, so opening a second one
      // without these leaves you standing in the new rooms with the old library's
      // music on the shelf.
      await Promise.all([
        useAmbienceStore.getState().load(),
        useMediaStore.getState().load(),
        useVideoStore.getState().load(),
      ])
      // And stand where the new document says to, rather than at the coordinates
      // of a room that is no longer there.
      const world = useWorldStore.getState().world
      if (world) teleport(world.spawn.x, world.spawn.z, world.spawn.yaw, world.spawn.y)
      warmCovers(useLibraryStore.getState().books)
      rememberLibrary(chosen)
      setRecent(recentLibraries())
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="menu" data-testid="main-menu">
      <div className="menu-card">
        <h1 className="menu-title">kleib3ry</h1>
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

        {recent.length > 0 && (
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
