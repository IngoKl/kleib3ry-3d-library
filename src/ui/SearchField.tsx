import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { rowKey } from '../scene/shelving'

/**
 * The catalogue terminal, in the office.
 *
 * A thousand spines and no index was the largest thing standing between this
 * being a library and being a room with books in it. What it deliberately does
 * *not* do is take you there: it tells you where a thing is — which case, which
 * room, which box, or which table you left it on — and then you walk. That is
 * what an index in a library is for, and a teleport would quietly make every
 * other thing in the building pointless.
 *
 * It is a DOM overlay rather than type drawn on the tube, for the same reason
 * the shelf label field is: a search you type is a search you have to be able to
 * read, and a canvas texture on a 40 cm screen across a desk is not that. The
 * screen in the room lights up while it is open, so the thing you are typing
 * into is visibly the thing you are standing in front of.
 */

type Hit = {
  key: string
  what: 'book' | 'record' | 'tape' | 'picture'
  title: string
  detail: string
  where: string
}

/**
 * How many of each kind a search may show.
 *
 * Per kind rather than one pool, because the books are scanned first and there
 * are a thousand of them: a single shared limit meant that searching for a word
 * that appears in fourteen titles buried the record of the same name entirely,
 * and an index that can only find you books is not an index of the library.
 */
const LIMITS = { book: 9, record: 3, tape: 3, picture: 2 } as const

/**
 * Case-insensitive, and blind to accents: NFKD splits an accented letter into
 * a letter and a combining mark, and dropping the marks makes "Melies" find
 * the film it is filed under.
 */
const fold = (text: string) =>
  [...text.toLowerCase().normalize('NFKD')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x300 || code > 0x36f
    })
    .join('')

/**
 * Every term has to appear somewhere in the record, in any order.
 *
 * Deliberately not fuzzy. A card catalogue that guesses is a card catalogue you
 * cannot trust to tell you a book is *not* there, and "not there" is half of
 * what you ask an index.
 */
function matches(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term))
}

