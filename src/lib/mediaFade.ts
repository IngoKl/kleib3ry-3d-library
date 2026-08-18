/**
 * A hand-stepped volume ramp: `pause()` cuts mid-waveform, which is a click, and
 * an element has no ramp of its own. One fader each, so timers cannot cross.
 */

const FADE_OUT_MS = 150

export type Fader = {
  /** Ramp the volume out, pause the element, put the volume back, then `done`. */
  fadeOutThen: (player: HTMLMediaElement, done?: () => void) => void
  /** Abandon a fade mid-way: the element keeps playing at the pre-fade volume. */
  cancelFade: (player: HTMLMediaElement) => void
  /**
   * Change where the volume is restored to, or a slider moved during the lift
   * snaps back. False when no fade runs, so the caller writes the element.
   */
  retarget: (volume: number) => boolean
  /** Whether a fade currently owns the element's volume. */
  fading: () => boolean
}

export function makeFader(): Fader {
  let timer: ReturnType<typeof setInterval> | undefined
  /** The volume to put back after a fade, or on a resume that interrupts one. */
  let restore = 1

  return {
    fadeOutThen(player, done) {
      if (timer === undefined) restore = player.volume
      else clearInterval(timer)
      const from = player.volume
      const began = performance.now()
      timer = setInterval(() => {
        const t = (performance.now() - began) / FADE_OUT_MS
        if (t < 1) {
          player.volume = from * (1 - t)
          return
        }
        clearInterval(timer)
        timer = undefined
        player.pause()
        player.volume = restore
        done?.()
      }, 16)
    },

    cancelFade(player) {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
      player.volume = restore
    },

    retarget(volume) {
      if (timer === undefined) return false
      restore = volume
      return true
    },

    fading: () => timer !== undefined,
  }
}
