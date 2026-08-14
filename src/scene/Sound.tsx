import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { placeSound } from './audioRig'
import { placeRain, stopRain } from './rainSound'
import { placeLoop, stopAllLoops } from './ambientSound'
import { player } from '../state/player'
import { cat } from '../state/cat'
import { musicElement, useMediaStore } from '../state/media'
import { useVideoStore, videoElement } from '../state/video'
import { useAmbienceStore } from '../state/ambience'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'
import { openingSpots, roomAt, type DerivedWorld, type OpeningSpot } from '../world/derive'

/**
 * Where the noise is coming from.
 *
 * The deck and the television are furniture with positions, and you have a
 * position, so the volume and the direction of each fall straight out of the
 * two. There is nothing to configure and nothing in the document to say: put a
 * `recordplayer` anywhere in your map and it is audible from where it stands.
 *
 * The rain is the exception, and deliberately so: it comes from everywhere at
 * once, so what it is placed against is not a point but the roof over your head
 * — see `rainSound.ts`.
 *
 * Updated every fourth frame rather than every frame, because sound is ramped
 * over 40 ms anyway (see `audioRig`) and nobody can hear the difference between
 * sixty updates a second and fifteen.
 */

/** How high off its base a piece actually makes its noise. */
const MOUTH = { recordplayer: 0.12, crt: 0.3 } as const

/** How loud the rain is on the grass, and the least it falls to indoors. */
const RAIN_OUTSIDE = 0.5
const RAIN_INSIDE = 0.14

/** How far from an opening you can still hear that it is there. */
const OPENING_REACH = 3.2

/**
 * How much of the sky you can hear from where you are standing, 0 to 1.
 *
 * Out on the grass it is all of it. A porch has a roof and no walls, so it is
 * nearly all of it. Indoors it is what leaks in through the openings — a door
 * lets in the weather, a pane lets in a third of it — which is what makes
 * standing at the great room's north window sound different from standing at
 * the hearth.
 */
function openness(world: DerivedWorld, spots: Map<string, OpeningSpot[]>): number {
  const room = roomAt(world, player.x, player.z, player.floor)
  if (!room) return 1
  if (room.outdoor) return 0.85

  let most = 0.05
  for (const spot of spots.get(room.id) ?? []) {
    const away = Math.hypot(spot.x - player.x, spot.z - player.z)
    const near = Math.max(0, 1 - away / OPENING_REACH)
    most = Math.max(most, (spot.glazed ? 0.3 : 0.62) * near)
  }
  return most
}

export function Sound() {
  const frame = useRef(0)
  const world = useWorldStore((s) => s.world)
  const raining = useAmbienceStore((s) => s.rain)

  // One walk of the document per world rather than one per frame: openings do
  // not move, and this is read fifteen times a second.
  const spots = useMemo(() => {
    const map = new Map<string, OpeningSpot[]>()
    for (const room of world?.rooms ?? []) map.set(room.id, openingSpots(room))
    return map
  }, [world])

  // Weather that has cleared gives its audio graph back rather than sitting
  // there at zero gain until the tab closes. The small loops go with the
  // scene the same way.
  useEffect(() => {
    if (!raining) stopRain()
    return () => {
      stopRain()
      stopAllLoops()
    }
  }, [raining])

  useFrame(() => {
    frame.current += 1
    if (frame.current % 4 !== 0) return

    const settings = useSettings.getState()
    const listener = { x: player.x, y: player.eye, z: player.z, yaw: player.yaw }

    /**
     * Where a piece of a kind is, preferring the one actually in use.
     *
     * A building may have more than one record player — the cabin has one in the
     * great room and one in the bathroom — and they share a single audio
     * element, so "the first one in the document" was the wrong answer as soon
     * as there were two: the music came out of a deck nobody had touched.
     */
    const sourceOf = (kind: 'recordplayer' | 'crt', id: string | null) => {
      const piece =
        (id ? world?.furniture.find((item) => item.id === id) : undefined) ??
        world?.furniture.find((item) => item.kind === kind)
      return piece ? { x: piece.x, y: piece.y + MOUTH[kind], z: piece.z } : null
    }

    // Only touched while something is actually playing: creating the element
    // for a library with no music in it would allocate an audio graph nobody
    // asked for, and the stores create their elements lazily for that reason.
    const music = useMediaStore.getState()
    if (music.playing !== null) {
      placeSound(
        musicElement(),
        sourceOf('recordplayer', music.deck),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }

    const video = useVideoStore.getState()
    if (video.playing !== null) {
      placeSound(
        videoElement(),
        sourceOf('crt', video.crt),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }

    if (raining && world) {
      const open = openness(world, spots)
      const level = RAIN_INSIDE + (RAIN_OUTSIDE - RAIN_INSIDE) * open
      placeRain(settings.volume * settings.rainVolume * level, open)
    }

    // The small loops: a lit fire crackles, a close purring cat is audible, a
    // spinning record carries its dust. Each is a level on a synthesised loop
    // (`ambientSound`), attenuated here by plain distance — a zero level on a
    // loop that never started costs nothing at all. All three ride the same
    // Small Sounds slider, on top of the master volume like the rain.
    if (world) {
      const small = settings.volume * settings.ambientVolume
      const ambience = useAmbienceStore.getState()
      let fire = 0
      for (const lamp of world.lights) {
        if (lamp.kind !== 'fireplace' && lamp.kind !== 'campfire') continue
        if (!ambience.isOn(lamp.id, lamp.defaultOn)) continue
        const away = Math.hypot(lamp.x - player.x, lamp.y - player.eye, lamp.z - player.z)
        fire = Math.max(fire, Math.max(0, 1 - away / 9))
      }
      placeLoop('fire', small * 0.5 * fire * fire)

      const catAway = Math.hypot(cat.x - player.x, cat.z - player.z)
      const catNear = Math.max(0, 1 - catAway / 2.6)
      placeLoop('purr', small * 0.55 * cat.purr * catNear * catNear)

      let vinyl = 0
      if (music.playing !== null && !music.paused) {
        const deck = sourceOf('recordplayer', music.deck)
        if (deck) {
          const away = Math.hypot(deck.x - player.x, deck.y - player.eye, deck.z - player.z)
          vinyl = Math.max(0, 1 - away / 7)
        }
      }
      placeLoop('vinyl', small * 0.16 * vinyl * vinyl)
    }
  })

  return null
}
