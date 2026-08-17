import { useEffect, useRef, useState } from 'react'
import { readerStatus } from '../reader/status'
import { useAnnotationsStore } from '../state/annotations'
import { useAppStore } from '../state/store'

/**
 * Writing a note on the page you are reading.
 *
 * The same one-line field as the wall note, taking the keyboard entirely while
 * open — the reader's own keys bail out when `annotating` is set. Unlike a wall
 * note this one stays on its page, in `.library/annotations.json`, and is found
 * again by the fore-edge tab.
 */
export function BookNoteField() {
  const annotating = useAppStore((s) => s.annotating)
  const setAnnotating = useAppStore((s) => s.setAnnotating)
  const addNote = useAnnotationsStore((s) => s.addNote)

  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!annotating) return
    setText('')
    input.current?.focus()
  }, [annotating])

  if (!annotating) return null

  const commit = () => {
    const written = text.trim()
    // The recto, by the tear-out convention: the page a hand reaches for.
    const page = Math.min(2 * readerStatus.spread + 1, readerStatus.pages)
    if (written && readerStatus.bookId && page >= 1) {
      addNote(readerStatus.bookId, page, written)
    }
    setAnnotating(false)
  }

  return (
    <div className="field-card" data-testid="book-note-field">
      <p className="field-label">Note on This Page</p>
      <input
        ref={input}
        value={text}
        maxLength={160}
        placeholder="what struck you here…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setAnnotating(false)
        }}
        autoFocus
      />
      <p className="field-hint">
        <kbd>Enter</kbd> keep it · <kbd>Esc</kbd> never mind
      </p>
    </div>
  )
}
