import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { block, join } from './geometry'
import { EYE_HEIGHT, player } from '../state/player'
import { approach, shortestTurn } from '../lib/ease'
import { useAppStore } from '../state/store'
import { useSettings } from '../state/settings'

/**
 * Your own body, seen from inside it.
 *
 * Off by default in most first-person things because it is hard to get right and
 * cheap to get wrong: a body that clips through the camera, or whose legs stride
 * out of time with the floor, is worse than no body at all. It is worth having
 * here for the opposite reason to a shooter — looking down at your own knees on
 * a sofa is most of what "being in the room" is — so it is a setting, and the
 * people it makes queasy can turn it off.
 *
 * Three decisions keep it out of trouble:
 *
 *   - **it stops below the collar.** No head, no neck. The camera is inside the
 *     head, and a head modelled round it is a face you see the inside of.
 *   - **it is drawn from the *torso* down and hung off the eye height**, so
 *     crouching, sitting and climbing stairs all move it for free — those are
 *     all changes to where your eyes are, and the body follows the eyes.
 *   - **it stands a hand's width behind your eyes**, which is where a chest
 *     actually is relative to a face. Centred on the camera instead, the front
 *     of the torso is 10 cm in front of the near plane: it clips, and on a
 *     software rasteriser a surface that close fills half the screen with
 *     fragments nobody ever sees.
 *   - **the legs swing off distance travelled**, not off a clock, so they stop
 *     when you stop and never skate.
 *
 * It is deliberately not raycast by anything: `Interaction` asks specific
 * groups, and a body that could be pointed at would be a body you could take a
 * book out of. It is also four merged geometries rather than fourteen meshes,
 * for the reason every other assembly in `scene/` gives.
 */

const CLOTH = '#4a4f57'
const CLOTH_DARK = '#3a3f46'
const SKIN = '#b98d6c'

/** How far below your eyes the shoulders are, and how far behind them. */
const SHOULDER = 0.28
const BEHIND = 0.16
/** How far the legs swing, in radians, at a full walk. */
const STRIDE = 0.55
/** How far your head can turn before your shoulders follow it. */
const NECK = 0.7

