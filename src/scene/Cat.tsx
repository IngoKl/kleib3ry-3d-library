import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneRefs } from './refs'
import { stepPlayer } from './walk'
import { shelfColliders } from '../world/shelf'
import {
  floorAt,
  openingSpots,
  roomAt,
  roomBounds,
  supportAt,
  type DerivedShelf,
  type DerivedWorld,
} from '../world/derive'
import { cat } from '../state/cat'
import { player } from '../state/player'
import { useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'
import { rowKey } from './shelving'
import { approach, shortestTurn } from '../lib/ease'

/**
 * A cat, which lives here.
 *
 * It wanders between the rooms, sits down, sleeps, comes when you call it more
 * often than not, and can be persuaded to bring you a book. None of that is a
 * feature of the library; it is the thing that makes a room with a thousand
 * books in it feel like somewhere lived in rather than a warehouse you have
 * privileges at.
 *
 * The steering is deliberately stupid: it points itself at where it is going and
 * walks, through exactly the same `stepPlayer` you do, so it slides along walls,
 * climbs the stairs, and cannot walk into the lake or off the loft. There is no
 * pathfinding, and there will not be — a cat that gets stuck behind the sofa and
 * gives up on you is not a bug, and building a navmesh to prevent it would be
 * building a navmesh.
 *
 * It is drawn from the same boxes and cylinders as the furniture, for the same
 * reasons: the repo stays text and the proportions stay arguable.
 */

/** Metres a second. A cat's walk, and the trot it does when it wants something. */
const WALK = 0.85
const TROT = 1.9
const RADIUS = 0.18

/** How near it has to get before it counts as having arrived. */
const ARRIVED = 0.55
/** …and how near to *you*, which is closer, because that is the point. */
const ARRIVED_AT_YOU = 0.9

/** Seconds of getting nowhere before it loses interest in going there. */
const GIVE_UP = 4
/** …and before it decides a wall is in the way and looks for the door. */
const WALL_IN_THE_WAY = 1

const FUR = '#5b5148'
const FUR_DARK = '#413a34'
const BELLY = '#a99b8b'
const EYE = '#c8c46a'

/** A box at a place, ready to be merged with its neighbours. */
function block(w: number, h: number, d: number, x: number, y: number, z: number) {
  const part = new THREE.BoxGeometry(w, h, d)
  part.translate(x, y, z)
  return part
}

/** Where a hip sits: leg tops, so a leg swings about its top rather than its middle. */
const HIP_Y = 0.11

/**
 * Its own body, as merged geometries — one per colour, plus one per diagonal
 * pair of legs.
 *
 * The head is at the +Z end, which is the same convention as every `facing` in
 * the building: `cat.yaw` points local +Z at where the cat is going.
 *
 * The legs are two groups rather than four so a walk is two draw calls: a cat
 * moves diagonal pairs together, so front-left swings with back-right.
 */
function CatBody({ legs }: { legs: [React.RefObject<THREE.Group | null>, React.RefObject<THREE.Group | null>] }) {
  const parts = useMemo(() => {
    const fur = [
      // The barrel and the haunches — a cat is two masses, not one.
      block(0.15, 0.16, 0.36, 0, 0.19, 0),
      block(0.17, 0.18, 0.16, 0, 0.17, -0.14),
      block(0.13, 0.12, 0.12, 0, 0.26, 0.21),
    ]
    const pale = [
      block(0.13, 0.07, 0.3, 0, 0.12, 0),
      // The muzzle.
      block(0.07, 0.05, 0.04, 0, 0.235, 0.275),
    ]
    const dark: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.032, 0.07, 4)
      ear.translate(side * 0.045, 0.335, 0.205)
      dark.push(ear)
    }
    const bright = [
      block(0.018, 0.014, 0.008, 0, 0.235, 0.298),
      block(0.022, 0.014, 0.006, -0.033, 0.272, 0.272),
      block(0.022, 0.014, 0.006, 0.033, 0.272, 0.272),
    ]

    // Built hanging from the origin, so the group's rotation is a hip joint.
    const leg = (sx: number, z: number) => block(0.038, 0.11, 0.04, sx * 0.055, -0.055, z)
    const pairA = [leg(-1, 0.13), leg(1, -0.13)]
    const pairB = [leg(1, 0.13), leg(-1, -0.13)]

    const join = (list: THREE.BufferGeometry[]) => {
      const merged = mergeGeometries(list, false)
      list.forEach((part) => part.dispose())
      return merged
    }
    return {
      fur: join(fur),
      pale: join(pale),
      dark: join(dark),
      bright: join(bright),
      pairA: join(pairA),
      pairB: join(pairB),
    }
  }, [])

  useEffect(
    () => () => {
      parts.fur?.dispose()
      parts.pale?.dispose()
      parts.dark?.dispose()
      parts.bright?.dispose()
      parts.pairA?.dispose()
      parts.pairB?.dispose()
    },
    [parts],
  )

  return (
    <group>
      {parts.fur && (
        <mesh geometry={parts.fur} castShadow receiveShadow>
          <meshStandardMaterial color={FUR} roughness={1} />
        </mesh>
      )}
      {parts.pale && (
        <mesh geometry={parts.pale} castShadow>
          <meshStandardMaterial color={BELLY} roughness={1} />
        </mesh>
      )}
      {parts.dark && (
        <mesh geometry={parts.dark} castShadow>
          <meshStandardMaterial color={FUR_DARK} roughness={1} flatShading />
        </mesh>
      )}
      {/* The nose and the eyes share a material rather than two: at this size
          the difference between a pink nose and a yellow one is one pixel, and
          the eyes are the ones worth having. */}
      {parts.bright && (
        <mesh geometry={parts.bright}>
          <meshStandardMaterial
            color={EYE}
            emissive={EYE}
            emissiveIntensity={0.35}
            roughness={0.4}
          />
        </mesh>
      )}
      {[parts.pairA, parts.pairB].map((pair, i) =>
        pair ? (
          <group key={i} ref={legs[i]} position={[0, HIP_Y, 0]}>
            <mesh geometry={pair} castShadow>
              <meshStandardMaterial color={FUR_DARK} roughness={1} flatShading />
            </mesh>
          </group>
        ) : null,
      )}
    </group>
  )
}

