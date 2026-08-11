import { useEffect, useRef, useState } from 'react'
import { readerStatus } from '../reader/status'
import { useAppStore } from '../state/store'

/**
 * "Go to page 412."
 *
 * Typed as a *page*, converted to a spread here, because the reader thinks in
 * spreads and nobody else does: leaf s carries pages 2s and 2s+1, so page 412
 * is spread 206. Getting that arithmetic wrong by one is the difference between
 * landing on the page you asked for and landing on its neighbour, which is why
 * it lives in one place next to the field that produces it.
 */
export function JumpToPageField() {
  const open = useAppStore((s) => s.jumping)
  const setJumping = useAppStore((s) => s.setJumping)
  const requestJump = useAppStore((s) => s.requestJump)

  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    input.current?.focus()
  }, [open])

  if (!open) return null

  const pages = readerStatus.pages
  const commit = () => {
    const page = Number.parseInt(text, 10)
    if (Number.isFinite(page) && page > 0) requestJump(Math.floor(page / 2))
    else setJumping(false)
  }

  return (
    <div className="field-card" data-testid="jump-field">
      <p className="field-label">go to page</p>
      <input
        ref={input}
        value={text}
        inputMode="numeric"
        placeholder={pages ? `1 – ${pages}` : 'page'}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setJumping(false)
        }}
        autoFocus
      />
      <p className="field-hint">
        <kbd>enter</kbd> go · <kbd>esc</kbd> stay
      </p>
    </div>
  )
}
