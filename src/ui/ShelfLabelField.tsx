import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'

/**
 * A one-line field that takes the keyboard entirely while open — the walk
 * controller and the reader both bail out on `labelling`, because `W` has to be
 * a letter while somebody types a word.
 */
export function ShelfLabelField() {
  const shelfId = useAppStore((s) => s.labelling)
  const setLabelling = useAppStore((s) => s.setLabelling)
  const setLabel = useLibraryStore((s) => s.setLabel)
  const labelOf = useLibraryStore((s) => s.labelOf)

  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (shelfId === null) return
    setText(labelOf(shelfId) ?? '')
    // Pointer lock is released as soon as the field opens, so the focus lands.
    if (document.pointerLockElement) document.exitPointerLock()
    input.current?.focus()
    // A frame later, once the old label has landed in the input, so typing
    // replaces it the way a rename field does everywhere else.
    requestAnimationFrame(() => input.current?.select())
  }, [shelfId, labelOf])

  if (shelfId === null) return null

  const commit = () => {
    setLabel(shelfId, text)
    setLabelling(null)
  }

  return (
    <div className="field-card" data-testid="label-field">
      <p className="field-label">Label for {shelfId}</p>
      <input
        ref={input}
        value={text}
        maxLength={40}
        placeholder="Poetry, Cookery, To read…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setLabelling(null)
        }}
        autoFocus
      />
      <p className="field-hint">
        <kbd>Enter</kbd> write it · <kbd>Esc</kbd> leave it · empty rubs it out
      </p>
    </div>
  )
}
