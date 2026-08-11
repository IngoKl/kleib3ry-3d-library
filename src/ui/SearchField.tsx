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
 * It says where a thing is — which case, which room, which box, which table —
 * and deliberately does not take you there.
 *
 * A DOM overlay rather than type drawn on the tube: a canvas texture on a 40 cm
 * screen across a desk is not readable. The screen in the room lights while it
 * is open.
 */

type Hit = {
  key: string
  what: 'book' | 'record' | 'tape' | 'picture'
  title: string
  detail: string
  where: string
}

/**
 * How many of each kind a search may show. Per kind rather than one pool: books
 * are scanned first and there are a thousand of them, so a shared limit buried
 * every record and tape.
 */
const LIMITS = { book: 9, record: 3, tape: 3, picture: 2 } as const

/**
 * Case-insensitive and blind to accents: NFKD splits an accented letter into a
 * letter and a combining mark, and dropping the marks makes "Melies" find it.
 */
const fold = (text: string) =>
  [...text.toLowerCase().normalize('NFKD')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x300 || code > 0x36f
    })
    .join('')

/**
 * Every term has to appear somewhere in the record, in any order. Not fuzzy: an
 * index that guesses cannot be trusted to say a book is *not* there.
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
  const filedRecords = useLibraryStore((s) => s.filedRecords)
  const looseRecords = useLibraryStore((s) => s.looseRecords)
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
   * lookup per hit.
   */
  const placeOf = useMemo(() => {
    const at = new Map<string, string>()
    // Only while the panel is open: this is subscribed to the whole layout, so
    // it re-renders on every shelving.
    if (!world || !searching) return at

    const roomName = (roomId: string) =>
      world.rooms.find((room) => room.id === roomId)?.name ?? roomId

    for (const shelf of world.shelves) {
      const label = labelOf(shelf.id)
      const name = label ? `“${label}”` : shelf.id
      for (let row = 0; row < shelf.rows; row++) {
        const ids = rows[rowKey(shelf.id, row)]
        if (!ids) continue
        // Rows are numbered from the floor up, as you would count them standing
        // in front of the case.
        const place = `${name}, shelf ${row + 1} — ${roomName(shelf.roomId)}`
        for (const id of ids) at.set(id, place)
      }
    }

    for (const [boxId, ids] of Object.entries(boxes)) {
      const box = world.furniture.find((item) => item.id === boxId)
      const place = `Still in ${boxId}${box ? ` — ${roomName(box.roomId)}` : ''}`
      for (const id of ids) at.set(id, place)
    }

    for (const [id, placement] of Object.entries(loose)) {
      at.set(id, whereLeft(placement))
    }

    return at
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, world, rows, boxes, loose, labelOf])

  /** Which room a point is in, for anything put down rather than filed. */
  function whereLeft(at: { x: number; z: number }): string {
    const room = world?.rooms.find(
      (candidate) =>
        Math.abs(at.x - candidate.origin[0]) <= candidate.size[0] / 2 &&
        Math.abs(at.z - candidate.origin[1]) <= candidate.size[1] / 2,
    )
    return room ? `Left out in the ${room.name.toLowerCase()}` : 'Left out somewhere'
  }

  /** Where a record actually is: put down, filed by hand, or in the first crate. */
  const recordPlace = (trackId: string): string => {
    const at = looseRecords[trackId]
    if (at) return whereLeft(at)
    const crateId = filedRecords[trackId]
    const crate =
      (crateId ? world?.furniture.find((item) => item.id === crateId) : undefined) ??
      world?.furniture.find((item) => item.kind === 'recordshelf')
    if (!crate || !world) return 'The record crate'
    const room = world.rooms.find((candidate) => candidate.id === crate.roomId)
    return `The record crate — ${room?.name ?? crate.roomId}`
  }

  /** Which room the tape crate is in. */
  const tapeCrateIn = useMemo(() => {
    const piece = world?.furniture.find((item) => item.kind === 'tapecrate')
    if (!piece || !world) return null
    return world.rooms.find((room) => room.id === piece.roomId)?.name ?? piece.roomId
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
        detail: `${book.author ?? 'Unknown'} · ${book.format}`,
        where: placeOf.get(book.id) ?? 'Not shelved',
      })
    }

    for (const track of tracks) {
      if (!room('record')) break
      if (!matches(fold(`${track.title} ${track.artist ?? ''} ${track.album ?? ''}`), terms)) continue
      found.push({
        key: `record:${track.id}`,
        what: 'record',
        title: track.album ?? track.title,
        detail: track.artist ?? 'Unknown',
        where: recordPlace(track.id),
      })
    }

    for (const tape of tapes) {
      if (!room('tape')) break
      if (!matches(fold(`${tape.title} ${tape.series ?? ''}`), terms)) continue
      found.push({
        key: `tape:${tape.id}`,
        what: 'tape',
        title: tape.title,
        detail: tape.series ?? 'Unlabelled',
        where: tapeCrateIn ? `The tape crate — ${tapeCrateIn}` : 'The tape crate',
      })
    }

    for (const picture of artwork) {
      if (!room('picture')) break
      if (!matches(fold(picture.title), terms)) continue
      found.push({
        key: `picture:${picture.id}`,
        what: 'picture',
        title: picture.title,
        detail: 'From artwork/',
        where: 'In a frame on a wall',
      })
    }

    return found
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, books, tracks, tapes, artwork, placeOf, tapeCrateIn, filedRecords, looseRecords])

  if (!searching) return null

  const asked = query.trim().length > 0

  return (
    <div className="terminal" data-testid="catalogue">
      <p className="terminal-head">
        kleib3ry Catalogue · {books.length.toLocaleString()} records
      </p>
      <div className="terminal-prompt">
        <span aria-hidden="true">&gt;</span>
        <input
          ref={input}
          value={query}
          maxLength={80}
          placeholder="Title, author, album…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setSearching(false)
          }}
          autoFocus
        />
      </div>

      <ul className="terminal-results" data-testid="catalogue-results">
        {!asked && <li className="terminal-idle">Type to look something up</li>}
        {asked && hits.length === 0 && (
          <li className="terminal-idle" data-testid="catalogue-empty">
            Nothing in this library matches that
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
        <kbd>esc</kbd> Step away — it tells you where a thing is, and then you walk to it
      </p>
    </div>
  )
}
