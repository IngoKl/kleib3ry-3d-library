import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  createChip8,
  pressKey,
  runFrame,
  step,
  tickTimers,
  type Chip8,
} from '../src/arcade/chip8'

/**
 * The interpreter opcode by opcode, then the bundled Pong run on it for real —
 * which is what proves the assembler, the ROM and the CPU agree with each other.
 * In the browser project for transpilation; none of them need a page.
 */

/** A machine loaded with the given opcode words, deterministic randomness. */
function cpu(words: number[], random: () => number = () => 0.5): Chip8 {
  const bytes = new Uint8Array(words.length * 2)
  words.forEach((word, i) => {
    bytes[i * 2] = (word >> 8) & 0xff
    bytes[i * 2 + 1] = word & 0xff
  })
  return createChip8(bytes, random)
}

const litPixels = (chip: Chip8) => chip.screen.reduce((sum, px) => sum + px, 0)

test.describe('chip8 cpu', () => {
  test('load and add immediates stay inside a byte', () => {
    const chip = cpu([0x6a10, 0x7a05, 0x6bff, 0x7b02])
    step(chip)
    step(chip)
    expect(chip.v[10]).toBe(0x15)
    step(chip)
    step(chip)
    // 7XNN wraps and deliberately never touches VF.
    expect(chip.v[11]).toBe(0x01)
    expect(chip.v[0xf]).toBe(0)
  })

  test('arithmetic sets the flag after the operation, not before', () => {
    const add = cpu([0x60c8, 0x61c8, 0x8014])
    for (let i = 0; i < 3; i++) step(add)
    expect(add.v[0]).toBe(0x90)
    expect(add.v[0xf]).toBe(1)

    const sub = cpu([0x6005, 0x6107, 0x8015])
    for (let i = 0; i < 3; i++) step(sub)
    expect(sub.v[0]).toBe(0xfe)
    expect(sub.v[0xf]).toBe(0) // borrowed

    const subn = cpu([0x6005, 0x6107, 0x8017])
    for (let i = 0; i < 3; i++) step(subn)
    expect(subn.v[0]).toBe(0x02)
    expect(subn.v[0xf]).toBe(1) // no borrow
  })

  test('shifts operate on vx alone and report the lost bit', () => {
    const right = cpu([0x6005, 0x8006])
    step(right)
    step(right)
    expect(right.v[0]).toBe(2)
    expect(right.v[0xf]).toBe(1)

    const left = cpu([0x6081, 0x800e])
    step(left)
    step(left)
    expect(left.v[0]).toBe(2)
    expect(left.v[0xf]).toBe(1)
  })

  test('skips take the branch exactly when they should', () => {
    // 3XNN equal: skips the halt-inducing 0x0000 and lands on 6105.
    const chip = cpu([0x6007, 0x3007, 0x0000, 0x6105])
    step(chip)
    step(chip)
    step(chip)
    expect(chip.halted).toBe(false)
    expect(chip.v[1]).toBe(5)
  })

  test('call remembers where to return to', () => {
    // call 0x208 -> set V0 -> return -> land past the call.
    const chip = cpu([0x2208, 0x6101, 0x0000, 0x0000, 0x6042, 0x00ee])
    step(chip) // call
    expect(chip.stack).toEqual([0x202])
    step(chip) // V0 = 0x42
    step(chip) // ret
    step(chip) // V1 = 1
    expect(chip.v[0]).toBe(0x42)
    expect(chip.v[1]).toBe(1)
    expect(chip.stack).toEqual([])
  })

  test('returning with an empty stack halts instead of jumping into nowhere', () => {
    const chip = cpu([0x00ee])
    step(chip)
    expect(chip.halted).toBe(true)
  })

  test('an unknown opcode halts the machine', () => {
    const chip = cpu([0xf0ff])
    step(chip)
    expect(chip.halted).toBe(true)
  })

  test('random numbers come from the injected source and are masked', () => {
    const chip = cpu([0xc00f], () => 0xab / 256)
    step(chip)
    expect(chip.v[0]).toBe(0x0b)
  })

  test('bcd spells a register out in decimal', () => {
    const chip = cpu([0x60fe, 0xa300, 0xf033])
    for (let i = 0; i < 3; i++) step(chip)
    expect([chip.memory[0x300], chip.memory[0x301], chip.memory[0x302]]).toEqual([2, 5, 4])
  })

  test('store and load move the low registers through memory', () => {
    const chip = cpu([0x6011, 0x6122, 0x6233, 0xa300, 0xf155, 0x6000, 0x6100, 0xf165])
    for (let i = 0; i < 8; i++) step(chip)
    expect(chip.v[0]).toBe(0x11)
    expect(chip.v[1]).toBe(0x22)
    // V2 was beyond the X of FX55, so memory never saw it.
    expect(chip.memory[0x302]).toBe(0)
  })
})