export function Body() {
  const show = useSettings((s) => s.showBody)
  const mode = useAppStore((s) => s.mode)
  const seated = useAppStore((s) => s.seat !== null)

  const group = useRef<THREE.Group>(null)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const phase = useRef(0)
  /**
   * Which way the shoulders are pointing, which is *not* which way you are
   * looking.
   *
   * Pinned to the camera, the torso snapped round with every glance — you look
   * left at a shelf and your own chest whips past the bottom of the screen. A
   * real body turns its head first and its shoulders after, and only when the
   * head has gone far enough or the feet have started moving. Both of those are
   * cheap to say, and together they are most of what makes a body read as worn
   * rather than carried.
   */
  const shoulders = useRef(0)

  /**
   * Torso, arms and hands as three geometries, and one leg as a fourth — the
   * two legs share it, because a leg is a leg and the mirror is a scale.
   */
  const parts = useMemo(() => {
    const cloth = [
      // Chest, stopping at the collarbone.
      block(0.36, 0.34, 0.21, 0, -0.16, 0),
      // Upper arms.
      block(0.11, 0.3, 0.12, -0.23, -0.31, 0.02),
      block(0.11, 0.3, 0.12, 0.23, -0.31, 0.02),
    ]
    const dark = [block(0.33, 0.24, 0.2, 0, -0.44, 0)]
    // Forearms, angled in towards where a hand would rest.
    for (const side of [-1, 1]) {
      const arm = new THREE.BoxGeometry(0.095, 0.3, 0.1)
      arm.rotateX(-0.5)
      arm.translate(side * 0.23, -0.56, 0.06)
      dark.push(arm)
    }
    const skin = [
      block(0.085, 0.11, 0.07, -0.23, -0.7, 0.18),
      block(0.085, 0.11, 0.07, 0.23, -0.7, 0.18),
    ]
    /**
     * A leg, hung from a hip at the group's origin so a swing is a rotation.
     *
     * The lengths add up rather than being chosen: the hip sits 0.52 below the
     * shoulder and a standing shoulder is `EYE_HEIGHT - SHOULDER` = 1.40 above
     * the floor, so thigh, shin and sole have exactly 0.88 between them. Eight
     * centimetres out here is a foot through the floorboards.
     */
    const leg = [
      block(0.15, 0.44, 0.16, 0, -0.22, 0),
      block(0.13, 0.38, 0.14, 0, -0.63, 0),
    ]
    const foot = [block(0.13, 0.06, 0.26, 0, -0.85, 0.05)]

    return {
      cloth: join(cloth),
      dark: join(dark),
      skin: join(skin),
      leg: join(leg),
      foot: join(foot),
    }
  }, [])

  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part?.dispose()
    },
    [parts],
  )

  useFrame((_, rawDelta) => {
    const node = group.current
    if (!node) return
    const delta = Math.min(rawDelta, 1 / 20)

    // The shoulders follow the head, late. Walking drags them round quickly —
    // you go where you are pointed — and standing still lets the neck take up to
    // NECK radians of it before they move at all.
    const lead = shortestTurn(player.yaw - shoulders.current)
    const walking = Math.min(1, player.speed / 0.6)
    const slack = Math.max(0, Math.abs(lead) - NECK * (1 - walking))
    if (slack > 0 || walking > 0) {
      shoulders.current += lead * approach(2 + walking * 8, delta)
    }

    // Behind the eyes, not around them: stepping back along the way you are
    // *looking* is what puts a chest under a face, even while the shoulders are
    // still catching up with it.
    node.position.set(
      player.x + Math.sin(player.yaw) * BEHIND,
      player.eye - SHOULDER,
      player.z + Math.cos(player.yaw) * BEHIND,
    )
    node.rotation.y = shoulders.current

    // Crouching brings your eyes down 0.7 m and your shoulders with them; what
    // it must *not* do is leave your feet a foot underground, so the legs are
    // scaled by however much of a standing height is left. Sitting is the
    // exception — there the legs genuinely fold, and scaling as well would put a
    // half-size torso in your lap.
    const standing = EYE_HEIGHT - SHOULDER
    const height = Math.max(0.35, player.eye - SHOULDER - player.floor)
    node.scale.setScalar(seated ? 1 : Math.min(1, height / standing))

    // Distance, not time: a leg that swings while you stand at a shelf is the
    // single most obviously wrong thing a body can do. Sideways counts too — a
    // strafe along a bookcase is still walking — because `player.speed` is how
    // fast you actually moved rather than how far forward.
    phase.current += player.speed * delta * 4.6
    const swing = Math.sin(phase.current) * STRIDE * Math.min(1, player.speed / 1.6)
    // Sitting folds them forward instead, which is enough at the angle you see
    // your own knees from in an armchair.
    if (left.current) left.current.rotation.x = seated ? -1.35 : swing
    if (right.current) right.current.rotation.x = seated ? -1.35 : -swing
  })

  // Nothing to see in read mode: the camera is docked on a page, and a torso
  // hanging in the middle of the spread is not a feature.
  if (!show || mode !== 'walk') return null

  return (
    <group ref={group}>
      {/* Chest and upper arms. The arms do not swing: at this angle you see your
          forearms and almost nothing else, and a swinging forearm with no
          shoulder to hinge from reads as an arm coming loose. */}
      {parts.cloth && (
        <mesh geometry={parts.cloth} castShadow>
          <meshStandardMaterial color={CLOTH} roughness={0.95} />
        </mesh>
      )}
      {parts.dark && (
        <mesh geometry={parts.dark} castShadow>
          <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
        </mesh>
      )}
      {parts.skin && (
        <mesh geometry={parts.skin} castShadow>
          <meshStandardMaterial color={SKIN} roughness={1} />
        </mesh>
      )}

      {/* Legs, hinged at the hip so a swing is a rotation rather than a slide. */}
      {[
        { ref: left, side: -1 },
        { ref: right, side: 1 },
      ].map(({ ref, side }) => (
        <group key={side} ref={ref} position={[side * 0.1, -0.52, 0]}>
          {parts.leg && (
            <mesh geometry={parts.leg} castShadow>
              <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
            </mesh>
          )}
          {parts.foot && (
            <mesh geometry={parts.foot} castShadow>
              <meshStandardMaterial color="#2c2a28" roughness={0.9} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}
