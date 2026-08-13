import { create } from 'zustand'
import { library } from '../services'
import type { AnnotationsDocument, BoardStroke, BookNote } from '../services/types'
import { pageToSpread, spreadToPage } from '../data/pageNumbers'
import { useLibraryStore } from './library'

/**
 * Bookmarks, notes and ink — the marginalia, in `.library/annotations.json`.
 *
 * Their own file, apart from the layout, because they are a different kind of
 * fact: where a book stands is the room's business, but what you wrote in it is
 * yours, and the file is meant to be read without the app. So it speaks page
 * numbers rather than spreads, and every book entry carries its title and
 * author — an entry whose book has left the index is still legible, and is
 * deliberately never pruned. Words are not dropped by a rescan.
 *
 * The reader, though, thinks in spreads, and the conversion lives at the file
 * boundary: bookmarks are spread-indexed in memory and page-numbered on disk.
 */

export const ANNOTATIONS_SCHEMA_VERSION = 1

const SAVE_DEBOUNCE_MS = 400

export { pageToSpread, spreadToPage }

/** Bumped per note, so two written in the same millisecond differ. */
let noteCounter = 0

type AnnotationsStore = {
  /** Book id -> bookmarked spreads, ascending. The reader speaks spreads. */
  bookmarks: Record<string, number[]>
  /** Book id -> notes, page order then creation order. Pages are 1-based. */
  notes: Record<string, BookNote[]>
  /** Book id -> page -> ink drawn on it, in page space, oldest stroke first. */
  drawings: Record<string, Record<number, BoardStroke[]>>
  /**
   * Title and author as last written to the file, so a book the index has
   * lost keeps its name in it. Refreshed from the index for live books.
   */
  meta: Record<string, { title: string; author: string | null }>
  loaded: boolean
  load: () => Promise<void>
  /** Add or remove a bookmark at `spread`. Returns true if one is now there. */
  toggleBookmark: (bookId: string, spread: number) => boolean
  /** Write a note on a page. Returns it, id and all. */
  addNote: (bookId: string, page: number, text: string) => BookNote
  /** Rub a note out, by id. Returns whether one went. */
  deleteNote: (bookId: string, noteId: string) => boolean
  notesOn: (bookId: string, page: number) => BookNote[]
  /** Land a finished stroke on a page. */
  drawOnPage: (bookId: string, page: number, stroke: BoardStroke) => void
  /** Wipe every stroke off a page. Returns how many went. */
  wipePage: (bookId: string, page: number) => number
  strokesOn: (bookId: string, page: number) => BoardStroke[]
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let runSave: (() => Promise<void>) | null = null

export const useAnnotationsStore = create<AnnotationsStore>((set, get) => {
  const saveNow = async () => {
    // Marginalia that will not save are still on the pages this session; the
    // next edit tries again.
    await library.saveAnnotations(annotationsDocument()).catch(() => {})
  }
  runSave = saveNow

  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    bookmarks: {},
    notes: {},
    drawings: {},
    meta: {},
    loaded: false,

    load: async () => {
      try {
        const saved = await library.loadAnnotations()
        if (saved) {
          const bookmarks: Record<string, number[]> = {}
          const notes: Record<string, BookNote[]> = {}
          const drawings: Record<string, Record<number, BoardStroke[]>> = {}
          const meta: Record<string, { title: string; author: string | null }> = {}
          for (const [id, entry] of Object.entries(saved.books ?? {})) {
            meta[id] = { title: entry.title, author: entry.author ?? null }
            const spreads = [...new Set((entry.bookmarks ?? []).map(pageToSpread))]
            if (spreads.length) bookmarks[id] = spreads.sort((a, b) => a - b)
            const written = (entry.notes ?? []).filter((n) => n.text)
            if (written.length) notes[id] = [...written].sort((a, b) => a.page - b.page)
            const inked: Record<number, BoardStroke[]> = {}
            for (const [page, strokes] of Object.entries(entry.drawings ?? {})) {
              const n = Number(page)
              if (Number.isFinite(n) && n >= 1 && strokes.length) inked[n] = strokes
            }
            if (Object.keys(inked).length) drawings[id] = inked
          }
          set({ bookmarks, notes, drawings, meta, loaded: true })
          return
        }

        // No file yet. Bookmarks used to live in the layout (schema <= 7);
        // carry them over once, and write the file straight away — before the
        // next layout save rewrites `books.json` without them, or a crash
        // between the two would be the only launch that ever saw them.
        const layout = await library.loadLayout()
        const known = new Set(useLibraryStore.getState().books.map((b) => b.id))
        const bookmarks: Record<string, number[]> = {}
        for (const [id, spreads] of Object.entries(layout?.bookmarks ?? {})) {
          // The old load pruned lost books' bookmarks every launch; migrating
          // them would resurrect entries with no title to give them.
          if (known.has(id) && spreads.length) {
            bookmarks[id] = [...spreads].sort((a, b) => a - b)
          }
        }
        set({ bookmarks, loaded: true })
        if (Object.keys(bookmarks).length) await saveNow()
      } catch {
        set({ loaded: true })
      }
    },

    toggleBookmark: (bookId, spread) => {
      const existing = get().bookmarks[bookId] ?? []
      const already = existing.includes(spread)
      const next = already
        ? existing.filter((s) => s !== spread)
        : [...existing, spread].sort((a, b) => a - b)

      const bookmarks = { ...get().bookmarks }
      if (next.length) bookmarks[bookId] = next
      else delete bookmarks[bookId]

      set({ bookmarks })
      scheduleSave()
      return !already
    },

    addNote: (bookId, page, text) => {
      const note: BookNote = {
        id: `note-${Date.now().toString(36)}-${++noteCounter}`,
        page,
        text,
        created: new Date().toISOString(),
      }
      const existing = get().notes[bookId] ?? []
      // Stable sort: notes on one page stay in the order they were written.
      const next = [...existing, note].sort((a, b) => a.page - b.page)
      set({ notes: { ...get().notes, [bookId]: next } })
      scheduleSave()
      return note
    },

    deleteNote: (bookId, noteId) => {
      const existing = get().notes[bookId] ?? []
      const next = existing.filter((n) => n.id !== noteId)
      if (next.length === existing.length) return false
      const notes = { ...get().notes }
      if (next.length) notes[bookId] = next
      else delete notes[bookId]
      set({ notes })
      scheduleSave()
      return true
    },

    notesOn: (bookId, page) => (get().notes[bookId] ?? []).filter((n) => n.page === page),

    drawOnPage: (bookId, page, stroke) => {
      const book = get().drawings[bookId] ?? {}
      const next = { ...book, [page]: [...(book[page] ?? []), stroke] }
      set({ drawings: { ...get().drawings, [bookId]: next } })
      scheduleSave()
    },

    wipePage: (bookId, page) => {
      const book = get().drawings[bookId]
      const gone = book?.[page]?.length ?? 0
      if (!book || !gone) return 0
      const next = { ...book }
      delete next[page]
      const drawings = { ...get().drawings }
      if (Object.keys(next).length) drawings[bookId] = next
      else delete drawings[bookId]
      set({ drawings })
      scheduleSave()
      return gone
    },

    strokesOn: (bookId, page) => get().drawings[bookId]?.[page] ?? [],
  }
})