/**
 * A doorway out of the room it is standing in, a step beyond the threshold.
 *
 * It steers straight at where it is going, so a room whose only door faces away
 * from the rest of the building is a trap: it presses into the wall between
 * itself and the target until it gives up. When that happens it heads for the
 * door nearest the target first.
 */
function wayOut(
  world: DerivedWorld,
  from: { x: number; z: number; floor: number },
  towards: { x: number; z: number },
): [number, number] | null {
  const room = roomAt(world, from.x, from.z, from.floor)
  if (!room) return null

  let best: [number, number] | null = null
  let score = Infinity
  for (const spot of openingSpots(room)) {
    if (spot.kind !== 'door') continue
    // A step *through* it rather than into it, so arriving at the waypoint has
    // put the cat in the next room rather than in the doorway.
    const out = 0.8
    const x = spot.x + (spot.wall === 'east' ? out : spot.wall === 'west' ? -out : 0)
    const z = spot.z + (spot.wall === 'south' ? out : spot.wall === 'north' ? -out : 0)
    const gap = Math.hypot(towards.x - x, towards.z - z)
    if (gap < score) {
      score = gap
      best = [x, z]
    }
  }
  return best
}

/** A random point somewhere in the building, on the floor, that it can stand on. */
function somewhereToGo(world: DerivedWorld, from: { x: number; z: number }): [number, number] {
  for (let attempt = 0; attempt < 24; attempt++) {
    const room = world.rooms[Math.floor(Math.random() * world.rooms.length)]
    if (!room) break
    const bounds = roomBounds(room)
    const x = bounds.minX + 0.6 + Math.random() * Math.max(0.1, bounds.maxX - bounds.minX - 1.2)
    const z = bounds.minZ + 0.6 + Math.random() * Math.max(0.1, bounds.maxZ - bounds.minZ - 1.2)
    if (floorAt(world, x, z, room.elevation) === null) continue
    // Not a stride away: a cat that wanders 40 cm and sits down again is a cat
    // that appears to be broken.
    if (Math.hypot(x - from.x, z - from.z) < 2) continue
    return [x, z]
  }
  return [from.x, from.z]
}

