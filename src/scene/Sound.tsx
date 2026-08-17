import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ambienceBlend, strikeLightning } from './ambienceBlend'
import { placeSound } from './audioRig'
import { placeRain, stopRain } from './rainSound'
import { placeChorus, placeLoop, playOneShot, stopAllChoruses, stopAllLoops } from './ambientSound'
import { player } from '../state/player'
import { cat } from '../state/cat'
import { musicElement, musicFading, useMediaStore } from '../state/media'
import { useVideoStore, videoElement, videoFading } from '../state/video'
import { useAmbienceStore } from '../state/ambience'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'
import { openingSpots, roomAt, type DerivedWorld, type OpeningSpot } from '../world/derive'
import { lakeRadius } from '../world/terrain'

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

  // One walk of the document per world rather than one per frame: openings do
  // not move, and this is read fifteen times a second.
  const spots = useMemo(() => {
    const map = new Map<string, OpeningSpot[]>()
    for (const room of world?.rooms ?? []) map.set(room.id, openingSpots(room))
    return map
  }, [world])

  // The scene unmounting gives every audio graph back. Weather that has
  // merely cleared is not cut here: the frame loop rides the sky's blend down
  // first and stops the graph once it has settled dry.
  // The next rumble's due time. A timestamp rather than a frame count so the
  // storm keeps its pace on a renderer crawling at four frames a second.
  const thunderAt = useRef<number | null>(null)
  /** Echo and rumble timers in flight, cancelled if the scene unmounts. */
  const pending = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      stopRain()
      stopAllLoops()
      stopAllChoruses()
      pending.current.forEach((timer) => clearTimeout(timer))
      pending.current = []
    },
    [],
  )

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
    // A fade in flight is left alone — it owns the volume — but a merely
    // paused element keeps being placed, or resuming would replay at the
    // loudness of wherever you were standing when you paused.
    const music = useMediaStore.getState()
    if (music.playing !== null && !musicFading()) {
      placeSound(
        musicElement(),
        sourceOf('recordplayer', music.deck),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }

    const video = useVideoStore.getState()
    if (video.playing !== null && !videoFading()) {
      placeSound(
        videoElement(),
        sourceOf('crt', video.crt),
        listener,
        settings.volume,
        settings.positionalAudio,
      )
    }

    if (world) {
      const ambience = useAmbienceStore.getState()
      const open = openness(world, spots)

      // The shower rides the same eased blend the sky dries by, so what you
      // hear dies away with what you see; only once the blend has settled is
      // the graph given back, and stopRain ramps off the last of it.
      const wet = ambienceBlend.rain
      if (ambience.rain || wet > 0) {
        const level = RAIN_INSIDE + (RAIN_OUTSIDE - RAIN_INSIDE) * open
        placeRain(settings.volume * settings.rainVolume * level * wet, open)
      } else {
        stopRain()
      }

      // The small loops: a lit fire crackles, a close purring cat is audible,
      // a spinning record carries its dust, the lake washes its shore. Each is
      // a level on a synthesised loop (`ambientSound`), attenuated here by
      // plain distance — a zero level on a loop that never started costs
      // nothing at all. All four ride the same Small Sounds slider, on top of
      // the master volume like the rain.
      const small = settings.volume * settings.ambientVolume
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

      // The lake heard from the beach: all of it at the water's edge, gone by
      // the tree line, and indoors only what an opening lets in — the same
      // measure of sky the rain uses. `lakeRadius` is in shoreline units, so
      // the wash follows the actual shore rather than a circle near it.
      const ashore = Math.max(0, Math.min(1, (1.8 - lakeRadius(player.x, player.z)) / 0.8))
      placeLoop('lake', small * 0.4 * ashore * ashore * open)

      // The rest of the outdoors: wind always, up a little in weather; birds
      // by day and crickets by night, crossfaded on the same eased blend the
      // sky dims by, both hushed by rain and all let in by the same openings.
      // All three sit well under the room's own noises on purpose — outdoors
      // you should notice the quiet, not the soundtrack.
      const night = ambienceBlend.night
      placeLoop('wind', small * (0.13 + 0.1 * wet) * open)
      placeChorus('birds', small * 0.3 * open * (1 - night) * (1 - 0.75 * wet))
      placeChorus('crickets', small * 0.26 * open * night * (1 - 0.5 * wet))

      // A distant rumble now and then while it pours: the first one lets the
      // shower establish itself, and a shower that dries and returns gets its
      // grace period back. Thunder is all low end and penetrates walls, so
      // indoors softens it only mildly — and it rides the Rain slider.
      if (wet > 0.4) {
        const now = performance.now()
        if (thunderAt.current === null) {
          thunderAt.current = now + 8_000 + Math.random() * 22_000
        } else if (now >= thunderAt.current) {
          thunderAt.current = now + 25_000 + Math.random() * 45_000
          // The flash first — twice, the classic double — and the rumble after
          // the gap that says the strike is somewhere across the lake.
          strikeLightning(0.7 + Math.random() * 0.5)
          pending.current.push(
            setTimeout(() => strikeLightning(0.4), 90 + Math.random() * 140),
            setTimeout(
              () =>
                playOneShot('thunder', (0.55 + Math.random() * 0.45) * (0.5 + 0.5 * open), {
                  rate: 0.75 + Math.random() * 0.4,
                  rain: true,
                }),
              900 + Math.random() * 1_600,
            ),
          )
        }
      } else {
        thunderAt.current = null
      }
    }
  })

  return null
}
