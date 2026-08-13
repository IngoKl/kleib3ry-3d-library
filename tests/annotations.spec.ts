import { expect, test } from '@playwright/test'
import { pageToSpread, spreadToPage } from '../src/data/pageNumbers'
import { composeAnnotationsMarkdown } from '../src/data/annotationsMarkdown'
import type { AnnotationsDocument } from '../src/services/types'

/**
 * The annotations file's arithmetic and its prose form.
 *
 * These run in the browser project because the source is TypeScript modules
 * Playwright transpiles; none of them need a page. The conversions matter
 * because they are the file boundary: get one wrong by a page and every
 * bookmark in `annotations.json` drifts a spread on the next launch.
 */

test('a spread externalises as its recto and converts back to itself', () => {
  // Spread s shows pages 2s and 2s+1; the file records the recto.
  expect(spreadToPage(0, 12)).toBe(1)
  expect(spreadToPage(1, 12)).toBe(3)
  expect(spreadToPage(5, 12)).toBe(11)

  for (let spread = 0; spread <= 6; spread++) {
    expect(pageToSpread(spreadToPage(spread, 400))).toBe(spread)
  }
})

test('the last spread of an even-paged book clamps and still round-trips', () => {
  // A 12-page book's last spread is 6, whose recto (13) does not exist. The
  // clamp writes page 12 — and floor(12 / 2) is 6 again.
  expect(spreadToPage(6, 12)).toBe(12)
  expect(pageToSpread(spreadToPage(6, 12))).toBe(6)
})

test('a book with no page count externalises unclamped', () => {
  // An EPUB is not paginated until it is opened, so the index has no count and
  // the recto is taken on trust. One page past a real end is round-trip safe.
  expect(spreadToPage(6, null)).toBe(13)
  expect(pageToSpread(13)).toBe(6)
})

test('the markdown digest reads by title, with pages, dates and authors', () => {
  const doc: AnnotationsDocument = {
    schemaVersion: 1,
    books: {
      bbb: {
        title: 'Zettel',
        author: null,
        notes: [
          { id: 'n1', page: 45, text: 'check the colophon', created: '2026-08-13T10:12:00.000Z' },
        ],
      },
      aaa: {
        title: 'The Shelf as Argument',
        author: 'A. Sample',
        bookmarks: [1, 45, 203],
        drawings: { '7': [{ ink: 1, points: [0.1, 0.2, 0.3, 0.4] }], '3': [{ ink: 1, points: [0, 0] }] },
      },
      empty: { title: 'Nothing In It', author: null },
    },
  }

  const md = composeAnnotationsMarkdown(doc, new Date('2026-08-13T12:00:00Z'))

  expect(md).toContain('# Annotations')
  expect(md).toContain('Exported 2026-08-13.')
  expect(md).toContain('## The Shelf as Argument — A. Sample')
  expect(md).toContain('Bookmarks: p. 1, p. 45, p. 203')
  // Ink is not prose, but where it is can be — pages in order, not key order.
  expect(md).toContain('Drawings on p. 3, p. 7.')
  // No author: no dangling dash after the title.
  expect(md).toContain('## Zettel\n')
  expect(md).toContain('- **p. 45** (2026-08-13) — check the colophon')
  // A book with nothing in it says nothing.
  expect(md).not.toContain('Nothing In It')
  // Ordered by title, not by id.
  expect(md.indexOf('The Shelf as Argument')).toBeLessThan(md.indexOf('Zettel'))
})
