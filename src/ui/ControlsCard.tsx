import { useAppStore } from '../state/store'

/**
 * Every key the room answers to, on one card. F1 opens and closes it; it does
 * not take the keyboard, so you can read it while you walk.
 */

const SECTIONS: Array<{ title: string; rows: Array<[string[], string]> }> = [
  {
    title: 'Moving',
    rows: [
      [['W', 'A', 'S', 'D'], 'Walk'],
      [['shift'], 'Run'],
      [['ctrl'], 'Kneel, to read the bottom shelf — held, not toggled'],
      [['Z'], 'Zoom in — held, like kneeling; the right mouse button does it too'],
      [['click'], 'Capture the mouse to look around (Esc releases)'],
    ],
  },
  {
    title: 'Hands',
    rows: [
      [['E'], 'Take or place a book, record or tape; pin a sheet to a wall; sit down; work a lamp, a light switch, the deck, the television, the coffee maker, the catalogue'],
      [['Q'], 'Drop the book in your hand — or put a held record, tape or marker back'],
      [['O'], 'Put a book down open, at the page you were on'],
      [['F'], 'Draw the book under the crosshair out to see its cover'],
      [['R'], 'Read the book in your hand — PDF or EPUB'],
      [['G'], 'Empty the box you are looking at onto the nearest shelves'],
      [[',', '.'], 'Browse the pile in a box (the wheel works too)'],
      [['X'], 'Pick up a moving box and carry it; again to set it down'],
      [['⌫'], 'Break down an empty box — spares wait on the stack in the kitchen, E takes one'],
      [['L'], 'Write a label on the bookcase you are aiming at'],
      [['T'], 'Write a note to pin up; E sticks it to whatever wall you look at'],
    ],
  },
  {
    title: 'Records and Tapes',
    rows: [
      [['E'], 'Take one out of a crate; then put it on a deck or in the set, file it in any crate, or set a record down on a table'],
      [['F'], 'Take the record back off the deck, or the tape back out of the set'],
      [['Q'], 'Send it back to the crate the folder deals it into'],
    ],
  },
  {
    title: 'The Whiteboard',
    rows: [
      [['E'], 'Pick the marker up off the office desk, and put it back'],
      [['drag'], 'Hold the left mouse button and the line follows the crosshair'],
      [['F'], 'Change pen'],
      [['G'], 'Wipe the board you are looking at'],
    ],
  },
  {
    title: 'The Cat',
    rows: [
      [['V'], 'Call it — it comes if it feels like it'],
      [['E'], 'Give it a fuss, when it is under the crosshair'],
      [['F'], 'Ask it for a book; it picks one off a shelf and brings it to you'],
    ],
  },
  {
    title: 'Reading',
    rows: [
      [['drag'], 'Pull a page across to turn it — let go early and it falls back'],
      [['←', '→'], 'Turn pages'],
      [['B'], 'Put a bookmark in, or take it out'],
      [['P'], 'Tear out a copy of the page — the book keeps its own'],
      [['J'], 'Go to a page by number'],
      [['Esc'], 'Close the book'],
    ],
  },
  {
    title: 'The Room',
    rows: [
      [['N'], 'Day to night and back'],
      [['K'], 'Rain on and off — you can hear it, louder outside'],
      [['E'], 'At the office terminal, search the whole library for anything'],
      [['H'], 'Hide the interface (and bring it back)'],
      [['F1'], 'This card'],
      [['F2'], 'Settings'],
    ],
  },
]

export function ControlsCard() {
  const open = useAppStore((s) => s.controlsOpen)
  const setOpen = useAppStore((s) => s.setControlsOpen)
  if (!open) return null

  return (
    <div className="controls-card" data-testid="controls-card">
      <p className="field-label">Controls</p>
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
          Close <kbd>F1</kbd>
        </button>
      </div>
    </div>
  )
}
