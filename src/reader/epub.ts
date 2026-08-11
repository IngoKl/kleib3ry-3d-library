import { openZip, readEntry, readText, ZipError, type ZipEntry } from './zip'

/**
 * An EPUB, reduced to the only thing a reader with no browser engine in it can
 * use: an ordered list of paragraphs.
 *
 * This is the honest version of "EPUB support". An EPUB is a website in a zip
 * file, and rendering one *properly* means a CSS engine — which is a thing this
 * app is running inside of and cannot point at a page mesh. What it can do is
 * take the thing an e-book actually is, which is a sequence of headings and
 * paragraphs in reading order, and set it in type on a page. Everything an
 * author's stylesheet was doing is lost, and what is kept is the book.
 *
 * The parts deliberately dropped, and why:
 *
 *   - **CSS.** See above. A book that arrives with 40 px of letter-spacing and
 *     a background image is a book you cannot read on a shelf either.
 *   - **Images.** A picture in the middle of a text page needs a layout engine
 *     to flow round; their alt text is kept, which is what the author wrote for
 *     exactly this situation.
 *   - **Footnote links, indexes, page lists.** They are navigation, and there is
 *     nothing here to navigate with but a page number — which `J` already does.
 *
 * The spine order is honoured, and each document in it starts a new page,
 * because that is what a chapter break is.
 */

export type BlockKind = 'title' | 'heading' | 'subheading' | 'paragraph' | 'quote' | 'break'

export type Block = {
  kind: BlockKind
  text: string
  /** True at the first block of each document in the spine: start a fresh page. */
  fresh?: boolean
}

export type EpubBook = {
  title: string | null
  author: string | null
  blocks: Block[]
}

export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

/** Resolve `href` against the directory `base` sits in, the way a zip path works. */
function resolve(base: string, href: string): string {
  const clean = href.split('#')[0]!.split('?')[0]!
  if (clean.startsWith('/')) return decodeURIComponent(clean.slice(1))
  const parts = base.split('/').slice(0, -1)
  for (const piece of decodeURIComponent(clean).split('/')) {
    if (piece === '' || piece === '.') continue
    if (piece === '..') parts.pop()
    else parts.push(piece)
  }
  return parts.join('/')
}

/**
 * A zip is case-sensitive and some producers are not.
 *
 * Worth the fallback rather than worth an argument: an EPUB whose OPF says
 * `Text/chapter1.xhtml` and whose zip says `text/chapter1.xhtml` is a book
 * somebody owns, and refusing it teaches them nothing.
 */
function find(entries: Map<string, ZipEntry>, path: string): ZipEntry | undefined {
  const direct = entries.get(path)
  if (direct) return direct
  const wanted = path.toLowerCase()
  for (const [name, entry] of entries) if (name.toLowerCase() === wanted) return entry
  return undefined
}

function parseXml(text: string, kind: DOMParserSupportedType): Document {
  const doc = new DOMParser().parseFromString(text, kind)
  if (doc.querySelector('parsererror')) {
    // XHTML in the wild is frequently not well-formed. HTML parsing never
    // fails, so a strict pass that trips is retried leniently rather than
    // costing somebody their book.
    if (kind !== 'text/html') return new DOMParser().parseFromString(text, 'text/html')
    throw new EpubError('this file is not readable as markup')
  }
  return doc
}

/** Which tags carry text worth setting, and as what. */
const BLOCK_TAGS: Record<string, BlockKind> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'subheading',
  h4: 'subheading',
  h5: 'subheading',
  h6: 'subheading',
  p: 'paragraph',
  li: 'paragraph',
  dd: 'paragraph',
  dt: 'subheading',
  blockquote: 'quote',
  pre: 'quote',
  figcaption: 'quote',
  td: 'paragraph',
}

const SELECTOR = Object.keys(BLOCK_TAGS).join(',')

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * The text of one document in the spine.
 *
 * A block element whose ancestor is also a block element is skipped, because
 * its text is already inside its ancestor's — otherwise a `<blockquote>` full
 * of `<p>`s is set twice, once as a quote and once as prose.
 */
