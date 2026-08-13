/**
 * A CHIP-8 interpreter, whole, in one file.
 *
 * CHIP-8 is not a console but a tiny virtual machine from 1977 — thirty-five
 * two-byte instructions, 4 KiB of memory, sixteen registers, a 64×32 one-bit
 * screen and a sixteen-key pad — which is exactly why it is the machine in the
 * arcade cabinet: the whole of it fits in a file you can read top to bottom,
 * and a game for it is a few hundred bytes in `roms/ch8`.
 *
 * Nothing here knows about textures, keyboards or audio. The machine is a
 * plain mutable object stepped from outside — the cabinet renders `screen`,
 * feeds `keys`, and listens to `soundTimer` — the same shape as `drop.ts`:
 * per-frame state deliberately outside any store, because it changes hundreds
 * of times a second and must never trigger a React render.
 *
 * Where the original COSMAC VIP and later interpreters disagree (the shift and
 * load/store instructions, mostly), this one takes the modern behaviour that
 * the widely-shared test ROMs expect: shifts operate on VX alone, and FX55/FX65
 * leave I unchanged. The bundled Pong avoids the ambiguous forms entirely.
 */

export const SCREEN_WIDTH = 64
export const SCREEN_HEIGHT = 32

/** Programs start here; below is historically the interpreter's own memory. */
const PROGRAM_START = 0x200
/** Where the built-in font lives. Anywhere under 0x200 would do; 0x50 is customary. */
const FONT_START = 0x50
const MEMORY_SIZE = 4096

/** The hexadecimal digits 0–F as 4×5 sprites, straight from the VIP manual. */
// prettier-ignore
const FONT = [
  0xf0, 0x90, 0x90, 0x90, 0xf0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xf0, 0x10, 0xf0, 0x80, 0xf0, // 2
  0xf0, 0x10, 0xf0, 0x10, 0xf0, // 3
  0x90, 0x90, 0xf0, 0x10, 0x10, // 4
  0xf0, 0x80, 0xf0, 0x10, 0xf0, // 5
  0xf0, 0x80, 0xf0, 0x90, 0xf0, // 6
  0xf0, 0x10, 0x20, 0x40, 0x40, // 7
  0xf0, 0x90, 0xf0, 0x90, 0xf0, // 8
  0xf0, 0x90, 0xf0, 0x10, 0xf0, // 9
  0xf0, 0x90, 0xf0, 0x90, 0x90, // A
  0xe0, 0x90, 0xe0, 0x90, 0xe0, // B
  0xf0, 0x80, 0x80, 0x80, 0xf0, // C
  0xe0, 0x90, 0x90, 0x90, 0xe0, // D
  0xf0, 0x80, 0xf0, 0x80, 0xf0, // E
  0xf0, 0x80, 0xf0, 0x80, 0x80, // F
]

export type Chip8 = {
  memory: Uint8Array
  /** V0–VF. VF doubles as the carry, borrow and collision flag. */
  v: Uint8Array
  /** The address register, twelve bits wide in practice. */
  i: number
  pc: number
  /** Return addresses only — CHIP-8 has calls but no data stack. */
  stack: number[]
  /** Both timers count down at 60 Hz; the game reads delay, you hear sound. */
  delayTimer: number
  soundTimer: number
  /** One byte per pixel, 0 or 1, row-major. Drawing XORs sprites onto it. */
  screen: Uint8Array
  /** The sixteen-key pad, indexed by CHIP-8 digit, held-down state. */
  keys: boolean[]
  /**
   * FX0A parks the destination register here and the machine stands still —
   * cheaper than replaying the instruction — until `pressKey` delivers one.
   */
  waitingRegister: number | null
  /** Set on a bad opcode or an overrun; the cabinet shows it rather than looping. */
  halted: boolean
  /** Injected so tests can make CXNN deterministic. Returns [0, 1). */
  random: () => number
}

export class RomError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RomError'
  }
}