export function Cat() {
  const world = useWorldStore((s) => s.world)
  const group = useRef<THREE.Group>(null)
  const hitbox = useRef<THREE.Group>(null)
  const bob = useRef(0)
  const tail = useRef<THREE.Group>(null)
  /** The two diagonal pairs of legs, swung in opposite phase. */
  const legA = useRef<THREE.Group>(null)
  const legB = useRef<THREE.Group>(null)

  const solids = useMemo(
    () => (world ? [...world.solids, ...shelfColliders(world.shelves)] : []),
    [world],
  )

  useLayoutEffect(() => {
    sceneRefs.cat = hitbox.current
    return () => {
      sceneRefs.cat = null
    }
  }, [world])

  // Put it down somewhere real the first time a world arrives, rather than at
  // the origin — which, in a map whose origin is outdoors, is in a tree.
  useEffect(() => {
    if (!world || cat.placed) return
    const [x, z] = somewhereToGo(world, { x: world.spawn.x, z: world.spawn.z })
    cat.x = x
    cat.z = z
    cat.floor = floorAt(world, x, z, 0) ?? 0
    cat.targetX = x
    cat.targetZ = z
    cat.patience = 2
    cat.placed = true
  }, [world])

  useFrame((_, rawDelta) => {
    const node = group.current
    if (!node || !world) return
    const delta = Math.min(rawDelta, 1 / 20)

    cat.purr = Math.max(0, cat.purr - delta * 0.25)

    // ---- deciding ----
    cat.patience -= delta
    const distanceToYou = Math.hypot(player.x - cat.x, player.z - cat.z)

    if (cat.mood === 'come' || cat.mood === 'deliver') {
      cat.targetX = player.x
      cat.targetZ = player.z
    }

    // A waypoint, if it is working its way out of a room, is what it steers at
    // until it gets there; the real target is what it is judged against.
    if (cat.via && Math.hypot(cat.via[0] - cat.x, cat.via[1] - cat.z) < ARRIVED) cat.via = null
    const target = { x: cat.targetX, z: cat.targetZ }
    const reach = cat.mood === 'come' || cat.mood === 'deliver' ? ARRIVED_AT_YOU : ARRIVED
    const gap = Math.hypot(target.x - cat.x, target.z - cat.z)

    if (cat.mood === 'sit' || cat.mood === 'sleep') {
      if (cat.patience <= 0) {
        cat.mood = 'roam'
        const [x, z] = somewhereToGo(world, cat)
        cat.targetX = x
        cat.targetZ = z
        cat.patience = 20
      }
    } else if (gap <= reach || cat.stuck > GIVE_UP) {
      const arrived = gap <= reach
      cat.stuck = 0
      cat.via = null
      if (cat.mood === 'deliver' && cat.carrying) {
        // Wherever it got to. A cat that could not reach you puts the book down
        // and looks at you, which is not a failure so much as a cat.
        drop(world, cat.carrying)
        cat.carrying = null
        cat.purr = 1
        cat.mood = 'sit'
        cat.patience = 6
      } else if (cat.mood === 'fetch') {
        // Only a case it actually reached hands over a book. Stuck behind the
        // sofa on the way to one, it tries a different bookcase — otherwise the
        // book would arrive in its mouth from across the room.
        const taken = arrived ? takeFromShelf(cat.fetchingFrom) : null
        if (taken) {
          cat.fetchingFrom = null
          cat.carrying = taken
          cat.mood = 'deliver'
        } else if (!arrived && askCatForBook()) {
          // `askCatForBook` has re-aimed it at another case; nothing else to do.
        } else {
          // The case it walked to is empty and there is nothing else to try.
          cat.fetchingFrom = null
          cat.mood = 'sit'
          cat.patience = 5
        }
      } else if (cat.mood === 'come') {
        cat.purr = 1
        cat.mood = 'sit'
        cat.patience = 10
      } else {
        // A wander ends in a sit, and now and then in a nap.
        cat.mood = Math.random() < 0.35 ? 'sleep' : 'sit'
        cat.patience = cat.mood === 'sleep' ? 25 + Math.random() * 30 : 4 + Math.random() * 8
      }
    } else if (cat.patience <= 0 && cat.mood === 'roam') {
      const [x, z] = somewhereToGo(world, cat)
      cat.targetX = x
      cat.targetZ = z
      cat.patience = 20
    }

    // ---- moving ----
    const moving = cat.mood === 'roam' || cat.mood === 'come' || cat.mood === 'fetch' || cat.mood === 'deliver'
    if (moving) {
      const top = cat.mood === 'roam' ? WALK : TROT
      const aim = cat.via ? { x: cat.via[0], z: cat.via[1] } : target
      const dx = aim.x - cat.x
      const dz = aim.z - cat.z
      const length = Math.hypot(dx, dz) || 1
      const step = Math.min(top * delta, length)
      const next = stepPlayer(
        world,
        solids,
        { x: cat.x, z: cat.z, floor: cat.floor },
        { x: cat.x + (dx / length) * step, z: cat.z + (dz / length) * step },
        RADIUS,
      )

      const travelled = Math.hypot(next.x - cat.x, next.z - cat.z)
      cat.stuck = travelled < step * 0.25 ? cat.stuck + delta : 0
      // Walked into a wall: try the doorway nearest where it is going before
      // giving the errand up altogether.
      if (cat.stuck > WALL_IN_THE_WAY && !cat.via) {
        cat.via = wayOut(world, cat, target)
        if (cat.via) cat.stuck = 0
      }
      cat.speed = travelled / delta
      cat.x = next.x
      cat.z = next.z
      cat.floor += (next.floor - cat.floor) * approach(12, delta)

      // Turn towards where it is actually going, taking the short way round.
      cat.yaw += shortestTurn(Math.atan2(dx, dz) - cat.yaw) * approach(6, delta)
    } else {
      cat.speed = 0
      // Sitting near you, it looks at you.
      if (distanceToYou < 3) {
        cat.yaw += shortestTurn(Math.atan2(player.x - cat.x, player.z - cat.z) - cat.yaw) *
          approach(3, delta)
      }
    }

    // ---- drawing ----
    bob.current += delta * cat.speed * 6
    // A sitting cat settles onto its haunches and a sleeping one is a loaf. It
    // is done by dropping the whole animal rather than by folding its legs,
    // which at this size is the same picture and no bones.
    const crouch = cat.mood === 'sleep' ? 0.055 : cat.mood === 'sit' ? 0.025 : 0
    node.position.set(cat.x, cat.floor + Math.sin(bob.current) * 0.012 - crouch, cat.z)
    node.rotation.y = cat.yaw

    // The gait, advanced by distance rather than by time, so the legs stop when
    // the cat does. A sitting or sleeping cat folds them under itself.
    const tucked = cat.mood === 'sit' || cat.mood === 'sleep'
    const swing = tucked ? 0 : Math.sin(bob.current) * Math.min(0.5, cat.speed * 0.5)
    if (legA.current) legA.current.rotation.x = swing
    if (legB.current) legB.current.rotation.x = -swing

    if (tail.current) {
      // Slow when content, quick and low when walking. A still tail on a cat is
      // the one thing that makes it read as a model of a cat.
      const t = bob.current * 0.5 + performance.now() * (cat.purr > 0.2 ? 0.004 : 0.0016)
      tail.current.rotation.z = Math.sin(t) * (0.25 + cat.purr * 0.35)
      // Positive tips it towards +Z, which is over the animal's own back.
      tail.current.rotation.x = tucked ? 0.2 : 0.9
    }
  })

  if (!world) return null

  return (
    <group ref={group}>
      {/* The hitbox: one box round the whole animal, so the crosshair finds a
          cat rather than an ear. Invisible, and the only thing raycast. */}
      <group ref={hitbox}>
        <mesh position={[0, 0.2, 0.02]} visible={false}>
          <boxGeometry args={[0.26, 0.4, 0.62]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      <CatBody legs={[legA, legB]} />
      {/* The tail, at the -Z end now that the head is at +Z. */}
      <group ref={tail} position={[0, 0.25, -0.2]}>
        <mesh position={[0, 0.09, -0.03]} castShadow>
          <boxGeometry args={[0.035, 0.24, 0.035]} />
          <meshStandardMaterial color={FUR_DARK} roughness={1} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Take a book off a shelf, for the cat to carry.
 *
 * Goes through the same `unshelve` a hand does, so the layout is written down
 * and the book is genuinely off the shelf rather than duplicated. A cat that
 * conjured books would be a cat that quietly doubled your library.
 */
function takeFromShelf(shelfId: string | null): string | null {
  const shelf = useLibraryStore.getState()
  const world = useWorldStore.getState().world
  if (!shelfId || !world) return null
  const unit = world.shelves.find((candidate) => candidate.id === shelfId)
  if (!unit) return null

  for (let row = unit.rows - 1; row >= 0; row--) {
    const ids = shelf.rows[rowKey(shelfId, row)]
    if (!ids || ids.length === 0) continue
    const id = ids[Math.floor(Math.random() * ids.length)]!
    return shelf.unshelve(id) ? id : null
  }
  return null
}

/** Put the book down at the cat's feet, which is where a cat puts things. */
function drop(world: DerivedWorld, id: string) {
  const shelf = useLibraryStore.getState()
  const size = shelf.dims.get(id)
  const y = supportAt(world, cat.x, cat.z, cat.floor + 0.4)
  shelf.putDown(id, {
    x: cat.x,
    y: y + (size?.thickness ?? 0.03) / 2,
    z: cat.z,
    yaw: cat.yaw,
    open: false,
    spread: 0,
  })
}

/**
 * Call the cat. It comes if it feels like it, which is most of the time.
 *
 * The refusal is not a joke at your expense: without it, `V` is a teleport with
 * a delay, and the one thing that makes an animal read as an animal is that it
 * is not a button. It will always come if it is already awake.
 */
export function callCat(): boolean {
  if (cat.mood === 'fetch' || cat.mood === 'deliver') return true
  if (cat.mood === 'sleep' && Math.random() < 0.5) {
    // Woken, and unimpressed.
    cat.mood = 'sit'
    cat.patience = 6
    return false
  }
  cat.mood = 'come'
  cat.patience = 30
  cat.stuck = 0
  return true
}

/** A fuss. It sits, and it purrs, and the HUD says so. */
export function petCat() {
  cat.purr = 1
  if (cat.mood !== 'fetch' && cat.mood !== 'deliver') {
    cat.mood = 'sit'
    cat.patience = 8
  }
}

/**
 * Ask it for a book.
 *
 * It goes to a bookcase that actually has something on it, takes one down and
 * brings it to you. Which one is its choice, and that is the whole point —
 * "bring me a book" is a question you ask when you do not know what you want,
 * and an answer you chose would not be an answer.
 */
export function askCatForBook(): boolean {
  const world = useWorldStore.getState().world
  const shelf = useLibraryStore.getState()
  if (!world || cat.carrying) return false

  const stocked = world.shelves.filter((unit) =>
    Array.from({ length: unit.rows }, (_, row) => row).some(
      (row) => (shelf.rows[rowKey(unit.id, row)] ?? []).length > 0,
    ),
  )
  if (stocked.length === 0) return false

  // The nearest stocked case it has not just failed at, rather than any of them.
  // With no pathfinding, a case in the other building is an errand it cannot
  // finish — and a cat sent across a valley for a book is not what was asked.
  const chosen = stocked.reduce((best, unit) => {
    if (unit.id === cat.fetchingFrom) return best
    const to = (u: DerivedShelf) => Math.hypot(u.x - cat.x, u.z - cat.z) + Math.abs(u.y - cat.floor) * 8
    return to(unit) < to(best) ? unit : best
  }, stocked.find((unit) => unit.id !== cat.fetchingFrom) ?? stocked[0]!)
  cat.fetchingFrom = chosen.id
  // Stand in front of the case rather than inside it: a bookcase is solid, and
  // a cat walking at its centre never arrives.
  cat.targetX = chosen.x + Math.sin(chosen.rotationY) * 0.7
  cat.targetZ = chosen.z + Math.cos(chosen.rotationY) * 0.7
  cat.mood = 'fetch'
  cat.patience = 60
  cat.stuck = 0
  return true
}