function harvest(doc: Document): Block[] {
  const body = doc.body ?? doc.documentElement
  if (!body) return []

  const found = [...body.querySelectorAll(SELECTOR)]
  const matched = new Set<Element>(found)
  const blocks: Block[] = []

  for (const element of found) {
    let ancestor = element.parentElement
    let nested = false
    while (ancestor) {
      if (matched.has(ancestor)) {
        nested = true
        break
      }
      ancestor = ancestor.parentElement
    }
    if (nested) continue

    const text = tidy(element.textContent ?? '')
    if (!text) {
      // An empty paragraph is usually a spacer, and a page of them is a page of
      // nothing. A picture, though, is a place in the book where something was.
      const image = element.querySelector('img')
      const alt = tidy(image?.getAttribute('alt') ?? '')
      if (alt) blocks.push({ kind: 'quote', text: `[${alt}]` })
      continue
    }
    blocks.push({ kind: BLOCK_TAGS[element.tagName.toLowerCase()] ?? 'paragraph', text })
  }

  // A document made entirely of bare `<div>`s produces nothing above. Falling
  // back to the whole body's text is crude and is still the book.
  if (blocks.length === 0) {
    const whole = tidy(body.textContent ?? '')
    if (whole) blocks.push({ kind: 'paragraph', text: whole })
  }

  return blocks
}

/** Read an EPUB into blocks. Throws `EpubError` with something a person can act on. */
export async function parseEpub(bytes: Uint8Array): Promise<EpubBook> {
  let entries: Map<string, ZipEntry>
  try {
    entries = openZip(bytes)
  } catch (e) {
    throw new EpubError(e instanceof ZipError ? e.message : 'this file is not a zip archive')
  }

  const containerEntry = find(entries, 'META-INF/container.xml')
  if (!containerEntry) throw new EpubError('no META-INF/container.xml — this is not an EPUB')

  const container = parseXml(await readText(bytes, containerEntry), 'application/xml')
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new EpubError('its container names no package document')

  const opfEntry = find(entries, decodeURIComponent(opfPath))
  if (!opfEntry) throw new EpubError(`its package document (${opfPath}) is missing from the archive`)
  const opf = parseXml(await readText(bytes, opfEntry), 'application/xml')

  const title = tidy(opf.getElementsByTagName('dc:title')[0]?.textContent ?? '') || null
  const author = tidy(opf.getElementsByTagName('dc:creator')[0]?.textContent ?? '') || null

  // href by manifest id, so the spine's idrefs can be followed.
  const manifest = new Map<string, { href: string; type: string }>()
  for (const item of opf.getElementsByTagName('item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, { href, type: item.getAttribute('media-type') ?? '' })
  }

  const spine = [...opf.getElementsByTagName('itemref')]
    .map((ref) => ref.getAttribute('idref'))
    .filter((id): id is string => id !== null)
  if (spine.length === 0) throw new EpubError('its spine is empty — there is nothing to read')

  const blocks: Block[] = []
  for (const id of spine) {
    const item = manifest.get(id)
    if (!item) continue
    // Anything that is not markup is not text: a cover image in the spine is a
    // legitimate thing for an EPUB to have and nothing for this to do with.
    if (item.type && !/xhtml|html|xml/.test(item.type)) continue

    const entry = find(entries, resolve(decodeURIComponent(opfPath), item.href))
    if (!entry) continue

    let harvested: Block[]
    try {
      const text = new TextDecoder('utf-8').decode(await readEntry(bytes, entry))
      harvested = harvest(parseXml(text, 'application/xhtml+xml'))
    } catch {
      // One unreadable chapter is a gap, not a book that will not open — the
      // same argument the indexer makes for catching a per-file panic.
      continue
    }

    const first = harvested[0]
    if (first) {
      first.fresh = true
      blocks.push(...harvested)
    }
  }

  if (blocks.length === 0) throw new EpubError('there is no text in this EPUB that can be set')

  return { title, author, blocks }
}