test.describe('chip8 display', () => {
  test('drawing the same sprite twice erases it and raises the collision flag', () => {
    // I = font "0", draw at (0,0), then again.
    const program = [0x6000, 0xf029, 0xd005, 0xd005]
    const chip = cpu(program)
    for (let i = 0; i < 3; i++) step(chip)
    expect(litPixels(chip)).toBeGreaterThan(0)
    expect(chip.v[0xf]).toBe(0)
    step(chip)
    expect(litPixels(chip)).toBe(0)
    expect(chip.v[0xf]).toBe(1)
  })

  test('a sprite starts wrapped but clips at the edge', () => {
    // Draw the digit 0 (4 wide) with its origin at x=62: two columns fit.
    const chip = cpu([0x603e, 0x6100, 0xf029, 0xd015])
    for (let i = 0; i < 4; i++) step(chip)
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      expect(chip.screen[y * SCREEN_WIDTH]).toBe(0) // nothing wrapped to x=0
    }
    expect(litPixels(chip)).toBeGreaterThan(0)
  })

  test('clear screen clears the screen', () => {
    const chip = cpu([0x6000, 0xf029, 0xd005, 0x00e0])
    for (let i = 0; i < 4; i++) step(chip)
    expect(litPixels(chip)).toBe(0)
  })
})

test.describe('chip8 keypad and timers', () => {
  test('waiting for a key stands the machine still until one arrives', () => {
    const chip = cpu([0xf30a, 0x6101])
    step(chip)
    expect(chip.waitingRegister).toBe(3)
    const before = chip.pc
    step(chip)
    expect(chip.pc).toBe(before) // parked
    pressKey(chip, 0xa)
    expect(chip.v[3]).toBe(0xa)
    step(chip)
    expect(chip.v[1]).toBe(1)
  })

  test('skip-if-key reads the pad', () => {
    const chip = cpu([0x6005, 0xe09e, 0x0000, 0x6101])
    chip.keys[5] = true
    for (let i = 0; i < 3; i++) step(chip)
    expect(chip.halted).toBe(false)
    expect(chip.v[1]).toBe(1)
  })

  test('both timers count down to zero and stop', () => {
    const chip = cpu([0x0000])
    chip.delayTimer = 2
    chip.soundTimer = 1
    tickTimers(chip)
    tickTimers(chip)
    tickTimers(chip)
    expect(chip.delayTimer).toBe(0)
    expect(chip.soundTimer).toBe(0)
  })
})

test.describe('the bundled pong', () => {
  const romFile = fileURLToPath(
    new URL('../demo-data/demo-library/roms/ch8/pong.ch8', import.meta.url),
  )
  const pong = () => createChip8(new Uint8Array(readFileSync(romFile)), () => 0.25)

  test('it boots, draws a board and keeps running', () => {
    const chip = pong()
    for (let frame = 0; frame < 300; frame++) runFrame(chip, 32)
    expect(chip.halted).toBe(false)
    // Two paddles, a ball and two score digits is a good deal more than ten.
    expect(litPixels(chip)).toBeGreaterThan(10)
    // The scores are printed along the top rows.
    const topRows = chip.screen.slice(0, SCREEN_WIDTH * 5)
    expect(topRows.reduce((sum, px) => sum + px, 0)).toBeGreaterThan(0)
  })

  test('the ball actually moves', () => {
    const chip = pong()
    for (let frame = 0; frame < 60; frame++) runFrame(chip, 32)
    const before = [...chip.screen]
    for (let frame = 0; frame < 60; frame++) runFrame(chip, 32)
    expect([...chip.screen]).not.toEqual(before)
  })

  test('holding the up key moves the left paddle up', () => {
    const columnTop = (chip: Chip8) => {
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        if (chip.screen[y * SCREEN_WIDTH]) return y
      }
      return -1
    }

    const chip = pong()
    for (let frame = 0; frame < 30; frame++) runFrame(chip, 32)
    const before = columnTop(chip)
    expect(before).toBeGreaterThan(0)
    chip.keys[5] = true // W on the cabinet
    for (let frame = 0; frame < 120; frame++) runFrame(chip, 32)
    expect(columnTop(chip)).toBeLessThan(before)
    expect(chip.halted).toBe(false)
  })
})
