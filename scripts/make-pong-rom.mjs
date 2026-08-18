/**
 * The one real ROM the browser driver can boot. Without it the whole arcade path
 * — cartridge, slot, boot, screen — is only exercised against a real library
 * folder; this puts it inside `npm test`, as the sample book does the reader.
 *
 * Generated rather than committed, so the repo stays text-only. (The copy in the
 * demo library is committed, with the rest of that library's media.)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPongRom } from './lib/make-chip8.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'roms', 'pong.ch8')

const rom = buildPongRom()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, rom)
console.log(`wrote ${out} (${rom.length} bytes)`)
