/**
 * Just enough ZIP to open an EPUB: the central directory, stored entries, and
 * deflate through the platform's own `DecompressionStream('deflate-raw')`.
 *
 * No dependency, deliberately. A zip library would add a hundred kilobytes and
 * a licence for the parts of the format an e-book never uses — spanning,
 * encryption, zip64.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export type ZipEntry = {
  name: string
  /** 0 for stored, 8 for deflate. Anything else is refused by name. */
  method: number
  /** Offset of the *local* header, which is where the data actually is. */
  header: number
  compressedSize: number
  size: number
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * The central directory, by name.
 *
 * Read from the end backwards, which is how a zip is meant to be read: the
 * directory at the end is authoritative and the local headers are a
 * convenience. Reading the local headers forwards instead is how you end up
 * fooled by a file that has been appended to.
 */
export function openZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The end-of-directory record is at the very end unless there is a comment,
  // and a comment is at most 64 KiB.
  let eocd = -1
  const earliest = Math.max(0, bytes.length - 0x10000 - 22)
  for (let at = bytes.length - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new ZipError('not a zip file — no end-of-directory record')

  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)

  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntry>()

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError(`corrupt central directory at entry ${i}`)
    }
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const header = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))

    entries.set(name, { name, method, header, compressedSize, size })
    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** The bytes of one entry, decompressed. */
export async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The offset came out of the central directory unchecked. A truncated archive
  // points it past the end, where `DataView` would throw a `RangeError` — which
  // reaches the reader as a stack rather than as the sentence this file writes
  // for every other way an archive can be wrong.
  if (entry.header + 30 > bytes.length) {
    throw new ZipError(`${entry.name}: its local header is past the end of the file`)
  }
  if (view.getUint32(entry.header, true) !== LOCAL_SIGNATURE) {
    throw new ZipError(`${entry.name}: its local header is not where the directory says`)
  }
  // The local header's own name and extra lengths, not the directory's: the two
  // are allowed to differ, and the data begins after the local ones.
  const nameLength = view.getUint16(entry.header + 26, true)
  const extraLength = view.getUint16(entry.header + 28, true)
  const start = entry.header + 30 + nameLength + extraLength
  const raw = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return raw
  if (entry.method !== 8) {
    throw new ZipError(`${entry.name}: compressed with method ${entry.method}, which is not deflate`)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('this browser cannot decompress — DecompressionStream is missing')
  }

  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** An entry as text, which is what every part of an EPUB this reads actually is. */
export async function readText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  return new TextDecoder('utf-8').decode(await readEntry(bytes, entry))
}
