import { between, mulberry32, pick, type Random } from '../lib/rng'

/**
 * Placeholder catalogue.
 *
 * These are NOT your books — the Rust indexer that reads the real library
 * folder is written but not yet wired to a command. Everything downstream
 * (shelving, spines, picking a book up) consumes this shape, so swapping in the
 * real index is a data change rather than a scene change.
 */
export type CatalogueBook = {
  id: string
  title: string
  author: string
  /** Spine thickness in metres — a proxy for page count until we have one. */
  thickness: number
  height: number
  depth: number
  colour: string
  /** Slight lean, radians. A shelf where everything is plumb reads as CGI. */
  lean: number
}

const FIRST = [
  'The', 'A', 'Notes on', 'Against', 'On', 'The Book of', 'Concerning',
  'Letters to', 'The Art of', 'In Praise of', 'The Death of', 'After',
]

const SUBJECT = [
  'Quiet', 'Distance', 'Machines', 'Salt', 'the Provinces', 'Cartography',
  'Winter', 'Small Rooms', 'the Archive', 'Glass', 'Migration', 'Ruins',
  'Silence', 'the Interior', 'Weather', 'Iron', 'the Coast', 'Sleep',
  'Grammar', 'Harvest', 'the Observatory', 'Rivers', 'Ash', 'Longitude',
  'the Garden', 'Stone', 'Dust', 'the Frontier', 'Light', 'Memory',
  'Bridges', 'the Orchard', 'Tides', 'Furniture', 'the Border', 'Clocks',
]

const TAIL = [
  '', '', '', '', ': A History', ': Essays', ', Volume II', ': Selected Writings',
  ' and Other Stories', ': An Inquiry', ', 1890–1914',
]

const SURNAME = [
  'Aldiss', 'Brennan', 'Castellane', 'Duarte', 'Eriksen', 'Farrow', 'Gallagher',
  'Halvorsen', 'Ishikawa', 'Jelinek', 'Kowalski', 'Lindqvist', 'Marchetti',
  'Nowak', 'Okonkwo', 'Pavlović', 'Quintana', 'Rasmussen', 'Sørensen',
  'Tanaka', 'Ueda', 'Varga', 'Whitfield', 'Ximenes', 'Yates', 'Zetterlund',
]

const INITIAL = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'H.', 'J.', 'K.', 'L.', 'M.', 'N.', 'R.', 'S.', 'T.', 'W.']

/** Cloth, buckram and leather. Muted, because a shelf of saturated blocks looks like a toy. */
const SPINE_COLOURS = [
  '#7d3b32', '#8c5a2b', '#3f5a4a', '#2f4257', '#6b2f3c', '#4a4038',
  '#7a6a44', '#2e4a3f', '#5a3a55', '#8a7350', '#334a52', '#6e4630',
  '#43506b', '#775241', '#3d3a44', '#5d6b4a', '#8d6b52', '#2b3a45',
]

function makeBook(random: Random, index: number): CatalogueBook {
  const title = [
    pick(random, FIRST),
    pick(random, SUBJECT),
  ].join(' ') + pick(random, TAIL)

  const author = `${pick(random, INITIAL)} ${pick(random, SURNAME)}`

  // Thickness and height correlate loosely, the way real books do: fat books
  // tend to be tall. Pure independent randomness reads as noise.
  const bulk = random()
  return {
    id: `placeholder-${index}`,
    title,
    author,
    thickness: between(random, 0.016, 0.028) + bulk * 0.022,
    height: between(random, 0.17, 0.21) + bulk * 0.06,
    depth: between(random, 0.115, 0.145) + bulk * 0.02,
    colour: pick(random, SPINE_COLOURS),
    lean: random() < 0.06 ? between(random, -0.09, 0.09) : 0,
  }
}

/** A stable catalogue of `count` books. Same seed, same library, every load. */
export function buildCatalogue(count: number, seed = 0x5eed): CatalogueBook[] {
  const random = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => makeBook(random, i))
}
