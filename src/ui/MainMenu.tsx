import { useEffect, useState } from 'react'
import { library } from '../services'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { warmCovers } from '../state/covers'
import { teleport } from '../state/player'
import { forgetLibrary, recentLibraries, rememberLibrary } from '../state/settings'

/**
 * The main menu: which library, and then in.
 *
 * The room loads *behind* this rather than after it. That is the decision worth
 * writing down, because the obvious arrangement — menu, then load — makes
 * choosing a library a thing you do and then wait for, and a fresh scan of a
 * real folder is not a short wait. Loading underneath means the menu is up for
 * exactly as long as it takes you to decide, and going in is instant.
 *
 * What that costs is a rule, enforced in `roomHasKeyboard`: while the menu is
 * up, no keystroke and no click reaches the room. Otherwise the E you press to
 * choose a folder is also the E that takes a book off a shelf behind it.
 *
 * The recent list is per-machine, in `localStorage`, and not in the library
 * folder — a list of *other* libraries is exactly the sort of thing that must
 * not travel inside one of them.
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
   * Open a different folder, and rebuild everything that hangs off it.
   *
   * In that order, and the order is the whole of it: the world has to be up
   * before the library, or there are no shelves to reconcile against and every
   * book looks like it has nowhere to go. Same sequence as the boot in `App`.
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
        useLightStore.getState().load(),
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
        <p className="menu-sub">a library you can walk into</p>

        <p className="controls-heading">this library</p>
        <p className="menu-current" data-testid="menu-current">
          {libraryRoot ?? (library.canPickFolder ? 'no folder chosen yet' : 'a generated stand-in')}
        </p>
        <p className="note">
          {ready
            ? `${worldName ?? 'the room'} · ${books.toLocaleString()} books`
            : 'reading the folder…'}
        </p>
        {worldError && <p className="note warn">{worldError}</p>}
        {libraryError && <p className="note warn">{libraryError}</p>}

        {recent.length > 0 && (
          <>
            <p className="controls-heading">recently open</p>
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
                    aria-label={`forget ${path}`}
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

        {!library.canPickFolder && (
          <p className="note warn">
            This build has no filesystem, so the library is a generated stand-in. Run{' '}
            <code>npm run tauri:dev</code> to open a folder of your own.
          </p>
        )}

        <div className="row-controls menu-actions">
          <button
            data-testid="choose-library"
            disabled={!library.canPickFolder || opening !== null}
            onClick={() => void openFolder(null)}
          >
            {opening ? 'opening…' : 'choose a folder…'}
          </button>
          <button
            data-testid="menu-settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            settings
          </button>
          <button className="on" data-testid="enter-library" onClick={() => start()}>
            {ready ? 'go in' : 'go in (still loading)'}
          </button>
        </div>
      </div>
    </div>
  )
}
