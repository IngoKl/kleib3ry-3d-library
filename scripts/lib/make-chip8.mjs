/**
 * Assembles the demo Pong ROM for the arcade cabinet.
 *
 * A CHIP-8 game is a few hundred bytes of 1977-shaped bytecode, and shipping
 * one as demo data means either finding a freeware binary of unclear ancestry
 * or writing our own. This is our own: a two-pass assembler small enough to
 * read, and a Pong under it — left paddle is yours (CHIP-8 keys 5/8, which the
 * cabinet maps to W/S), right paddle is a deliberately beatable machine that
 * only reacts every other frame. First to ten wipes the board.
 *
 * Shared by `make-pong-rom.mjs` (which `npm run assets` runs, for `public/`),
 * `make-test-library.mjs` (the desktop probe's corpus) and `tests/chip8.spec.ts`
 * — which runs the ROM for real on the interpreter in src/arcade/chip8.ts.
 */

/**
 * Two passes: lay the bytes down with holes where labels are named, then fill
 * the holes once every label has an address. Programs load at 0x200.
 */
function assembler() {
  const bytes = []
  const labels = new Map()
  const holes = [] // { at, label, kind: 'jp' | 'call' | 'ldi' }

  const word = (w) => bytes.push((w >> 8) & 0xff, w & 0xff)
  const hole = (kind, label) => {
    holes.push({ at: bytes.length, label, kind })
    bytes.push(0, 0)
  }

  const a = {
    label: (name) => {
      if (labels.has(name)) throw new Error(`label ${name} defined twice`)
      labels.set(name, 0x200 + bytes.length)
    },
    db: (...values) => bytes.push(...values),

    cls: () => word(0x00e0),
    ret: () => word(0x00ee),
    jp: (label) => hole('jp', label),
    call: (label) => hole('call', label),
    /** Skip the next instruction if VX == nn. */
    se: (x, nn) => word(0x3000 | (x << 8) | nn),
    /** Skip the next instruction if VX != nn. */
    sne: (x, nn) => word(0x4000 | (x << 8) | nn),
    ld: (x, nn) => word(0x6000 | (x << 8) | nn),
    add: (x, nn) => word(0x7000 | (x << 8) | nn),
    ldr: (x, y) => word(0x8000 | (x << 8) | (y << 4)),
    xor: (x, y) => word(0x8003 | (x << 8) | (y << 4)),
    addr: (x, y) => word(0x8004 | (x << 8) | (y << 4)),
    /** VX -= VY, and VF = 1 exactly when there was no borrow (VX >= VY). */
    sub: (x, y) => word(0x8005 | (x << 8) | (y << 4)),
    ldi: (label) => hole('ldi', label),
    rnd: (x, nn) => word(0xc000 | (x << 8) | nn),
    drw: (x, y, n) => word(0xd000 | (x << 8) | (y << 4) | n),
    /** Skip the next instruction if the key named by VX is up. */
    sknp: (x) => word(0xe0a1 | (x << 8)),
    readDelay: (x) => word(0xf007 | (x << 8)),
    setDelay: (x) => word(0xf015 | (x << 8)),
    setSound: (x) => word(0xf018 | (x << 8)),
    /** Point I at the built-in sprite for the digit in VX. */
    font: (x) => word(0xf029 | (x << 8)),

    assemble: () => {
      for (const { at, label, kind } of holes) {
        const target = labels.get(label)
        if (target === undefined) throw new Error(`label ${label} is never defined`)
        const op = kind === 'jp' ? 0x1000 : kind === 'call' ? 0x2000 : 0xa000
        bytes[at] = ((op | target) >> 8) & 0xff
        bytes[at + 1] = target & 0xff
      }
      return new Uint8Array(bytes)
    },
  }
  return a
}

// Register plan — CHIP-8 has sixteen and Pong needs most of them:
// V1/V2 ball position, V3/V4 ball velocity (0x01 or 0xff, i.e. ±1),
// V5/V6 the two paddle tops, V7/V8 the two scores, V9 the AI's frame parity,
// V0/VA/VB scratch. VF belongs to the machine (borrow and collision flags).
const [V0, V1, V2, V3, V4, V5, V6, V7, V8, V9, VA, VB] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const VF = 15

const PADDLE_HEIGHT = 6
const PADDLE_TOP_MAX = 32 - PADDLE_HEIGHT
const KEY_UP = 5 // W on the cabinet's keyboard mapping
const KEY_DOWN = 8 // S

