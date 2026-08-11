import { useAppStore } from '../state/store'

/**
 * Every key the room answers to, on one card.
 *
 * The one-line hint under the crosshair vanishes the moment the pointer locks —
 * which is exactly when you start needing it. This is the durable version:
 * opened with F1 (or the panel button), closed the same way, and it does not
 * grab the keyboard, so you can leaf through it while you walk.
 */

const SECTIONS: Array<{ title: string; rows: Array<[string[], string]> }> = [
  {
    title: 'moving',
    rows: [
      [['W', 'A', 'S', 'D'], 'walk'],
      [['shift'], 'run'],
      [['ctrl'], 'kneel, to read the bottom shelf — held, not toggled'],
      [['Z'], 'zoom in — held, like kneeling; the right mouse button does it too'],
      [['click'], 'capture the mouse to look around (Esc releases)'],
    ],
  },
  {
    title: 'hands',
    rows: [
      [['E'], 'take or place a book, record or tape; pin a sheet to a wall; sit down; work a lamp, the deck, the television, the coffee maker, the catalogue'],
      [['Q'], 'drop the book in your hand — or put a held record or tape back'],
      [['O'], 'put a book down open, at the page you were on'],
      [['F'], 'draw the book under the crosshair out to see its cover'],
      [['R'], 'read the book in your hand — PDF or EPUB'],
      [['G'], 'empty the box you are looking at onto the shelves'],
      [[',', '.'], 'browse the pile in a box (the wheel works too)'],
      [['X'], 'pick up a moving box and carry it; again to set it down'],
      [['L'], 'write a label on the bookcase you are aiming at'],
      [['T'], 'write a note to pin up; E sticks it to whatever wall you look at'],
    ],
  },
  {
    title: 'the cat',
    rows: [
      [['V'], 'call it — it comes if it feels like it'],
      [['E'], 'give it a fuss, when it is under the crosshair'],
      [['F'], 'ask it for a book; it picks one off a shelf and brings it to you'],
    ],
  },
  {
    title: 'reading',
    rows: [
      [['drag'], 'pull a page across to turn it — let go early and it falls back'],
      [['←', '→'], 'turn pages'],
      [['B'], 'put a bookmark in, or take it out'],
      [['P'], 'tear out a copy of the page — the book keeps its own'],
      [['J'], 'go to a page by number'],
      [['Esc'], 'close the book'],
    ],
  },
  {
    title: 'the room',
    rows: [
      [['N'], 'day to night and back'],
      [['K'], 'rain on and off'],
      [['E'], 'at the office terminal, search the whole library for anything'],
      [['H'], 'hide the interface (and bring it back)'],
      [['F1'], 'this card'],
      [['F2'], 'settings'],
    ],
  },
]

export function ControlsCard() {
  const open = useAppStore((s) => s.controlsOpen)
  const setOpen = useAppStore((s) => s.setControlsOpen)
  if (!open) return null

  return (
    <div className="controls-card" data-testid="controls-card">
      <p className="field-label">controls</p>
      {SECTIONS.map((section) => (
        <div key={section.title} className="controls-section">
          <p className="controls-heading">{section.title}</p>
          <dl className="controls-list">
            {section.rows.map(([keys, what]) => (
              <div key={what} className="controls-row">
                <dt>
                  {keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <div className="row-controls">
        <button onClick={() => setOpen(false)}>
          close <kbd>F1</kbd>
        </button>
      </div>
    </div>
  )
}
