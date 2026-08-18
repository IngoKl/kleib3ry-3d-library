import { useEffect, useRef, useState } from 'react'
import { NOTE_COLOURS } from '../scene/pinArt'
import { useAppStore } from '../state/store'

/**
 * The same one-line field as a shelf label, taking the keyboard entirely while
 * open because `W` has to be a letter while somebody types a word. The note goes
 * into your hand rather than onto a wall: where it ends up is a separate
 * decision, which is also what lets one be moved afterwards.
 */
export function NoteField() {
  const noting = useAppStore((s) => s.noting)
  const setNoting = useAppStore((s) => s.setNoting)
  const setHeldPin = useAppStore((s) => s.setHeldPin)

  const [text, setText] = useState('')
  /** Which pad the next note comes off. Advances, so a wall is not monochrome. */
  const pad = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!noting) return
    setText('')
    // Pointer lock is released as soon as the field opens, so the focus lands.
    if (document.pointerLockElement) document.exitPointerLock()
    input.current?.focus()
  }, [noting])

  if (!noting) return null

  const commit = () => {
    const written = text.trim()
    // An empty note is a decision not to write one.
    if (written) {
      setHeldPin({ kind: 'note', text: written, colour: pad.current % NOTE_COLOURS.length })
      pad.current += 1
    }
    setNoting(false)
  }

  return (
    <div className="field-card" data-testid="note-field">
      <p className="field-label">Write a Note</p>
      <input
        ref={input}
        value={text}
        maxLength={160}
        placeholder="ask the library about this…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setNoting(false)
        }}
        autoFocus
      />
      <p className="field-hint">
        <kbd>Enter</kbd> take it · <kbd>Esc</kbd> never mind · then <kbd>E</kbd> at a wall
      </p>
    </div>
  )
}