export function SearchField() {
  const searching = useAppStore((s) => s.searching)
  const setSearching = useAppStore((s) => s.setSearching)

  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const books = useLibraryStore((s) => s.books)
  const rows = useLibraryStore((s) => s.rows)
  const boxes = useLibraryStore((s) => s.boxes)
  const loose = useLibraryStore((s) => s.loose)
  const labelOf = useLibraryStore((s) => s.labelOf)
  const tracks = useMediaStore((s) => s.tracks)
  const artwork = useMediaStore((s) => s.artwork)
  const tapes = useVideoStore((s) => s.tapes)
  const world = useWorldStore((s) => s.world)

  useEffect(() => {
    if (!searching) return
    setQuery('')
    // Pointer lock is released as soon as the panel opens, so the focus lands.
    if (document.pointerLockElement) document.exitPointerLock()
    input.current?.focus()
  }, [searching])

  /**
   * Where every shelved book is, as one pass over the layout rather than a
   * lookup per hit. A library is a thousand books and a search is every
   * keystroke; walking the rows once per keystroke is cheap and walking them
   * once per *result* is not.
   */
  const placeOf = useMemo(() => {
    const at = new Map<string, string>()
    // Only while the panel is open. This component is subscribed to the whole
    // layout, so it re-renders on every shelving — and a full pass over a
    // thousand books for a panel nobody is looking at is a pass for nothing.
    if (!world || !searching) return at

    const roomName = (roomId: string) =>
      world.rooms.find((room) => room.id === roomId)?.name ?? roomId

    for (const shelf of world.shelves) {
      const label = labelOf(shelf.id)
      const name = label ? `“${label}”` : shelf.id
      for (let row = 0; row < shelf.rows; row++) {
        const ids = rows[rowKey(shelf.id, row)]
        if (!ids) continue
        // Rows are numbered from the floor up, which is how you would count
        // them standing in front of the case.
        const place = `${name}, shelf ${row + 1} — ${roomName(shelf.roomId)}`
        for (const id of ids) at.set(id, place)
      }
    }

    for (const [boxId, ids] of Object.entries(boxes)) {
      const box = world.furniture.find((item) => item.id === boxId)
      const place = `still in ${boxId}${box ? ` — ${roomName(box.roomId)}` : ''}`
      for (const id of ids) at.set(id, place)
    }

    for (const [id, placement] of Object.entries(loose)) {
      const room = world.rooms.find(
        (candidate) =>
          Math.abs(placement.x - candidate.origin[0]) <= candidate.size[0] / 2 &&
          Math.abs(placement.z - candidate.origin[1]) <= candidate.size[1] / 2,
      )
      at.set(id, room ? `left out in the ${room.name.toLowerCase()}` : 'left out somewhere')
    }

    return at
  }, [searching, world, rows, boxes, loose, labelOf])

  /** Which room each kind of crate is in, so a record has an answer too. */
  const crateIn = useMemo(() => {
    const of = (kind: string) => {
      const piece = world?.furniture.find((item) => item.kind === kind)
      if (!piece || !world) return null
      return world.rooms.find((room) => room.id === piece.roomId)?.name ?? piece.roomId
    }
    return { records: of('recordshelf'), tapes: of('tapecrate') }
  }, [world])

  const hits = useMemo<Hit[]>(() => {
    const terms = fold(query.trim()).split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []

    const found: Hit[] = []
    const room = (what: keyof typeof LIMITS) =>
      found.filter((hit) => hit.what === what).length < LIMITS[what]

    for (const book of books) {
      if (!room('book')) break
      if (!matches(fold(`${book.title} ${book.author ?? ''} ${book.format}`), terms)) continue
      found.push({
        key: `book:${book.id}`,
        what: 'book',
        title: book.title,
        detail: `${book.author ?? 'unknown'} · ${book.format}`,
        where: placeOf.get(book.id) ?? 'not shelved',
      })
    }

    for (const track of tracks) {
      if (!room('record')) break
      if (!matches(fold(`${track.title} ${track.artist ?? ''} ${track.album ?? ''}`), terms)) continue
      found.push({
        key: `record:${track.id}`,
        what: 'record',
        title: track.album ?? track.title,
        detail: track.artist ?? 'unknown',
        where: crateIn.records ? `the record crate — ${crateIn.records}` : 'the record crate',
      })
    }

    for (const tape of tapes) {
      if (!room('tape')) break
      if (!matches(fold(`${tape.title} ${tape.series ?? ''}`), terms)) continue
      found.push({
        key: `tape:${tape.id}`,
        what: 'tape',
        title: tape.title,
        detail: tape.series ?? 'unlabelled',
        where: crateIn.tapes ? `the tape crate — ${crateIn.tapes}` : 'the tape crate',
      })
    }

    for (const picture of artwork) {
      if (!room('picture')) break
      if (!matches(fold(picture.title), terms)) continue
      found.push({
        key: `picture:${picture.id}`,
        what: 'picture',
        title: picture.title,
        detail: 'from artwork/',
        where: 'in a frame on a wall',
      })
    }

    return found
  }, [query, books, tracks, tapes, artwork, placeOf, crateIn])

  if (!searching) return null

  const asked = query.trim().length > 0

  return (
    <div className="terminal" data-testid="catalogue">
      <p className="terminal-head">kleib3ry catalogue · {books.length.toLocaleString()} records</p>
      <div className="terminal-prompt">
        <span aria-hidden="true">&gt;</span>
        <input
          ref={input}
          value={query}
          maxLength={80}
          placeholder="title, author, album…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setSearching(false)
          }}
          autoFocus
        />
      </div>

      <ul className="terminal-results" data-testid="catalogue-results">
        {!asked && <li className="terminal-idle">type to look something up</li>}
        {asked && hits.length === 0 && (
          <li className="terminal-idle" data-testid="catalogue-empty">
            nothing in this library matches that
          </li>
        )}
        {hits.map((hit) => (
          <li key={hit.key}>
            <span className="terminal-kind">{hit.what}</span>
            <span className="terminal-title">{hit.title}</span>
            <span className="terminal-detail">{hit.detail}</span>
            <span className="terminal-where">{hit.where}</span>
          </li>
        ))}
      </ul>

      <p className="terminal-foot">
        <kbd>esc</kbd> step away — it tells you where a thing is, and then you walk to it
      </p>
    </div>
  )
}
