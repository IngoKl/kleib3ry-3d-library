import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { placeSound } from './audioRig'
import { player } from '../state/player'
import { musicElement, useMediaStore } from '../state/media'
import { useVideoStore, videoElement } from '../state/video'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'

/**
 * Where the noise is coming from.
 *
 * The deck and the television are furniture with positions, and you have a
 * position, so the volume and the direction of each fall straight out of the
 * two. There is nothing to configure and nothing in the document to say: put a
 * `recordplayer` anywhere in your map and it is audible from where it stands.
 *
 * Updated every fourth frame rather than every frame, because sound is ramped
 * over 40 ms anyway (see `audioRig`) and nobody can hear the difference between
 * sixty updates a second and fifteen. It costs a couple of `find`s over the
 * furniture list, which is the only reason it is worth being careful at all.
 */

/** How high off its base a piece actually makes its noise. */
const MOUTH = { recordplayer: 0.12, crt: 0.3 } as const

export function Sound() {
  const frame = useRef(0)

  useFrame(() => {
    frame.current += 1
    if (frame.current % 4 !== 0) return

    const world = useWorldStore.getState().world
    const settings = useSettings.getState()
    const listener = { x: player.x, y: player.eye, z: player.z, yaw: player.yaw }

    const sourceOf = (kind: 'recordplayer' | 'crt') => {
      const piece = world?.furniture.find((item) => item.kind === kind)
      return piece ? { x: piece.x, y: piece.y + MOUTH[kind], z: piece.z } : null
    }

    // Only touched while something is actually playing: creating the element
    // for a library with no music in it would allocate an audio graph nobody
    // asked for, and the stores create their elements lazily for that reason.
    if (useMediaStore.getState().playing !== null) {
      placeSound(
        musicElement(),
        sourceOf('recordplayer'),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }

    if (useVideoStore.getState().playing !== null) {
      placeSound(
        videoElement(),
        sourceOf('crt'),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }
  })

  return null
}
