import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { library } from '../services'
import { sceneRefs } from './refs'
import { MATERIALS } from './materials'
import { useWorldStore } from '../state/world'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useAppStore } from '../state/store'
import { APPLIANCES, LAMPS, SITTABLE, type DerivedFurniture } from '../world/derive'

/**
 * Furniture, built from boxes and cylinders rather than shipped as models.
 *
 * The same reasoning as the floor texture: the repo stays text, the proportions
 * stay legible, and a chair is a few numbers you can argue with. Nothing here is
 * detailed enough to inspect closely — it is meant to read correctly at the
 * distance you actually see it from, which is standing up, across a room.
 *
 * Three groups are published to `sceneRefs` rather than being raycast as one
 * scene: what you can sit on, what you can put a book down on, and what you can
 * *operate* — a lamp, the deck, the coffee maker. The crosshair asks a
 * different question of each, and asking all three of every table leg in the
 * cabin is the one thing in the frame that would actually cost something.
 */

// Moss rather than leather: with the floor, the shelves and the ceiling all in
// wood, brown seating made the whole room one material. Green is what a cabin
// puts against timber.
const CLOTH = '#63705a'
const CLOTH_DARK = '#525e4b'
const OAK = '#8a6039'
const PINE = '#b08e63'
const WOOL = '#8c6f58'
const BRASS = '#b08d57'
const SHADE = '#f2e3c4'
const CARD = '#b9915f'
const CARD_DARK = '#a07a4b'
const SLATE = '#4a4a4a'
const STEEL = '#8f9296'
const LEAF = '#3f6b42'
const TERRACOTTA = '#9c5a3c'

/** Warm bulb colour, shared by everything that lights the room. */
const BULB = '#ffd9a0'

function Armchair() {
  return (
    <group>
      {/* seat, back, two arms — a wing chair reduced to its four masses */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.16, 0.74]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.62, -0.31]} castShadow receiveShadow>
        <boxGeometry args={[0.78, 0.62, 0.16]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      <mesh position={[-0.35, 0.55, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.28, 0.72]} />
        <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
      </mesh>
      <mesh position={[0.35, 0.55, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.28, 0.72]} />
        <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
      </mesh>
      {/* a seat cushion, slightly proud, so the seat is not a slab */}
      <mesh position={[0, 0.5, 0.02]} castShadow>
        <boxGeometry args={[0.7, 0.1, 0.66]} />
        <meshStandardMaterial color={CLOTH} roughness={1} />
      </mesh>
      {[-0.3, 0.3].map((x) =>
        [-0.28, 0.28].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.16, z]} castShadow>
            <boxGeometry args={[0.07, 0.32, 0.07]} />
            <meshStandardMaterial color={OAK} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Sofa({ width }: { width: number }) {
  return (
    <group>
      <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.16, 0.8]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.6, -0.34]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.52, 0.16]} />
        <meshStandardMaterial color={CLOTH} roughness={0.95} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (width - 0.14)) / 2, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.14, 0.28, 0.78]} />
          <meshStandardMaterial color={CLOTH_DARK} roughness={0.95} />
        </mesh>
      ))}
      {/* Two cushions rather than one long slab, which is what makes it a sofa. */}
      {[-1, 1].map((side) => (
        <mesh key={`c${side}`} position={[(side * width) / 4, 0.48, 0.03]} castShadow>
          <boxGeometry args={[width / 2 - 0.12, 0.11, 0.7]} />
          <meshStandardMaterial color={CLOTH} roughness={1} />
        </mesh>
      ))}
      {[-1, 1].map((side) =>
        [-0.3, 0.3].map((z) => (
          <mesh key={`l${side}:${z}`} position={[(side * (width - 0.3)) / 2, 0.14, z]} castShadow>
            <boxGeometry args={[0.07, 0.28, 0.07]} />
            <meshStandardMaterial color={OAK} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function DiningChair() {
  return (
    <group>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.04, 0.42]} />
        <meshStandardMaterial color={PINE} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.7, -0.19]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.44, 0.035]} />
        <meshStandardMaterial color={PINE} roughness={0.7} />
      </mesh>
      {[-0.17, 0.17].map((x) =>
        [-0.17, 0.17].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.22, z]} castShadow>
            <boxGeometry args={[0.04, 0.44, 0.04]} />
            <meshStandardMaterial color={PINE} roughness={0.75} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Bench({ width }: { width: number }) {
  return (
    <group>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.05, 0.36]} />
        <meshStandardMaterial color={PINE} roughness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (width - 0.16)) / 2, 0.2, 0]} castShadow>
          <boxGeometry args={[0.06, 0.4, 0.32]} />
          <meshStandardMaterial color={PINE} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Footstool() {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.14, 0.38]} />
        <meshStandardMaterial color={CLOTH} roughness={1} />
      </mesh>
      {[-0.17, 0.17].map((x) =>
        [-0.13, 0.13].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.12, z]} castShadow>
            <boxGeometry args={[0.05, 0.24, 0.05]} />
            <meshStandardMaterial color={OAK} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function SideTable({ height }: { height: number }) {
  const top = height - 0.02
  return (
    <group>
      <mesh position={[0, top, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.035, 0.46]} />
        <meshStandardMaterial color={OAK} roughness={0.6} />
      </mesh>
      <mesh position={[0, top / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, top, 12]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.19, 0.2, 0.03, 16]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
    </group>
  )
}

