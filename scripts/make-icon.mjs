// Generates the 1024x1024 source PNG that `tauri icon` expands into the
// platform icon set. Hand-rolled encoder so the repo stays text-only and the
// icon is regenerable rather than an opaque binary someone has to re-draw.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/icon-source.png')

const px = new Uint8Array(SIZE * SIZE * 4)

function fill(x0, y0, w, h, [r, g, b, a = 255]) {
  const xs = Math.max(0, Math.round(x0))
  const ys = Math.max(0, Math.round(y0))
  const xe = Math.min(SIZE, Math.round(x0 + w))
  const ye = Math.min(SIZE, Math.round(y0 + h))
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const i = (y * SIZE + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = a
    }
  }
}

/** A spine leaning slightly, drawn as a column of shifted rows. */
function spine(x, top, width, height, color, lean = 0) {
  for (let y = 0; y < height; y++) {
    const t = y / height
    fill(x + lean * (1 - t), top + y, width, 1, color)
  }
}

const BG = [32, 24, 15]
const SHELF = [122, 86, 54]
const PAPER = [236, 229, 216]

fill(0, 0, SIZE, SIZE, BG)

// Two shelves with books standing on them.
const shelves = [
  { y: 470, books: [[0xe8, 0xc1, 0x69], [0xc4, 0x6b, 0x4f], [0xec, 0xe5, 0xd8], [0x6f, 0x9b, 0x9c]] },
  { y: 830, books: [[0x8d, 0x9e, 0x6a], [0xec, 0xe5, 0xd8], [0xc4, 0x6b, 0x4f], [0x7a, 0x6f, 0xa8]] },
]

for (const { y, books } of shelves) {
  const boardTop = y
  fill(140, boardTop, SIZE - 280, 34, SHELF)

  let x = 190
  books.forEach((color, i) => {
    const width = 78 + ((i * 37) % 46)
    const height = 210 + ((i * 53) % 90)
    const lean = i === books.length - 1 ? 34 : 0
    spine(x, boardTop - height, width, height, color, lean)
    // A lighter band near the head of each spine, like a title panel.
    fill(x + 12 + lean * 0.4, boardTop - height + 40, width - 24, 26, PAPER)
    x += width + 22
  })
}

// ---- PNG encoding ------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // truecolour with alpha
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

// Each scanline is prefixed with its filter type; 0 (none) is plenty here.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  const from = y * SIZE * 4
  raw[y * (SIZE * 4 + 1)] = 0
  Buffer.from(px.buffer, from, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`wrote ${OUT} (${png.length} bytes)`)