/** The document as it would be written now, for the Markdown export. */
export function annotationsDocument(): AnnotationsDocument {
  const { bookmarks, notes, drawings, meta } = useAnnotationsStore.getState()
  const byId = useLibraryStore.getState().byId
  const books: AnnotationsDocument['books'] = {}
  const ids = new Set([
    ...Object.keys(bookmarks),
    ...Object.keys(notes),
    ...Object.keys(drawings),
  ])
  for (const id of ids) {
    const indexed = byId.get(id)
    const entry: AnnotationsDocument['books'][string] = {
      title: indexed?.title ?? meta[id]?.title ?? 'Unknown',
      author: indexed?.author ?? meta[id]?.author ?? null,
    }
    const marks = bookmarks[id] ?? []
    if (marks.length) entry.bookmarks = marks.map((s) => spreadToPage(s, indexed?.pageCount ?? null))
    const written = notes[id] ?? []
    if (written.length) entry.notes = written
    const inked = drawings[id] ?? {}
    if (Object.keys(inked).length) {
      entry.drawings = Object.fromEntries(
        Object.entries(inked).map(([page, strokes]) => [String(page), strokes]),
      )
    }
    books[id] = entry
  }
  return { schemaVersion: ANNOTATIONS_SCHEMA_VERSION, books }
}

// A note written just before closing the window is still a note; the debounce
// must not be a window that loses the last of the marginalia.
if (typeof window !== 'undefined') {
  const flush = () => {
    if (saveTimer === undefined) return
    clearTimeout(saveTimer)
    saveTimer = undefined
    void runSave?.()
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
}