function Table({ width, depth, height }: { width: number; depth: number; height: number }) {
  const inset = 0.09
  return (
    <group>
      <mesh position={[0, height - 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.04, depth]} />
        <meshStandardMaterial color={PINE} roughness={0.62} />
      </mesh>
      {/* An apron, so the top does not read as a plank floating on sticks. */}
      <mesh position={[0, height - 0.09, 0]} castShadow>
        <boxGeometry args={[width - 0.12, 0.08, depth - 0.12]} />
        <meshStandardMaterial color={PINE} roughness={0.8} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}:${sz}`}
            position={[(sx * (width - inset * 2)) / 2, (height - 0.04) / 2, (sz * (depth - inset * 2)) / 2]}
            castShadow
          >
            <boxGeometry args={[0.07, height - 0.04, 0.07]} />
            <meshStandardMaterial color={PINE} roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  )
}

function Rug({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      <mesh position={[0, 0.006, 0]} receiveShadow>
        <boxGeometry args={[width, 0.012, depth]} />
        <meshStandardMaterial color={WOOL} roughness={1} />
      </mesh>
      {/* a border, so it reads as a rug rather than as a stain on the floor */}
      <mesh position={[0, 0.013, 0]} receiveShadow>
        <boxGeometry args={[width - 0.22, 0.002, depth - 0.22]} />
        <meshStandardMaterial color="#9d8064" roughness={1} />
      </mesh>
    </group>
  )
}

function FloorLamp({ lit }: { lit: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.17, 0.04, 16]} />
        <meshStandardMaterial color={BRASS} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 1.4, 10]} />
        <meshStandardMaterial color={BRASS} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.28, 20, 1, true]} />
        <meshStandardMaterial
          color={SHADE}
          roughness={1}
          side={THREE.DoubleSide}
          emissive={lit ? SHADE : '#000000'}
          emissiveIntensity={lit ? 0.4 : 0}
        />
      </mesh>
    </group>
  )
}

/** A pendant on a flex. Its `y` is the fitting, so it hangs from there down. */
function Pendant({ lit }: { lit: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.64, 6]} />
        <meshStandardMaterial color="#3a332c" roughness={1} />
      </mesh>
      <mesh position={[0, -0.06, 0]} castShadow>
        <coneGeometry args={[0.17, 0.16, 20, 1, true]} />
        <meshStandardMaterial
          color={lit ? SHADE : '#c8bda6'}
          roughness={0.85}
          side={THREE.DoubleSide}
          emissive={lit ? SHADE : '#000000'}
          emissiveIntensity={lit ? 0.5 : 0}
        />
      </mesh>
    </group>
  )
}

function Fireplace({ width, height, lit }: { width: number; height: number; lit: boolean }) {
  const openingW = width * 0.55
  const openingH = height * 0.42
  return (
    <group>
      {/* A stone surround with the firebox cut out of it, as four slabs. */}
      <mesh position={[0, height / 2, -0.12]} castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.26]} />
        <meshStandardMaterial color={MATERIALS.stone} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (width - (width - openingW) / 2)) / 2, openingH / 2, 0.06]} castShadow>
          <boxGeometry args={[(width - openingW) / 2, openingH, 0.24]} />
          <meshStandardMaterial color={MATERIALS.stone} roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, openingH + (height - openingH) / 2, 0.06]} castShadow receiveShadow>
        <boxGeometry args={[width, height - openingH, 0.24]} />
        <meshStandardMaterial color={MATERIALS.stone} roughness={1} />
      </mesh>
      {/* A mantel to put things on. */}
      <mesh position={[0, height + 0.03, 0.06]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.16, 0.07, 0.32]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
      {/* The fire itself: two blocks of glow behind the opening. Nothing
          animates — a flicker you see out of the corner of your eye all evening
          is a distraction, not atmosphere. */}
      <mesh position={[0, 0.12, -0.06]}>
        <boxGeometry args={[openingW * 0.8, 0.16, 0.16]} />
        <meshStandardMaterial
          color={lit ? '#c9541e' : '#2b241d'}
          emissive={lit ? '#ff7a2a' : '#000000'}
          emissiveIntensity={lit ? 1.6 : 0}
          roughness={1}
        />
      </mesh>
      <mesh position={[0, 0.05, -0.02]}>
        <boxGeometry args={[openingW * 0.9, 0.08, 0.2]} />
        <meshStandardMaterial color="#2a2320" roughness={1} />
      </mesh>
    </group>
  )
}

/**
 * A plant: a pot and a fan of leaves.
 *
 * The leaves are merged into one geometry rather than left as seven cones.
 * Nothing here moves relative to anything else, and seven draw calls apiece
 * across a cabin's worth of greenery is more than the greenery is worth.
 */
function Plant({ height }: { height: number }) {
  const potHeight = Math.min(0.3, height * 0.32)

  const foliage = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + 0.4
      const lean = 0.42 + (i % 3) * 0.12
      const scale = 0.75 + ((i * 7) % 5) / 10
      const cone = new THREE.ConeGeometry(0.075 * scale, (height - potHeight) * 1.05 * scale, 5)
      cone.applyMatrix4(
        new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(lean * Math.sin(angle), -angle, lean * Math.cos(angle)),
        ),
      )
      cone.translate(
        Math.cos(angle) * 0.1,
        potHeight + (height - potHeight) * 0.55,
        Math.sin(angle) * 0.1,
      )
      parts.push(cone)
    }
    const merged = mergeGeometries(parts, false)
    parts.forEach((part) => part.dispose())
    return merged
  }, [height, potHeight])
  useEffect(() => () => foliage?.dispose(), [foliage])

  return (
    <group>
      <mesh position={[0, potHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.15, 0.11, potHeight, 14]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
      </mesh>
      <mesh position={[0, potHeight + 0.005, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.02, 14]} />
        <meshStandardMaterial color="#3a2c22" roughness={1} />
      </mesh>
      {foliage && (
        <mesh geometry={foliage} castShadow>
          <meshStandardMaterial color={LEAF} roughness={1} flatShading />
        </mesh>
      )}
    </group>
  )
}

function KitchenCounter({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <group>
      <mesh position={[0, (height - 0.04) / 2 + 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.1, depth - 0.04]} />
        <meshStandardMaterial color="#6f5540" roughness={0.8} />
      </mesh>
      {/* A worktop, proud on every side, which is what makes it a counter. */}
      <mesh position={[0, height - 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.03, 0.04, depth]} />
        <meshStandardMaterial color={SLATE} roughness={0.35} metalness={0.15} />
      </mesh>
      {/* Recessed plinth, and two drawer lines scored across the front. */}
      <mesh position={[0, 0.03, -0.02]}>
        <boxGeometry args={[width - 0.06, 0.06, depth - 0.12]} />
        <meshStandardMaterial color="#3a2e24" roughness={1} />
      </mesh>
      {[0.3, 0.62].map((f) => (
        <mesh key={f} position={[0, height * f, depth / 2 - 0.015]}>
          <boxGeometry args={[width - 0.1, 0.012, 0.02]} />
          <meshStandardMaterial color="#54402f" roughness={1} />
        </mesh>
      ))}
      {/* A sink, because a kitchen counter without one is a sideboard. */}
      <mesh position={[width * 0.3, height - 0.03, 0]}>
        <boxGeometry args={[0.4, 0.03, depth * 0.6]} />
        <meshStandardMaterial color={STEEL} roughness={0.28} metalness={0.75} />
      </mesh>
      <mesh position={[width * 0.3, height + 0.14, -depth * 0.28]}>
        <cylinderGeometry args={[0.015, 0.015, 0.28, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.25} metalness={0.8} />
      </mesh>
    </group>
  )
}

function CoffeeMaker({ brewing }: { brewing: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.05, -0.04]} castShadow receiveShadow>
        <boxGeometry args={[0.22, 0.1, 0.2]} />
        <meshStandardMaterial color="#2e2b28" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.24, -0.07]} castShadow>
        <boxGeometry args={[0.2, 0.28, 0.14]} />
        <meshStandardMaterial color="#2e2b28" roughness={0.5} />
      </mesh>
      {/* The carafe. Fills up while it brews, which is the whole animation. */}
      <mesh position={[0, 0.16, 0.04]} castShadow>
        <cylinderGeometry args={[0.065, 0.058, 0.14, 12]} />
        <meshStandardMaterial color="#d8d4cc" roughness={0.25} transparent opacity={0.45} />
      </mesh>
      <mesh position={[0, 0.13, 0.04]}>
        <cylinderGeometry args={[0.058, 0.052, brewing ? 0.09 : 0.02, 12]} />
        <meshStandardMaterial color="#40251a" roughness={0.4} />
      </mesh>
      <mesh position={[0.07, 0.11, -0.02]}>
        <boxGeometry args={[0.02, 0.012, 0.012]} />
        <meshStandardMaterial
          color={brewing ? '#ff5a3a' : '#503c34'}
          emissive={brewing ? '#ff5a3a' : '#000000'}
          emissiveIntensity={brewing ? 2 : 0}
        />
      </mesh>
    </group>
  )
}

/** A crate for records, open at the front, with a top you can put things on. */
function RecordShelf({ width, depth, height }: { width: number; depth: number; height: number }) {
  const wall = 0.026
  return (
    <group>
      <mesh position={[0, height - wall / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={OAK} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (width - wall)) / 2, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={OAK} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, height / 2, -depth / 2 + wall / 2]} receiveShadow>
        <boxGeometry args={[width, height, wall]} />
        <meshStandardMaterial color="#6d4b2e" roughness={0.9} />
      </mesh>
      {/* A divider, so a half-empty crate does not look like a bookcase. */}
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[0.012, height - 0.12, depth - 0.06]} />
        <meshStandardMaterial color="#7a5638" roughness={0.8} />
      </mesh>
      {[-0.1, 0.1].map((z) => (
        <mesh key={z} position={[0, 0.03, z]}>
          <boxGeometry args={[width - 0.1, 0.05, 0.05]} />
          <meshStandardMaterial color="#5c3f27" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

/** The deck. A plinth, a platter, an arm, and a record on it when one is on. */
function RecordPlayer({ spinning, loaded }: { spinning: boolean; loaded: boolean }) {
  const platter = useRef<THREE.Group>(null)
  const angle = useRef(0)

  // Turned by hand rather than with useFrame from the parent: the platter is
  // the only thing in the cabin that moves on its own, and it should stop when
  // the needle lifts rather than free-wheel forever.
  useEffect(() => {
    if (!spinning) return
    let running = true
    let last = performance.now()
    const tick = (now: number) => {
      if (!running) return
      // 33 1/3 rpm is 3.49 radians a second, which is genuinely what it is.
      angle.current += ((now - last) / 1000) * 3.49
      last = now
      if (platter.current) platter.current.rotation.y = angle.current
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      running = false
    }
  }, [spinning])

  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.08, 0.36]} />
        <meshStandardMaterial color="#3b332c" roughness={0.55} />
      </mesh>
      <group ref={platter} position={[-0.05, 0.09, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.145, 0.145, 0.014, 28]} />
          <meshStandardMaterial color="#57504a" roughness={0.6} metalness={0.3} />
        </mesh>
        {loaded && (
          <>
            <mesh position={[0, 0.009, 0]}>
              <cylinderGeometry args={[0.148, 0.148, 0.004, 28]} />
              <meshStandardMaterial color="#141414" roughness={0.42} />
            </mesh>
            <mesh position={[0, 0.012, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.002, 20]} />
              <meshStandardMaterial color="#c2453a" roughness={0.85} />
            </mesh>
          </>
        )}
        <mesh position={[0, 0.014, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.022, 8]} />
          <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
      {/* The tonearm, swung in over the record when one is playing. */}
      <group position={[0.16, 0.09, -0.11]} rotation-y={spinning ? -0.75 : -0.15}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.022, 0.026, 0.04, 10]} />
          <meshStandardMaterial color={STEEL} roughness={0.35} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.045, 0.11]}>
          <boxGeometry args={[0.012, 0.008, 0.22]} />
          <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.75} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Artwork is anything somebody drops in a folder, which includes photographs
 * far larger than a GPU texture is allowed to be — and an oversized upload
 * fails silently, leaving a black canvas in the frame. So the image is decoded
 * and redrawn into a capped canvas rather than handed to the GPU raw; at frame
 * size on a wall, a couple of thousand pixels is already more than the screen
 * will ever show of it.
 */
const ARTWORK_MAX_PX = 2048

function artworkTexture(source: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onerror = () => resolve(null)
    image.onload = () => {
      const scale = Math.min(1, ARTWORK_MAX_PX / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      resolve(texture)
    }
    image.src = source
  })
}

/** A picture, in a frame, with a mount. The artwork itself is loaded lazily. */
function Picture({ item, source }: { item: DerivedFurniture; source: string | null }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const width = item.width
  const height = item.height

  useEffect(() => {
    if (!source) return
    let cancelled = false
    void artworkTexture(source).then((loaded) => {
      // A picture that will not load is an empty mount, not a broken app.
      if (!loaded) return
      if (cancelled) loaded.dispose()
      else setTexture(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [source])
  useEffect(() => () => texture?.dispose(), [texture])

  const frame = 0.045
  const mount = 0.035

  return (
    <group>
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + frame * 2, height + frame * 2, 0.04]} />
        <meshStandardMaterial color="#5a3d26" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[width + mount, height + mount]} />
        <meshStandardMaterial color="#efe9dc" roughness={1} />
      </mesh>
      <mesh position={[0, 0, 0.023]}>
        <planeGeometry args={[width, height]} />
        {/* Keyed so the artwork arriving mounts a *new* material. Swapping a
            map into a live material reuses its map-less shader program and
            draws black, which is exactly the "black picture" this replaces. */}
        {texture ? (
          <meshStandardMaterial key="art" map={texture} roughness={0.85} />
        ) : (
          <meshStandardMaterial key="mount" color="#d8d0be" roughness={1} />
        )}
      </mesh>
    </group>
  )
}

/** An open moving box, flaps folded out. */
function MovingBox({ width, depth }: { width: number; depth: number }) {
  const height = 0.36
  const wall = 0.014
  return (
    <group>
      <mesh position={[0, wall / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={CARD_DARK} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`x${side}`}
          position={[(side * (width - wall)) / 2, height / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`z${side}`}
          position={[0, height / 2, (side * (depth - wall)) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {/* flaps, folded down the outside */}
      {[-1, 1].map((side) => (
        <mesh
          key={`flap${side}`}
          position={[0, height - 0.06, (side * (depth + 0.02)) / 2]}
          rotation-x={side * 0.5}
          castShadow
        >
          <boxGeometry args={[width * 0.98, 0.16, wall]} />
          <meshStandardMaterial color={CARD_DARK} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * A flight of stairs, as actual treads.
 *
 * The ramp the walk controller climbs is continuous — see `floorAt` — while
 * what you see is steps, which is the usual and entirely acceptable lie. The
 * rise per tread is chosen so that a flight of any height gets treads of about
 * 18 cm, which is what a staircase looks like.
 */
function Stairs({ width, run, rise }: { width: number; run: number; rise: number }) {
  const steps = Math.max(2, Math.round(rise / 0.18))
  const treadDepth = run / steps
  const stepRise = rise / steps

  // A dozen treads and two dozen stringer pieces, as two geometries. Built once
  // per flight: a staircase is the most box-heavy thing in the room and none of
  // it moves.
  const [treads, stringers] = useMemo(() => {
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const part = new THREE.BoxGeometry(w, h, d)
      part.translate(x, y, z)
      return part
    }

    const tread: THREE.BufferGeometry[] = []
    const side: THREE.BufferGeometry[] = []
    for (let i = 0; i < steps; i++) {
      const z = -run / 2 + treadDepth * (i + 0.5)
      tread.push(box(width, stepRise, treadDepth, 0, stepRise * (i + 0.5), z))
      // A stringer stepped with the treads rather than run as one slab: a
      // full-height box beside a staircase is a wall, and looks exactly like
      // one from the landing.
      for (const hand of [-1, 1]) {
        side.push(
          box(
            0.05,
            stepRise * 1.5,
            treadDepth,
            (hand * (width + 0.05)) / 2,
            stepRise * (i + 0.5) - stepRise * 0.25,
            z,
          ),
        )
      }
    }

    const merged: [THREE.BufferGeometry | null, THREE.BufferGeometry | null] = [
      mergeGeometries(tread, false),
      mergeGeometries(side, false),
    ]
    tread.forEach((part) => part.dispose())
    side.forEach((part) => part.dispose())
    return merged
  }, [steps, run, rise, width, treadDepth, stepRise])

  useEffect(
    () => () => {
      treads?.dispose()
      stringers?.dispose()
    },
    [treads, stringers],
  )

  return (
    <group>
      {treads && (
        <mesh geometry={treads} castShadow receiveShadow>
          <meshStandardMaterial color={PINE} roughness={0.78} />
        </mesh>
      )}
      {stringers && (
        <mesh geometry={stringers} castShadow>
          <meshStandardMaterial color={OAK} roughness={0.8} />
        </mesh>
      )}
    </group>
  )
}

function Piece({ item, source }: { item: DerivedFurniture; source: string | null }) {
  const lit = useLightStore((s) => (LAMPS.has(item.kind) ? s.isOn(item.id, item.on ?? true) : false))
  const playing = useMediaStore((s) => s.playing)
  const paused = useMediaStore((s) => s.paused)
  const brewing = useAppStore((s) => s.brewing === item.id)

  const body = (() => {
    switch (item.kind) {
      case 'armchair':
        return <Armchair />
      case 'sofa':
        return <Sofa width={item.width} />
      case 'diningchair':
        return <DiningChair />
      case 'bench':
        return <Bench width={item.width} />
      case 'footstool':
        return <Footstool />
      case 'sidetable':
        return <SideTable height={item.height} />
      case 'table':
        return <Table width={item.width} depth={item.depth} height={item.height} />
      case 'rug':
        return <Rug width={item.width} depth={item.depth} />
      case 'floorlamp':
        return <FloorLamp lit={lit} />
      case 'pendant':
        return <Pendant lit={lit} />
      case 'fireplace':
        return <Fireplace width={item.width} height={item.height} lit={lit} />
      case 'plant':
        return <Plant height={item.height} />
      case 'kitchencounter':
        return <KitchenCounter width={item.width} depth={item.depth} height={item.height} />
      case 'coffeemaker':
        return <CoffeeMaker brewing={brewing} />
      case 'recordshelf':
        return <RecordShelf width={item.width} depth={item.depth} height={item.height} />
      case 'recordplayer':
        return <RecordPlayer spinning={playing !== null && !paused} loaded={playing !== null} />
      case 'picture':
        return <Picture item={item} source={source} />
      case 'box':
        return <MovingBox width={item.width} depth={item.depth} />
      case 'stairs':
        return <Stairs width={item.width} run={item.depth} rise={item.height} />
    }
  })()

  return (
    <group
      position={[item.x, item.y, item.z]}
      rotation-y={item.rotationY}
      // Carried on the group so a hit on any of the chair's several meshes
      // resolves to the piece of furniture, not to an arm or a leg.
      userData={{ furnitureId: item.id }}
    >
      {body}
    </group>
  )
}

export function Furniture() {
  const world = useWorldStore((s) => s.world)
  const artwork = useMediaStore((s) => s.artwork)
  const seats = useRef<THREE.Group>(null)
  const boxes = useRef<THREE.Group>(null)
  const surfaces = useRef<THREE.Group>(null)
  const fixtures = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    sceneRefs.seats = seats.current
    sceneRefs.boxes = boxes.current
    sceneRefs.surfaces = surfaces.current
    sceneRefs.fixtures = fixtures.current
    return () => {
      sceneRefs.seats = null
      sceneRefs.boxes = null
      sceneRefs.surfaces = null
      sceneRefs.fixtures = null
    }
  }, [world, artwork])

  /**
   * Which picture hangs in which frame.
   *
   * A frame with a `source` names its file; the rest are dealt out of the
   * artwork folder in document order, so dropping images into `artwork/` is the
   * whole of the work. Dealing rather than repeating means two frames in the
   * same room do not show the same print.
   */
  const sources = useMemo(() => {
    if (!world) return new Map<string, string>()
    const frames = world.furniture.filter((item) => item.kind === 'picture')
    const named = new Set(
      frames.map((frame) => frame.source).filter((name): name is string => !!name),
    )
    const spare = artwork.filter(
      (picture) => ![...named].some((name) => picture.path.endsWith(name)),
    )

    const out = new Map<string, string>()
    let next = 0
    for (const frame of frames) {
      const match = frame.source
        ? artwork.find((picture) => picture.path.endsWith(frame.source!))
        : spare[next++ % Math.max(1, spare.length)]
      if (match) out.set(frame.id, library.assetUrl(match.path))
    }
    return out
  }, [world, artwork])

  if (!world) return null

  const sittable = world.furniture.filter((item) => SITTABLE.has(item.kind))
  const movingBoxes = world.furniture.filter((item) => item.kind === 'box')
  const operable = world.furniture.filter(
    (item) => LAMPS.has(item.kind) || APPLIANCES.has(item.kind),
  )
  const tops = world.furniture.filter(
    (item) => item.surface && !SITTABLE.has(item.kind) && item.kind !== 'box',
  )
  const claimed = new Set([...sittable, ...movingBoxes, ...operable, ...tops].map((i) => i.id))
  const rest = world.furniture.filter((item) => !claimed.has(item.id))

  return (
    <group>
      {rest.map((item) => (
        <Piece key={`${item.roomId}:${item.id}`} item={item} source={sources.get(item.id) ?? null} />
      ))}

      {/* Kept in their own groups so the crosshair can raycast only the things
          worth pointing at, rather than every rug and table leg in the room. */}
      <group ref={seats}>
        {sittable.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} source={null} />
        ))}
      </group>

      <group ref={boxes}>
        {movingBoxes.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} source={null} />
        ))}
      </group>

      <group ref={surfaces}>
        {tops.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} source={null} />
        ))}
      </group>

      <group ref={fixtures}>
        {operable.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} source={null} />
        ))}
      </group>
    </group>
  )
}

/**
 * The lights themselves, separate from the furniture that carries them.
 *
 * A `pointLight` inside `Piece` would be remounted every time the piece
 * re-rendered for an unrelated reason, and three re-allocates a shadow map when
 * that happens. Here they are one flat list keyed by furniture id, and turning
 * one off is a prop change.
 */
export function FurnitureLights() {
  const world = useWorldStore((s) => s.world)
  const on = useLightStore((s) => s.on)
  if (!world) return null

  return (
    <>
      {world.lights.map((lamp) => {
        const lit = on[lamp.id] ?? lamp.defaultOn
        if (!lit) return null
        const fire = lamp.kind === 'fireplace'
        return (
          <pointLight
            key={lamp.id}
            // Candela, falling off with the square of distance, so these are
            // larger than they look: at the 2 m from a pendant to the table
            // under it, 4.5 cd arrives as just over 1. Argued down twice from
            // hotter values: intensity makes the glare pool by the fitting,
            // distance is what carries a soft edge into the corners.
            intensity={fire ? 4.5 : lamp.kind === 'pendant' ? 4.5 : 2.8}
            position={[lamp.x, lamp.y, lamp.z]}
            distance={fire ? 6 : lamp.kind === 'pendant' ? 10 : 5.6}
            color={fire ? '#ff9346' : BULB}
          />
        )
      })}
    </>
  )
}
