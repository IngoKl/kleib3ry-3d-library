import { useEffect, useRef, useState } from 'react'
import { library } from '../services'
import { useAppStore } from '../state/store'

/**
 * What you are ordering, and for a paper which one. Two steps in one card,
 * because they are one decision made twice; both take the keyboard like a shelf
 * label and hand it back on `Esc`. The id is not validated here — what counts as
 * an arXiv id is `core/src/paper.rs`'s business.
 */
export function PhoneCard() {
  const phoning = useAppStore((s) => s.phoning)
  const setPhoning = useAppStore((s) => s.setPhoning)
  const order = useAppStore((s) => s.order)
  const orderPaper = useAppStore((s) => s.orderPaper)
  const fetching = useAppStore((s) => s.fetching)
  const orderError = useAppStore((s) => s.orderError)

  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phoning === null) return
    // The mouse is needed to answer, so the room gives up the pointer — the
    // same trade every typed field in here makes.
    if (document.pointerLockElement) document.exitPointerLock()
    if (phoning === 'paper') {
      setText('')
      input.current?.focus()
    } else {
      menu.current?.focus()
    }
  }, [phoning])

  if (phoning === null) return null

  if (phoning === 'menu') {
    return (
      <div
        className="field-card"
        data-testid="phone-card"
        ref={menu}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (!'12'.includes(e.key) && e.key !== 'Escape') return
          // Swallowed rather than handled: the field this opens focuses itself,
          // so the same keystroke would otherwise arrive in it as a character.
          e.preventDefault()
          if (e.key === '1') order()
          if (e.key === '2' && library.canFetchPapers) setPhoning('paper')
          if (e.key === 'Escape') setPhoning(null)
        }}
      >
        <p className="field-label">The Telephone</p>
        <div className="row-controls">
          <button data-testid="order-takeaway" onClick={() => order()}>
            A Takeaway
          </button>
          <button
            data-testid="order-paper"
            disabled={!library.canFetchPapers}
            // A driver that cannot fetch says so here rather than at the end of
            // a keystroke: the fixture has no library folder to put one in.
            title={library.canFetchPapers ? undefined : 'This build has no library folder'}
            onClick={() => setPhoning('paper')}
          >
            An arXiv Paper
          </button>
        </div>
        <p className="field-hint">
          {library.canFetchPapers ? (
            <>
              <kbd>1</kbd> or <kbd>2</kbd> to order · <kbd>Esc</kbd> hang up
            </>
          ) : (
            <>
              <kbd>1</kbd> to order · <kbd>Esc</kbd> hang up
            </>
          )}
        </p>
      </div>
    )
  }

  const send = () => {
    if (!text.trim() || fetching) return
    void orderPaper(text.trim())
  }

  return (
    <div className="field-card" data-testid="paper-field">
      <p className="field-label">An arXiv Paper</p>
      <input
        ref={input}
        value={text}
        placeholder="2401.12345, or the link"
        disabled={fetching}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') send()
          if (e.key === 'Escape') setPhoning(null)
        }}
        autoFocus
      />
      {orderError ? (
        <p className="field-hint warn" data-testid="paper-error">
          {orderError}
        </p>
      ) : (
        <p className="field-hint">
          {fetching ? (
            'Downloading…'
          ) : library.canFetchPapers ? (
            <>
              <kbd>Enter</kbd> order · <kbd>Esc</kbd> hang up
            </>
          ) : (
            'This build has no library folder to put one in.'
          )}
        </p>
      )}
    </div>
  )
}