export function createChip8(rom: Uint8Array, random: () => number = Math.random): Chip8 {
  if (rom.length === 0) throw new RomError('the ROM is empty')
  if (rom.length > MEMORY_SIZE - PROGRAM_START) {
    throw new RomError(`the ROM is ${rom.length} bytes and only ${MEMORY_SIZE - PROGRAM_START} fit`)
  }

  const memory = new Uint8Array(MEMORY_SIZE)
  memory.set(FONT, FONT_START)
  memory.set(rom, PROGRAM_START)

  return {
    memory,
    v: new Uint8Array(16),
    i: 0,
    pc: PROGRAM_START,
    stack: [],
    delayTimer: 0,
    soundTimer: 0,
    screen: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT),
    keys: new Array(16).fill(false),
    waitingRegister: null,
    halted: false,
    random,
  }
}

/**
 * Advance both timers by one tick. Called at 60 Hz by whoever owns the clock —
 * the timers belong to the display's cadence, not the CPU's, which is why this
 * is not part of `step`.
 */
export function tickTimers(chip: Chip8) {
  if (chip.delayTimer > 0) chip.delayTimer--
  if (chip.soundTimer > 0) chip.soundTimer--
}

/**
 * A key going down, routed here rather than written straight into `keys` so
 * that a machine parked on FX0A wakes up. Key releases can just clear `keys`.
 */
export function pressKey(chip: Chip8, key: number) {
  chip.keys[key] = true
  if (chip.waitingRegister !== null) {
    chip.v[chip.waitingRegister] = key
    chip.waitingRegister = null
  }
}

/**
 * One frame's worth of machine: a batch of instructions, then a timer tick.
 * ~11 instructions per 60 Hz frame is the speed the original ran at; the games
 * were tuned to it, so it is the default rather than "as fast as possible".
 */
export function runFrame(chip: Chip8, instructions = 11) {
  for (let i = 0; i < instructions; i++) step(chip)
  tickTimers(chip)
}

