import type { Block, BlockKind, EpubBook } from './epub'

/**
 * Setting an EPUB in type: measure words, break lines, break pages, stop. No
 * hyphenation, justification, floats, or widow control beyond one rule.
 *
 * **Pagination happens once, in abstract units, at open time** — not at the
 * texture's pixel size. A page is 620 by 900 *units*, and rendering scales by
 * `height / 900`. Canvas text metrics are linear in font size, so measuring at
 * one size and drawing at another is exact, which buys the property that
 * matters: page 200 is page 200 on any monitor, in any window, next session.
 * Laying out per texture size would make a bookmark mean something different
 * every time.
 */

/** The page, in units. Roughly a hardback's proportions. */
export const PAGE_W = 620
export const PAGE_H = 900
const MARGIN_X = 68
const MARGIN_TOP = 74
const MARGIN_BOTTOM = 86

export const PAGE_ASPECT = PAGE_W / PAGE_H

const COLUMN = PAGE_W - MARGIN_X * 2

/** Type, per kind: size, leading, the space before it, and how it is set. */
const STYLE: Record<BlockKind, {
  size: number
  leading: number
  before: number
  weight: number
  italic: boolean
  centred: boolean
  indent: number
}> = {
  title: { size: 42, leading: 52, before: 120, weight: 700, italic: false, centred: true, indent: 0 },
  heading: { size: 34, leading: 44, before: 46, weight: 700, italic: false, centred: false, indent: 0 },
  subheading: { size: 26, leading: 34, before: 32, weight: 600, italic: false, centred: false, indent: 0 },
  paragraph: { size: 23, leading: 33, before: 0, weight: 400, italic: false, centred: false, indent: 26 },
  quote: { size: 21, leading: 31, before: 18, weight: 400, italic: true, centred: false, indent: 34 },
  break: { size: 23, leading: 33, before: 0, weight: 400, italic: false, centred: true, indent: 0 },
}

const fontFor = (kind: BlockKind) => {
  const style = STYLE[kind]
  const family =
    kind === 'paragraph' || kind === 'quote'
      ? 'Georgia, "Iowan Old Style", "Times New Roman", serif'
      : '"Segoe UI", system-ui, sans-serif'
  return `${style.italic ? 'italic ' : ''}${style.weight} ${style.size}px ${family}`
}

export type Line = {
  text: string
  kind: BlockKind
  /** Baseline position from the top of the page, in units. */
  y: number
  /** Left edge, in units. */
  x: number
  centred: boolean
}

export type LaidOutPage = { lines: Line[] }

export type EpubLayout = {
  pages: LaidOutPage[]
  title: string | null
}

/**
 * A measuring context.
 *
 * One offscreen canvas for every book ever opened: `measureText` needs a
 * context and nothing else about it matters, so allocating one per layout would
 * be allocating a canvas per book to throw it away.
 */
let ruler: CanvasRenderingContext2D | null = null
function measurer(): CanvasRenderingContext2D {
  if (!ruler) {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    ruler = canvas.getContext('2d')!
  }
  return ruler
}

/** Greedy wrap. A word too long for the column is left to overhang and be clipped. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= width || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Break the book into pages.
 *
 * The two rules beyond "fill until full":
 *
 *   - a document in the spine starts a new page, because that is a chapter;
 *   - a heading with fewer than three lines under it goes to the next page,
 *     because a chapter title alone at the foot of a page is the one typographic
 *     failure everybody notices.
 */
export function layOutEpub(book: EpubBook): EpubLayout {
  const ctx = measurer()
  const pages: LaidOutPage[] = []

  let lines: Line[] = []
  let cursor = MARGIN_TOP

  const flush = () => {
    if (lines.length > 0) pages.push({ lines })
    lines = []
    cursor = MARGIN_TOP
  }

  const bottom = PAGE_H - MARGIN_BOTTOM

  const blocks: Block[] = book.title
    ? [{ kind: 'title', text: book.title }, ...book.blocks]
    : [...book.blocks]

  for (const block of blocks) {
    const style = STYLE[block.kind]
    if (block.fresh) flush()

    ctx.font = fontFor(block.kind)
    const wrapped = wrap(ctx, block.text, COLUMN - style.indent)
    if (wrapped.length === 0) continue

    // Space above, but never at the top of a page — a page that starts 46 units
    // down for no visible reason reads as a misprint.
    if (lines.length > 0) cursor += style.before

    const isHeading = block.kind === 'heading' || block.kind === 'subheading' || block.kind === 'title'
    if (isHeading && cursor + style.leading * 3 > bottom) flush()

    for (let i = 0; i < wrapped.length; i++) {
      if (cursor + style.leading > bottom) flush()
      cursor += style.leading
      lines.push({
        text: wrapped[i]!,
        kind: block.kind,
        y: cursor,
        // Only the first line of a paragraph is indented, which is what an
        // indent is for.
        x: MARGIN_X + (i === 0 ? style.indent : block.kind === 'quote' ? style.indent : 0),
        centred: style.centred,
      })
    }
  }

  flush()
  // A book that laid out to nothing still has to have a page, or every index
  // into it is out of range.
  if (pages.length === 0) pages.push({ lines: [] })

  return { pages, title: book.title }
}

const PAPER = '#f4efe2'
const INK = '#2b2620'
const FOLIO = '#8b8172'

/**
 * Draw one page.
 *
 * `page` is 1-based, matching the reader's page numbering and therefore `J` and
 * the bookmarks. Out of range returns null, which is exactly what the PDF path
 * does past the last page and is what lets the final spread commit.
 */
export function renderEpubPage(
  layout: EpubLayout,
  page: number,
  targetHeightPx: number,
  maxTextureSize = 8192,
): HTMLCanvasElement | null {
  const laid = layout.pages[page - 1]
  if (!laid) return null

  const cap = Math.min(maxTextureSize / PAGE_H, maxTextureSize / PAGE_W)
  const scale = Math.max(0.1, Math.min(targetHeightPx / PAGE_H, cap))

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(PAGE_W * scale)
  canvas.height = Math.ceil(PAGE_H * scale)
  const ctx = canvas.getContext('2d', { alpha: false })!

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)

  ctx.textBaseline = 'alphabetic'
  for (const line of laid.lines) {
    ctx.font = fontFor(line.kind)
    ctx.fillStyle = INK
    if (line.centred) {
      ctx.textAlign = 'center'
      ctx.fillText(line.text, PAGE_W / 2, line.y, COLUMN)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(line.text, line.x, line.y, COLUMN - (line.x - MARGIN_X))
    }
  }

  // A folio, because a page with a number on it is a page you can be told to
  // go to — and `J` sends you to one.
  ctx.font = '400 17px Georgia, serif'
  ctx.fillStyle = FOLIO
  ctx.textAlign = 'center'
  ctx.fillText(String(page), PAGE_W / 2, PAGE_H - 40)

  return canvas
}
