import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { pressKey, runFrame } from '../arcade/chip8'
import { arcadeMachine } from '../state/arcade'
import { roomHasKeyboard, useAppStore } from '../state/store'

/**
 * The machine behind the cabinet: the clock, the keypad and the beeper.
 *
 * One of these for the whole app, however many cabinets a document declares —
 * there is one machine, so a second cabinet shows the same game, exactly as
 * every deck would play the same record if a document declared two. The
 * cabinet component in `Furniture.tsx` only *paints*; everything that advances
 * state lives here, so an unmounted cabinet (you walked to the lake house)
 * cannot pause the game.
 *
 * The machine runs whenever a cartridge is in, not only while you stand at it
 * — an arcade cabinet in a room runs its attract mode, and walking past a
 * live game of Pong is the point of having put one in the room.
 */

/** The CHIP-8 timers tick at 60 Hz wherever the machine runs. */
const TICK = 1 / 60
/**
 * Instructions per tick. The original VIP managed about eleven; games written
 * for modern interpreters assume several times that, and Pong at eleven is
 * treacle. As with the fall in `drop.ts`, a slow frame runs several ticks and
 * a stall is capped rather than caught up in full.
 */
const CYCLES_PER_TICK = 32
const MAX_CATCH_UP = 0.25

/**
 * The usual mapping of the CHIP-8 pad onto the left of a keyboard: the 4×4
 * grid 123C/456D/789E/A0BF lands on 1234/QWER/ASDF/ZXCV.
 */
const KEYPAD: Record<string, number> = {
  Digit1: 0x1,
  Digit2: 0x2,
  Digit3: 0x3,
  Digit4: 0xc,
  KeyQ: 0x4,
  KeyW: 0x5,
  KeyE: 0x6,
  KeyR: 0xd,
  KeyA: 0x7,
  KeyS: 0x8,
  KeyD: 0x9,
  KeyF: 0xe,
  KeyZ: 0xa,
  KeyX: 0x0,
  KeyC: 0xb,
  KeyV: 0xf,
}

let audio: { context: AudioContext; gain: GainNode } | null = null
let audioRefused = false

/**
 * The beeper: one square-wave oscillator, running silent until the sound timer
 * says otherwise. Every failure — no AudioContext, a context that will not
 * start — falls back to silence rather than throwing, the rain's rule.
 */
function setBeep(on: boolean) {
  try {
    if (!audio) {
      if (audioRefused || on === false) return
      const Context = window.AudioContext
      if (!Context) {
        audioRefused = true
        return
      }
      const context = new Context()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = 440
      gain.gain.value = 0
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      audio = { context, gain }
    }
    if (on && audio.context.state === 'suspended') void audio.context.resume()
    // A short ramp instead of a step, or every beep begins and ends on a click.
    audio.gain.gain.setTargetAtTime(on ? 0.03 : 0, audio.context.currentTime, 0.005)
  } catch {
    audioRefused = true
    audio = null
  }
}

export function ArcadeSystem() {
  const mode = useAppStore((s) => s.mode)
  const behind = useRef(0)

  // The keypad, taken and given back with the mode. Held keys are the point of
  // a game pad, so there is no `e.repeat` guard here — repeats are simply
  // writes of `true` over `true` — and `keyup` is what actually releases.
  useEffect(() => {
    if (mode !== 'play') return

    const onKeyDown = (e: KeyboardEvent) => {
      if (!roomHasKeyboard()) return
      if (e.code === 'Escape') {
        useAppStore.getState().setMode('walk')
        return
      }
      const key = KEYPAD[e.code]
      const machine = arcadeMachine()
      if (key === undefined || !machine) return
      e.preventDefault()
      pressKey(machine, key)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const key = KEYPAD[e.code]
      const machine = arcadeMachine()
      if (key !== undefined && machine) machine.keys[key] = false
    }
    // Walking away mid-game must not leave a button held down.
    const onBlur = () => arcadeMachine()?.keys.fill(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      arcadeMachine()?.keys.fill(false)
    }
  }, [mode])

  useFrame((_, delta) => {
    const machine = arcadeMachine()
    if (!machine) {
      behind.current = 0
      setBeep(false)
      return
    }

    behind.current = Math.min(behind.current + delta, MAX_CATCH_UP)
    while (behind.current >= TICK) {
      runFrame(machine, CYCLES_PER_TICK)
      behind.current -= TICK
    }
    setBeep(machine.soundTimer > 0)
  })

  return null
}