export function buildPongRom() {
  const a = assembler()

  a.ld(V7, 0)
  a.ld(V8, 0)

  // A fresh serve redraws the whole board from nothing — after a point the
  // screen may carry XOR scars where the ball crossed a digit, and a clear
  // costs less than remembering what to repair.
  a.label('newRound')
  a.cls()
  a.call('drawScores')
  a.ld(V5, 13)
  a.ld(V6, 13)
  a.call('drawLeftPaddle')
  a.call('drawRightPaddle')
  a.ld(V1, 32)
  a.ld(V2, 16)
  a.rnd(V3, 1) // serve in a random direction
  a.se(V3, 1)
  a.ld(V3, 0xff)
  a.rnd(V4, 1)
  a.se(V4, 1)
  a.ld(V4, 0xff)
  a.call('drawBall')

  // One game tick per delay-timer tick, which is how a CHIP-8 game runs at a
  // chosen speed on any interpreter: the timer is 60 Hz everywhere.
  a.label('loop')
  a.ld(V0, 1)
  a.setDelay(V0)
  a.label('waitFrame')
  a.readDelay(V0)
  a.se(V0, 0)
  a.jp('waitFrame')

  a.ld(VA, KEY_UP)
  a.sknp(VA)
  a.call('leftUp')
  a.ld(VA, KEY_DOWN)
  a.sknp(VA)
  a.call('leftDown')

  // The machine's paddle chases the ball's row, but only every other tick —
  // half your speed is what makes it beatable.
  a.ld(VB, 1)
  a.xor(V9, VB)
  a.se(V9, 1)
  a.jp('moveBall')
  a.ldr(VB, V6)
  a.add(VB, 2) // roughly the paddle's centre
  a.sub(VB, V2)
  a.se(VF, 1)
  a.jp('aiDown')
  a.call('rightUp')
  a.jp('moveBall')
  a.label('aiDown')
  a.call('rightDown')

  // Erase, move, bounce, redraw. The XOR display makes erasing and drawing the
  // same instruction.
  a.label('moveBall')
  a.call('drawBall')
  a.addr(V1, V3)
  a.addr(V2, V4)
  a.sne(V2, 0xff) // 0 - 1 wrapped: it left through the top
  a.call('bounceTop')
  a.sne(V2, 32) // one past the bottom row
  a.call('bounceBottom')
  a.sne(V1, 0) // the left paddle's column
  a.jp('leftWall')
  a.sne(V1, 63) // the right paddle's column
  a.jp('rightWall')
  a.label('afterWalls')
  a.call('drawBall')
  a.jp('loop')

  a.label('bounceTop')
  a.ld(V2, 1)
  a.ld(V4, 1)
  a.ret()
  a.label('bounceBottom')
  a.ld(V2, 30)
  a.ld(V4, 0xff)
  a.ret()

  // At a paddle column: bounce if the ball's row is within the six the paddle
  // covers, otherwise the other side scores. Both tests are the same trick —
  // subtract and read the borrow flag, CHIP-8's only comparison.
  a.label('leftWall')
  a.ldr(VB, V2)
  a.sub(VB, V5)
  a.se(VF, 1)
  a.jp('rightScores') // ball above the paddle's top
  a.ld(VA, PADDLE_HEIGHT - 1)
  a.sub(VA, VB)
  a.se(VF, 1)
  a.jp('rightScores') // ball below the paddle's bottom
  a.ld(V3, 1)
  a.ld(V1, 1)
  a.ld(V0, 2)
  a.setSound(V0)
  a.jp('afterWalls')

  a.label('rightScores')
  a.add(V8, 1)
  a.jp('pointScored')

  a.label('rightWall')
  a.ldr(VB, V2)
  a.sub(VB, V6)
  a.se(VF, 1)
  a.jp('leftScores')
  a.ld(VA, PADDLE_HEIGHT - 1)
  a.sub(VA, VB)
  a.se(VF, 1)
  a.jp('leftScores')
  a.ld(V3, 0xff)
  a.ld(V1, 62)
  a.ld(V0, 2)
  a.setSound(V0)
  a.jp('afterWalls')

  a.label('leftScores')
  a.add(V7, 1)
  a.label('pointScored')
  a.ld(V0, 8)
  a.setSound(V0)
  a.sne(V7, 10)
  a.jp('resetScores')
  a.sne(V8, 10)
  a.jp('resetScores')
  a.jp('newRound')
  a.label('resetScores')
  a.ld(V7, 0)
  a.ld(V8, 0)
  a.jp('newRound')

  // The four paddle moves: refuse at the edge, then erase, shift a row, redraw.
  a.label('leftUp')
  a.sne(V5, 0)
  a.ret()
  a.call('drawLeftPaddle')
  a.add(V5, 0xff)
  a.call('drawLeftPaddle')
  a.ret()
  a.label('leftDown')
  a.sne(V5, PADDLE_TOP_MAX)
  a.ret()
  a.call('drawLeftPaddle')
  a.add(V5, 1)
  a.call('drawLeftPaddle')
  a.ret()
  a.label('rightUp')
  a.sne(V6, 0)
  a.ret()
  a.call('drawRightPaddle')
  a.add(V6, 0xff)
  a.call('drawRightPaddle')
  a.ret()
  a.label('rightDown')
  a.sne(V6, PADDLE_TOP_MAX)
  a.ret()
  a.call('drawRightPaddle')
  a.add(V6, 1)
  a.call('drawRightPaddle')
  a.ret()

  a.label('drawLeftPaddle')
  a.ld(VA, 0)
  a.ldi('paddle')
  a.drw(VA, V5, PADDLE_HEIGHT)
  a.ret()
  a.label('drawRightPaddle')
  a.ld(VA, 63)
  a.ldi('paddle')
  a.drw(VA, V6, PADDLE_HEIGHT)
  a.ret()
  a.label('drawBall')
  a.ldi('ball')
  a.drw(V1, V2, 1)
  a.ret()

  a.label('drawScores')
  a.ld(VA, 24)
  a.ld(VB, 0)
  a.font(V7)
  a.drw(VA, VB, 5)
  a.ld(VA, 36)
  a.font(V8)
  a.drw(VA, VB, 5)
  a.ret()

  a.label('paddle')
  a.db(0x80, 0x80, 0x80, 0x80, 0x80, 0x80)
  a.label('ball')
  a.db(0x80)

  return a.assemble()
}

