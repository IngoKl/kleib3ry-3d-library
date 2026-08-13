/**
 * Writes the one real ROM the browser driver can boot: the assembled Pong.
 *
 * Without it the no-filesystem driver has no runnable game at all, so the
 * whole arcade path — cartridge, slot, boot, screen — is only ever exercised
 * against a real library folder. This puts it inside `npm test`, exactly as
 * the sample book does for the reader.
 *
 * Generated rather than committed, like the sample book beside it: the repo
 * stays text-only. (The copy in `demo-data/demo-library/roms/ch8/` *is*
 * committed, with the rest of that library's media.)
 *
 *   node scripts/make-pong-rom.mjs
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