/** Fetch, decode and execute exactly one instruction. */
export function step(chip: Chip8) {
  if (chip.halted || chip.waitingRegister !== null) return
  if (chip.pc < 0 || chip.pc + 1 >= MEMORY_SIZE) {
    chip.halted = true
    return
  }

  const memoryAtPc = chip.memory[chip.pc]
  const memoryAfterPc = chip.memory[chip.pc + 1]
  const opcode = ((memoryAtPc ?? 0) << 8) | (memoryAfterPc ?? 0)
  chip.pc += 2

  // The nibbles every instruction is built from: _XY_ name registers,
  // NNN is an address, NN and N are literals.
  const x = (opcode >> 8) & 0xf
  const y = (opcode >> 4) & 0xf
  const nnn = opcode & 0xfff
  const nn = opcode & 0xff
  const n = opcode & 0xf
  const vx = chip.v[x] ?? 0
  const vy = chip.v[y] ?? 0

  switch (opcode >> 12) {
    case 0x0:
      if (opcode === 0x00e0) {
        chip.screen.fill(0)
      } else if (opcode === 0x00ee) {
        const returnTo = chip.stack.pop()
        if (returnTo === undefined) chip.halted = true
        else chip.pc = returnTo
      } else {
        // 0NNN ran native RCA 1802 code on the VIP. No ROM worth running uses it.
        chip.halted = true
      }
      return
    case 0x1:
      chip.pc = nnn
      return
    case 0x2:
      chip.stack.push(chip.pc)
      chip.pc = nnn
      return
    case 0x3:
      if (vx === nn) chip.pc += 2
      return
    case 0x4:
      if (vx !== nn) chip.pc += 2
      return
    case 0x5:
      if (n !== 0) chip.halted = true
      else if (vx === vy) chip.pc += 2
      return
    case 0x6:
      chip.v[x] = nn
      return
    case 0x7:
      chip.v[x] = (vx + nn) & 0xff
      return
    case 0x8:
      // The arithmetic family. VF is written *after* the operation reads its
      // operands, so `8XF4`-style uses of the flag register still work.
      switch (n) {
        case 0x0:
          chip.v[x] = vy
          return
        case 0x1:
          chip.v[x] = vx | vy
          return
        case 0x2:
          chip.v[x] = vx & vy
          return
        case 0x3:
          chip.v[x] = vx ^ vy
          return
        case 0x4: {
          const sum = vx + vy
          chip.v[x] = sum & 0xff
          chip.v[0xf] = sum > 0xff ? 1 : 0
          return
        }
        case 0x5:
          chip.v[x] = (vx - vy) & 0xff
          chip.v[0xf] = vx >= vy ? 1 : 0
          return
        case 0x6:
          chip.v[x] = vx >> 1
          chip.v[0xf] = vx & 1
          return
        case 0x7:
          chip.v[x] = (vy - vx) & 0xff
          chip.v[0xf] = vy >= vx ? 1 : 0
          return
        case 0xe:
          chip.v[x] = (vx << 1) & 0xff
          chip.v[0xf] = vx >> 7
          return
        default:
          chip.halted = true
          return
      }
    case 0x9:
      if (n !== 0) chip.halted = true
      else if (vx !== vy) chip.pc += 2
      return
    case 0xa:
      chip.i = nnn
      return
    case 0xb:
      chip.pc = (nnn + (chip.v[0] ?? 0)) & 0xfff
      return
    case 0xc:
      chip.v[x] = Math.floor(chip.random() * 256) & nn
      return
    case 0xd:
      draw(chip, vx, vy, n)
      return
    case 0xe:
      if (nn === 0x9e) {
        if (chip.keys[vx & 0xf]) chip.pc += 2
      } else if (nn === 0xa1) {
        if (!chip.keys[vx & 0xf]) chip.pc += 2
      } else {
        chip.halted = true
      }
      return
    case 0xf:
      switch (nn) {
        case 0x07:
          chip.v[x] = chip.delayTimer
          return
        case 0x0a:
          chip.waitingRegister = x
          return
        case 0x15:
          chip.delayTimer = vx
          return
        case 0x18:
          chip.soundTimer = vx
          return
        case 0x1e:
          chip.i = (chip.i + vx) & 0xfff
          return
        case 0x29:
          chip.i = FONT_START + (vx & 0xf) * 5
          return
        case 0x33:
          // Binary-coded decimal: the only way a CHIP-8 game prints a score.
          chip.memory[chip.i] = Math.floor(vx / 100)
          chip.memory[chip.i + 1] = Math.floor(vx / 10) % 10
          chip.memory[chip.i + 2] = vx % 10
          return
        case 0x55:
          for (let r = 0; r <= x; r++) chip.memory[(chip.i + r) & 0xfff] = chip.v[r] ?? 0
          return
        case 0x65:
          for (let r = 0; r <= x; r++) chip.v[r] = chip.memory[(chip.i + r) & 0xfff] ?? 0
          return
        default:
          chip.halted = true
          return
      }
    default:
      chip.halted = true
  }
}

/**
 * DXYN: XOR an 8×N sprite onto the screen and raise VF if any lit pixel went
 * out — that flag *is* CHIP-8 collision detection, which is why Pong needs no
 * geometry to know the ball met a paddle. Sprites start wrapped (drawing at
 * x=68 means x=4) but clip at the edges rather than wrapping around, which is
 * what the original display did and what the games expect.
 */
function draw(chip: Chip8, originX: number, originY: number, rows: number) {
  const startX = originX % SCREEN_WIDTH
  const startY = originY % SCREEN_HEIGHT
  chip.v[0xf] = 0

  for (let row = 0; row < rows; row++) {
    const py = startY + row
    if (py >= SCREEN_HEIGHT) break
    const sprite = chip.memory[(chip.i + row) & 0xfff] ?? 0
    for (let bit = 0; bit < 8; bit++) {
      if (!((sprite >> (7 - bit)) & 1)) continue
      const px = startX + bit
      if (px >= SCREEN_WIDTH) break
      const at = py * SCREEN_WIDTH + px
      if (chip.screen[at]) chip.v[0xf] = 1
      chip.screen[at] = chip.screen[at] ? 0 : 1
    }
  }
}
