import type { AnnotationsDocument } from '../services/types'

/**
 * A Markdown digest of every bookmark and note, ordered by title, for reading
 * anywhere that is not the app. Pure — the date is an argument — so it tests.
 */
export function composeAnnotationsMarkdown(doc: AnnotationsDocument, exportedAt: Date): string {
  const lines: string[] = ['# Annotations', '', `Exported ${exportedAt.toISOString().slice(0, 10)}.`]

  const entries = Object.values(doc.books).sort((a, b) => a.title.localeCompare(b.title))
  for (const entry of entries) {
    const marks = entry.bookmarks ?? []
    const notes = entry.notes ?? []
    // Ink cannot be prose, but where it is can: the digest says which pages
    // carry a drawing so the reader knows to open the book there.
    const inked = Object.entries(entry.drawings ?? {})
      .filter(([, strokes]) => strokes.length)
      .map(([page]) => Number(page))
      .sort((a, b) => a - b)
    if (!marks.length && !notes.length && !inked.length) continue

    lines.push('', entry.author ? `## ${entry.title} — ${entry.author}` : `## ${entry.title}`)
    if (marks.length) {
      lines.push('', `Bookmarks: ${marks.map((page) => `p. ${page}`).join(', ')}`)
    }
    if (inked.length) {
      lines.push('', `Drawings on ${inked.map((page) => `p. ${page}`).join(', ')}.`)
    }
    if (notes.length) {
      lines.push('')
      for (const note of notes) {
        lines.push(`- **p. ${note.page}** (${note.created.slice(0, 10)}) — ${note.text}`)
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}
