import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { library } from '../services'
import { sceneRefs } from './refs'
import { MATERIALS } from './materials'
import { drawing, makeBoardCanvas } from './board'
import { MARKER_INKS, inkAt } from '../data/inks'
import { useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useAppStore } from '../state/store'
import { APPLIANCES, LAMPS, SITTABLE, WALL_MOUNTED, type DerivedFurniture } from '../world/derive'
import { makeSleeveTexture, sleeveArtFor } from './recordAtlas'
import { useVideoStore, videoElement } from '../state/video'
import { arcadeMachine, useArcadeStore } from '../state/arcade'
import { makeArcadeScreen } from './arcadeScreen'
import { PropModel } from './Props'

/**
 * Furniture, built from boxes and cylinders rather than shipped as models: the
 * repo stays text and the proportions stay arguable. Nothing is detailed enough
 * to inspect closely — it reads at the distance you see it from.
 *
 * Groups are published to `sceneRefs` rather than raycast as one scene — seats,
 * surfaces, fixtures, boxes, boards — because the crosshair asks a different
 * question of each.
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
// Soapstone and aged brushed metal rather than commercial grey: the kitchen
// was the one corner still furnished from a catalogue.
const SLATE = '#3f4440'
const STEEL = '#7e8177'
const LEAF = '#3f6b42'
const TERRACOTTA = '#9c5a3c'
// Glazed white with a hint of the room in it. Pure white in a timber cabin reads
// as a hole rather than as a bath.
const PORCELAIN = '#e6e4dd'
// The beige-grey of every television ever sold in 1987, and the dead green a
// switched-off tube actually is — not black, which is what a dark grey box in a
// dim room reads as when you get it wrong.
const CASING = '#b9b2a1'
const CASING_DARK = '#8e887a'
const TUBE_OFF = '#2b322e'
const BOARD_WHITE = '#eef0ee'
const ALUMINIUM = '#a9aeb0'
// The colour every office machine was between about 1984 and 1997, and the
// shadow side of it.
const PUTTY = '#c9c2ad'
const PUTTY_DARK = '#a29a86'

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

/**
 * A bed: frame, mattress, duvet and pillows. The headboard is the -Z end, so
 * `facing: 0` points the foot into the room. It is a surface — a book left on
 * the covers is exactly where books end up — and you can sit on the edge.
 */
function Bed({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.24, depth]} />
        <meshStandardMaterial color={PINE} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.35, -depth / 2 + 0.025]} castShadow>
        <boxGeometry args={[width, 0.6, 0.05]} />
        <meshStandardMaterial color={OAK} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.08, 0.16, depth - 0.06]} />
        <meshStandardMaterial color="#e7ded0" roughness={0.95} />
      </mesh>
      {/* The duvet, thrown over the foot two-thirds. */}
      <mesh position={[0, 0.43, depth * 0.17]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.02, 0.09, depth * 0.62]} />
        <meshStandardMaterial color={CLOTH} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 4 - 0.02), 0.45, -depth / 2 + 0.3]} castShadow>
          <boxGeometry args={[width / 2 - 0.16, 0.1, 0.4]} />
          <meshStandardMaterial color={SHADE} roughness={0.95} />
        </mesh>
      ))}
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

/**
 * A string of bulbs, sagging between its two ends.
 *
 * `size` is [length, sag] and `y` is the height it is strung at. The flex is
 * drawn as short segments following the same catenary the bulbs hang from, so
 * the line and the lights cannot drift apart.
 */
function FairyLights({ width, sag, lit }: { width: number; sag: number; lit: boolean }) {
  const bulbs = Math.max(4, Math.round(width / 0.26))
  // Normalised -1..1 across the span, so the shape is the same at any length.
  const dip = (t: number) => -sag * (1 - t * t)

  // Merged: a string used to be ~36 flex-segment meshes plus a mesh per bulb —
  // the single most draw-call-dense piece in the file, times every string in
  // the map. The flex is one geometry, the bulbs one instanced mesh: two draws
  // for the lot, the `Plant` foliage argument at greater length.
  const flex = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const segments = bulbs * 3
    for (let i = 0; i < segments - 1; i++) {
      const t = (i / (segments - 1)) * 2 - 1
      const next = ((i + 1) / (segments - 1)) * 2 - 1
      const x = (t * width) / 2
      const dx = ((next - t) * width) / 2
      const dy = dip(next) - dip(t)
      const piece = new THREE.BoxGeometry(Math.hypot(dx, dy), 0.005, 0.005)
      piece.rotateZ(Math.atan2(dy, dx))
      piece.translate(x + dx / 2, dip(t) + dy / 2, 0)
      parts.push(piece)
    }
    const merged = mergeGeometries(parts, false)
    parts.forEach((part) => part.dispose())
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulbs, width, sag])
  useEffect(() => () => flex?.dispose(), [flex])

  const bulbRef = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = bulbRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < bulbs; i++) {
      const t = (i / (bulbs - 1)) * 2 - 1
      matrix.makeTranslation((t * width) / 2, dip(t) - 0.035, 0)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulbs, width, sag])

  if (!flex) return null
  return (
    <group>
      <mesh geometry={flex}>
        <meshStandardMaterial color="#2f2a24" roughness={1} />
      </mesh>
      <instancedMesh key={bulbs} ref={bulbRef} args={[undefined, undefined, bulbs]}>
        <sphereGeometry args={[0.018, 8, 6]} />
        <meshStandardMaterial
          color={lit ? '#ffe6b0' : '#cdc4b2'}
          emissive={lit ? '#ffcf82' : '#000000'}
          emissiveIntensity={lit ? 1.4 : 0}
          roughness={0.5}
        />
      </instancedMesh>
    </group>
  )
}

/**
 * A switch plate. One press works every light in the library, which is what a
 * switch by the door is actually for.
 */
function LightSwitch({ width, height, allOn }: { width: number; height: number; allOn: boolean }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.012]} />
        <meshStandardMaterial color="#e8e3d8" roughness={0.6} />
      </mesh>
      {/* The rocker, tipped the way the lights are. */}
      <mesh position={[0, allOn ? 0.012 : -0.012, 0.012]} rotation-x={allOn ? 0.28 : -0.28}>
        <boxGeometry args={[width * 0.52, height * 0.44, 0.01]} />
        <meshStandardMaterial color="#d5cfc2" roughness={0.5} />
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

/**
 * A bath: a tub with a rim you can sit on and leave a book on, and a mixer at
 * the head end. The water is a plane a hair under the rim rather than a volume —
 * from anywhere you stand, a bath is its surface.
 */
function Bathtub({ width, depth, height }: { width: number; depth: number; height: number }) {
  const wall = 0.055
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.28} />
      </mesh>
      {/* The well, sunk into the top. */}
      <mesh position={[0, height - 0.02, 0]}>
        <boxGeometry args={[width - wall * 2, 0.04, depth - wall * 2]} />
        <meshStandardMaterial color="#cfd6d4" roughness={0.35} />
      </mesh>
      <mesh position={[0, height - 0.06, 0]}>
        <boxGeometry args={[width - wall * 2.4, 0.01, depth - wall * 2.4]} />
        <meshStandardMaterial color="#8fb6bd" roughness={0.15} transparent opacity={0.72} />
      </mesh>
      <mesh position={[-width / 2 + 0.1, height + 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 0.24, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.24} metalness={0.8} />
      </mesh>
      <mesh position={[-width / 2 + 0.17, height + 0.22, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.24} metalness={0.8} />
      </mesh>
    </group>
  )
}

/** A cistern, a pan and a lid. Facing points the seat into the room. */
function Toilet({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <group>
      <mesh position={[0, height * 0.72, -depth / 2 + 0.09]} castShadow receiveShadow>
        <boxGeometry args={[width, height * 0.56, 0.18]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, depth * 0.06]} castShadow receiveShadow>
        <cylinderGeometry args={[width * 0.36, width * 0.26, 0.4, 14]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.42, depth * 0.06]} castShadow>
        <cylinderGeometry args={[width * 0.44, width * 0.42, 0.05, 16]} />
        <meshStandardMaterial color="#e9e6df" roughness={0.5} />
      </mesh>
    </group>
  )
}

/** A basin on a pedestal, with a mirror-less tap. */
function Basin({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <group>
      <mesh position={[0, height * 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[width * 0.2, width * 0.26, height * 0.8, 12]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.32} />
      </mesh>
      <mesh position={[0, height - 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.12, depth]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.28} />
      </mesh>
      <mesh position={[0, height - 0.02, 0.02]}>
        <boxGeometry args={[width - 0.14, 0.03, depth - 0.14]} />
        <meshStandardMaterial color="#d3d8d5" roughness={0.36} />
      </mesh>
      <mesh position={[0, height + 0.08, -depth / 2 + 0.06]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.16, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.24} metalness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * A wall clock, telling the machine's own time.
 *
 * The hands are turned in a frame loop rather than re-rendered: a clock that
 * re-rendered React sixty times a second to move a minute hand would be the most
 * expensive ornament in the building. The seconds are read from the system clock
 * every frame and the hands are set from that, so it stays right after a pause,
 * a tab switch or a laptop lid.
 */
function Clock({ size }: { size: number }) {
  const hour = useRef<THREE.Group>(null)
  const minute = useRef<THREE.Group>(null)
  const second = useRef<THREE.Group>(null)

  useFrame(() => {
    const now = new Date()
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000
    const minutes = now.getMinutes() + seconds / 60
    const hours = (now.getHours() % 12) + minutes / 60
    // Negative because a hand sweeps clockwise and Z is out of the face.
    if (hour.current) hour.current.rotation.z = -(hours / 12) * Math.PI * 2
    if (minute.current) minute.current.rotation.z = -(minutes / 60) * Math.PI * 2
    if (second.current) second.current.rotation.z = -(seconds / 60) * Math.PI * 2
  })

  const radius = size / 2
  const hand = (length: number, thickness: number, colour: string, z: number) => (
    <mesh position={[0, length / 2 - thickness, z]}>
      <boxGeometry args={[thickness, length, 0.006]} />
      <meshStandardMaterial color={colour} roughness={0.6} />
    </mesh>
  )

  return (
    <group>
      {/* The case: a cylinder laid on its side, so it faces the room. */}
      <mesh rotation-x={Math.PI / 2} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.05, 28]} />
        <meshStandardMaterial color={OAK} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <circleGeometry args={[radius * 0.88, 28]} />
        <meshStandardMaterial color="#f2ece0" roughness={0.85} />
      </mesh>
      {/* Twelve marks, the quarters longer — enough to read the time by from
          across the great room, which is the only distance it is seen from. */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2
        const long = i % 3 === 0
        const at = radius * 0.75
        return (
          <mesh
            key={i}
            position={[Math.sin(angle) * at, Math.cos(angle) * at, 0.028]}
            rotation-z={-angle}
          >
            <boxGeometry args={[long ? 0.018 : 0.009, long ? 0.05 : 0.03, 0.004]} />
            <meshStandardMaterial color="#2c2620" roughness={0.8} />
          </mesh>
        )
      })}
      <group ref={hour}>{hand(radius * 0.52, 0.016, '#2c2620', 0.031)}</group>
      <group ref={minute}>{hand(radius * 0.76, 0.011, '#2c2620', 0.033)}</group>
      <group ref={second}>{hand(radius * 0.8, 0.005, '#8c3a2c', 0.035)}</group>
      <mesh position={[0, 0, 0.037]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.012, 0.012, 0.008, 10]} />
        <meshStandardMaterial color={BRASS} roughness={0.4} metalness={0.7} />
      </mesh>
    </group>
  )
}

/** A whiteboard marker: a barrel, a cap and a nib, in whatever ink it holds. */
function Marker({ width, colour }: { width: number; colour: string }) {
  return (
    <group rotation-z={Math.PI / 2}>
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.011, 0.011, width * 0.72, 10]} />
        <meshStandardMaterial color={colour} roughness={0.5} />
      </mesh>
      <mesh position={[0, width * 0.44, 0]} castShadow>
        <cylinderGeometry args={[0.013, 0.013, width * 0.28, 10]} />
        <meshStandardMaterial color="#2a2724" roughness={0.6} />
      </mesh>
      <mesh position={[0, -width * 0.4, 0]}>
        <coneGeometry args={[0.009, 0.03, 8]} />
        <meshStandardMaterial color="#efeae0" roughness={0.9} />
      </mesh>
    </group>
  )
}

function CoffeeMaker({
  brewing,
  potFull,
  cupHome,
}: {
  brewing: boolean
  potFull: boolean
  cupHome: boolean
}) {
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
      {/* The carafe. Fills while it brews and stands full until the cup takes it. */}
      <mesh position={[0, 0.16, 0.04]} castShadow>
        <cylinderGeometry args={[0.065, 0.058, 0.14, 12]} />
        <meshStandardMaterial color="#d8d4cc" roughness={0.25} transparent opacity={0.45} />
      </mesh>
      <mesh position={[0, 0.13, 0.04]}>
        <cylinderGeometry args={[0.058, 0.052, brewing ? 0.09 : potFull ? 0.1 : 0.02, 12]} />
        <meshStandardMaterial color="#40251a" roughness={0.4} />
      </mesh>
      <mesh position={[0.07, 0.11, -0.02]}>
        <boxGeometry args={[0.02, 0.012, 0.012]} />
        <meshStandardMaterial
          color={brewing ? '#ff5a3a' : potFull ? '#ffb24a' : '#503c34'}
          emissive={brewing ? '#ff5a3a' : potFull ? '#ffb24a' : '#000000'}
          emissiveIntensity={brewing ? 2 : potFull ? 1.2 : 0}
        />
      </mesh>
      {/* The cup, waiting beside the machine whenever it is not out in the
          room or in your hand. There is exactly one — see `PlacedProp`. */}
      {cupHome && (
        <group position={[0.17, 0, 0.05]} rotation-y={0.6}>
          <PropModel kind="cup" full={false} />
        </group>
      )}
      {/* Steam while it brews and while the pot stands hot: the chimney's puff
          math at a tenth the scale. Mounted only then, so an idle machine
          costs nothing at all. */}
      {(brewing || potFull) && <Steam />}
    </group>
  )
}

/** Three tiny puffs rising off the carafe. One draw call, only while hot. */
function Steam() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      size: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const node = mesh.current
    if (!node) return
    const t = clock.elapsedTime
    for (let i = 0; i < 3; i++) {
      const age = (t * 0.35 + i / 3) % 1
      scratch.position.set(
        Math.sin(t * 1.3 + i * 2.1) * 0.01 * age,
        0.24 + age * 0.14,
        0.04 + Math.cos(t * 1.1 + i * 1.7) * 0.008 * age,
      )
      // Grow on the way up, dwindle over the last third — the chimney's rule.
      const dying = age > 0.7 ? (1 - age) / 0.3 : 1
      scratch.matrix.compose(
        scratch.position,
        scratch.quaternion,
        scratch.size.setScalar((0.008 + age * 0.022) * dying),
      )
      node.setMatrixAt(i, scratch.matrix)
    }
    node.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 3]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 5]} />
      <meshBasicMaterial color="#eceae6" transparent opacity={0.3} depthWrite={false} />
    </instancedMesh>
  )
}

/** A rotary telephone: bakelite body, a dial on the slope, the handset across the top. */
function Phone({ width, depth, height }: { width: number; depth: number; height: number }) {
  const BAKELITE = '#33302c'
  return (
    <group>
      <mesh position={[0, height * 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[width * 0.82, height * 0.52, depth * 0.85]} />
        <meshStandardMaterial color={BAKELITE} roughness={0.35} />
      </mesh>
      {/* The dial, tipped up the slope of the face. */}
      <mesh position={[0, height * 0.42, depth * 0.24]} rotation-x={-0.6}>
        <cylinderGeometry args={[width * 0.2, width * 0.2, 0.01, 16]} />
        <meshStandardMaterial color="#e8e3d8" roughness={0.5} />
      </mesh>
      <mesh position={[0, height * 0.44, depth * 0.26]} rotation-x={-0.6}>
        <cylinderGeometry args={[width * 0.07, width * 0.07, 0.012, 10]} />
        <meshStandardMaterial color={BAKELITE} roughness={0.4} />
      </mesh>
      {/* The handset: a bar with an ear at each end, in its cradle. */}
      <mesh position={[0, height * 0.68, -depth * 0.08]} castShadow>
        <boxGeometry args={[width * 0.72, height * 0.14, depth * 0.3]} />
        <meshStandardMaterial color={BAKELITE} roughness={0.35} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * width * 0.36, height * 0.62, -depth * 0.08]}
          castShadow
        >
          <cylinderGeometry args={[width * 0.13, width * 0.15, height * 0.3, 10]} />
          <meshStandardMaterial color={BAKELITE} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

/** A larder fridge: enamel box, freezer seam, a long handle, a dark plinth. */
function Fridge({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <group>
      <mesh position={[0, height / 2 + 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.06, depth]} />
        <meshStandardMaterial color="#ddd7ca" roughness={0.5} />
      </mesh>
      {/* The door seam under the freezer flap. */}
      <mesh position={[0, height * 0.74, depth / 2 + 0.002]}>
        <boxGeometry args={[width * 0.94, 0.01, 0.006]} />
        <meshStandardMaterial color="#9a9486" roughness={0.8} />
      </mesh>
      <mesh position={[width * 0.32, height * 0.44, depth / 2 + 0.028]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, height * 0.36, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[width * 0.9, 0.06, depth * 0.9]} />
        <meshStandardMaterial color="#3a352e" roughness={1} />
      </mesh>
    </group>
  )
}

/** A pedal bin without the pedal: brushed steel, a lid, a knob to imagine lifting. */
function Bin({ width, height }: { width: number; height: number }) {
  const r = width / 2
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.92, r * 0.8, height, 14]} />
        <meshStandardMaterial color={STEEL} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, height + 0.012, 0]} castShadow>
        <cylinderGeometry args={[r * 0.96, r * 0.9, 0.024, 14]} />
        <meshStandardMaterial color="#6e7168" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, height + 0.035, 0]}>
        <cylinderGeometry args={[0.016, 0.024, 0.022, 8]} />
        <meshStandardMaterial color="#3a3d38" roughness={0.5} />
      </mesh>
    </group>
  )
}

// The headlamp's home spot renders the same lying lamp a placed prop does —
// see `HeadlampAtRest` in Props.tsx. There is one lamp: on your head, standing
// somewhere as a prop, or here, and the home only draws it in the third case.

/**
 * A hinged door leaf, standing in a doorway. `E` swings it — the angle is
 * eased here, per frame, because a door that snaps between its two states
 * reads as a texture flipping — and whether it is open is remembered in
 * `ambience.json` with the lamps, because which doors stand open is a fact
 * about the room, not about this machine. A closed one blocks the doorway:
 * the walk controller adds that collider itself, off the same bit.
 */
function DoorLeaf({ width, height, open }: { width: number; height: number; open: boolean }) {
  const swing = useRef<THREE.Group>(null)
  // Primed to its resting state so a saved-open door mounts open rather than
  // swinging theatrically on every launch.
  const angle = useRef(open ? DOOR_OPEN : 0)

  useFrame((_, delta) => {
    const want = open ? DOOR_OPEN : 0
    angle.current += (want - angle.current) * Math.min(1, delta * 6)
    if (Math.abs(want - angle.current) < 0.002) angle.current = want
    if (swing.current) swing.current.rotation.y = angle.current
  })

  return (
    <group position={[-width / 2, 0, 0]}>
      {/* The post the hinges hang on. */}
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[0.05, height, 0.07]} />
        <meshStandardMaterial color={OAK} roughness={0.7} />
      </mesh>
      <group ref={swing}>
        <mesh position={[width / 2, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, 0.045]} />
          <meshStandardMaterial color={OAK} roughness={0.65} />
        </mesh>
        {/* Two sunken panels, one each side, so it reads as joinery. */}
        {[-1, 1].map((face) =>
          [0.3, 0.71].map((at) => (
            <mesh key={`${face}:${at}`} position={[width / 2, height * at, face * 0.024]}>
              <boxGeometry args={[width * 0.68, height * 0.28, 0.008]} />
              <meshStandardMaterial color="#6d4b2e" roughness={0.8} />
            </mesh>
          )),
        )}
        {[-1, 1].map((face) => (
          <mesh key={`knob${face}`} position={[width * 0.86, height * 0.48, face * 0.045]}>
            <sphereGeometry args={[0.028, 8, 8]} />
            <meshStandardMaterial color={BRASS} roughness={0.35} metalness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** Radians a door stands open at: flat-ish back, clear of the walkway. */
const DOOR_OPEN = -1.92

/** An A-frame tent: two canvas slopes on a ridge pole, open at both ends. */
function Tent({ width, depth, height }: { width: number; depth: number; height: number }) {
  const CANVAS = '#66704f'
  const slope = Math.hypot(width / 2, height)
  const pitch = Math.atan2(width / 2, height)
  return (
    <group>
      <mesh position={[0, 0.015, 0]} receiveShadow>
        <boxGeometry args={[width - 0.1, 0.03, depth - 0.1]} />
        <meshStandardMaterial color="#4c523f" roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[(side * width) / 4, height / 2, 0]}
          rotation-z={-side * pitch}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[slope, 0.025, depth]} />
          <meshStandardMaterial color={CANVAS} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Ridge pole and the two uprights it rests on. */}
      <mesh position={[0, height, 0]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.02, 0.02, depth + 0.16, 6]} />
        <meshStandardMaterial color={OAK} roughness={0.8} />
      </mesh>
      {[-1, 1].map((end) => (
        <mesh key={`pole${end}`} position={[0, height / 2, (end * depth) / 2]} castShadow>
          <cylinderGeometry args={[0.02, 0.024, height, 6]} />
          <meshStandardMaterial color={OAK} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

/** A ring of stones, a few logs leaned together, and the fire when it is lit. */
function Campfire({ lit }: { lit: boolean }) {
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2 + 0.3
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.36, 0.05, Math.sin(angle) * 0.36]}
            rotation-y={angle + ((i * 31) % 7) / 7}
            rotation-z={((i * 17) % 5) / 25}
            castShadow
          >
            <boxGeometry args={[0.15, 0.11, 0.12]} />
            <meshStandardMaterial color={MATERIALS.stone} roughness={1} />
          </mesh>
        )
      })}
      {[0, 1, 2].map((i) => {
        const angle = (i / 3) * Math.PI * 2 + 0.8
        return (
          <mesh
            key={`log${i}`}
            position={[Math.cos(angle) * 0.1, 0.12, Math.sin(angle) * 0.1]}
            rotation-z={Math.PI / 2 - 0.5}
            rotation-y={angle}
            castShadow
          >
            <cylinderGeometry args={[0.04, 0.045, 0.5, 7]} />
            <meshStandardMaterial color={TRUNK_BROWN} roughness={1} />
          </mesh>
        )
      })}
      {/* The embers, and a low flame when it is going. Nothing animates — the
          same argument the hearth makes about flicker. */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.17, 0.2, 0.06, 10]} />
        <meshStandardMaterial
          color={lit ? '#c9541e' : '#2b241d'}
          emissive={lit ? '#ff7a2a' : '#000000'}
          emissiveIntensity={lit ? 1.6 : 0}
          roughness={1}
        />
      </mesh>
      {lit && (
        <mesh position={[0, 0.22, 0]}>
          <coneGeometry args={[0.11, 0.26, 7]} />
          <meshStandardMaterial
            color="#ffb03a"
            emissive="#ff9030"
            emissiveIntensity={1.8}
            transparent
            opacity={0.85}
            roughness={1}
          />
        </mesh>
      )}
    </group>
  )
}

const TRUNK_BROWN = '#4a3826'

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

/**
 * The deck. A plinth, a platter, an arm — and, when a record is on, its disc
 * on the platter and its sleeve leaning against the plinth, so the record you
 * carried over is visibly the one playing.
 */
function RecordPlayer({ spinning, playing }: { spinning: boolean; playing: string | null }) {
  const platter = useRef<THREE.Group>(null)
  const angle = useRef(0)

  const track = useMediaStore((s) => (playing ? s.trackAt(playing) : undefined))
  const art = track ? sleeveArtFor(track) : null
  const sleeve = useMemo(() => (track ? makeSleeveTexture(sleeveArtFor(track), 256) : null), [track])
  useEffect(() => () => sleeve?.dispose(), [sleeve])
  const loaded = playing !== null

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
      {/* The power lamp on the plinth's edge: amber with a record on, bright
          while it turns — so a paused deck across the room still says it is
          holding your place. */}
      <mesh position={[0.185, 0.055, 0.181]}>
        <boxGeometry args={[0.016, 0.007, 0.005]} />
        <meshStandardMaterial
          color="#2a1712"
          emissive="#ff7a3d"
          emissiveIntensity={loaded ? (spinning ? 1.7 : 0.55) : 0}
          roughness={0.4}
        />
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
            {/* The label wears the sleeve's colour, so glancing at the platter
                tells you which record is on. */}
            <mesh position={[0, 0.012, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.002, 20]} />
              <meshStandardMaterial color={art?.colour ?? '#c2453a'} roughness={0.85} />
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
      {/* The sleeve of whatever is on, stood up behind the deck. Behind rather
          than beside: a 12" sleeve is 31.5 cm and the plinth is 44 wide on a
          90 cm crate, so there is no room at the side. Keyed so the artwork
          mounts a fresh material — see `Picture`. */}
      {sleeve && (
        <group position={[0.05, 0.156, -0.215]} rotation-x={-0.16}>
          <mesh castShadow>
            <boxGeometry args={[0.315, 0.315, 0.004]} />
            <meshStandardMaterial color="#221c17" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0.0028]}>
            <planeGeometry args={[0.31, 0.31]} />
            <meshStandardMaterial key={playing ?? 'sleeve'} map={sleeve} roughness={0.72} />
          </mesh>
        </group>
      )}
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
 * Flattened moving boxes leaning against the wall, waiting to be made up.
 *
 * The spares live in the kitchen: E takes one into your arms and X stands it
 * up wherever you are — see `spawnBox`. A lean of a few degrees each, slightly
 * disagreeing, is what says "stack of cardboard" rather than "panel".
 */
function BoxStack({ width, depth, height }: { width: number; depth: number; height: number }) {
  const sheet = 0.016
  const panels = 4
  return (
    <group>
      {Array.from({ length: panels }, (_, i) => (
        <mesh
          key={i}
          position={[
            ((i % 2) - 0.5) * 0.02,
            height / 2 - i * 0.008,
            -depth / 2 + sheet / 2 + i * (sheet + 0.006),
          ]}
          rotation-x={0.16 + i * 0.045}
          rotation-y={((i * 41) % 7) / 7 * 0.08 - 0.04}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[width * (1 - i * 0.04), height, sheet]} />
          <meshStandardMaterial color={i % 2 ? CARD : CARD_DARK} roughness={1} />
        </mesh>
      ))}
      {/* one lying flat at the base, which is where the next one comes off */}
      <mesh position={[0.01, sheet / 2, depth * 0.18]} rotation-y={0.09} castShadow receiveShadow>
        <boxGeometry args={[width * 0.92, sheet, depth * 0.85]} />
        <meshStandardMaterial color={CARD} roughness={1} />
      </mesh>
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

/**
 * A desk: a top, a modesty panel, and a bank of drawers under one end.
 *
 * Deeper and a shade higher than the dining table it would otherwise be, because
 * a desk is somewhere you spread a book open and leave it — which is also why it
 * is a `surface` and the dining chairs are not.
 */
function Desk({ width, depth, height }: { width: number; depth: number; height: number }) {
  const top = 0.04
  const leg = 0.07
  const drawers = width * 0.34

  return (
    <group>
      <mesh position={[0, height - top / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, top, depth]} />
        <meshStandardMaterial color={OAK} roughness={0.62} />
      </mesh>

      {/* Two legs at the open end; the drawer bank carries the other. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`leg${side}`}
          position={[-width / 2 + leg, (height - top) / 2, (side * (depth - leg * 2)) / 2]}
          castShadow
        >
          <boxGeometry args={[leg, height - top, leg]} />
          <meshStandardMaterial color={OAK} roughness={0.8} />
        </mesh>
      ))}

      <mesh
        position={[width / 2 - drawers / 2, (height - top) / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[drawers, height - top, depth * 0.92]} />
        <meshStandardMaterial color={OAK} roughness={0.78} />
      </mesh>
      {/* Three drawer fronts, which is what makes the bank read as drawers
          rather than as a plinth. */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={`drawer${i}`}
          position={[
            width / 2 - drawers / 2,
            (height - top) * (0.22 + i * 0.28),
            (depth * 0.92) / 2 + 0.008,
          ]}
        >
          <boxGeometry args={[drawers * 0.86, (height - top) * 0.22, 0.016]} />
          <meshStandardMaterial color={PINE} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * A whiteboard. Aluminium frame, a pen tray, and a face you can pin to and draw
 * on.
 *
 * Hung like a picture — `size` is width by height and `y` is the centre of the
 * board — because that is how anybody hanging one thinks about it. What makes it
 * more than a white picture is that it is published to `sceneRefs.boards`, so the
 * crosshair offers it both as somewhere a torn-out page can go and as somewhere
 * the marker will write.
 *
 * The face carries a canvas painted from the saved strokes. Repainting the whole
 * list happens on an *edit* — a stroke finished, a board wiped, a library loaded
 * — while the line under your hand is extended a segment at a time; see `board.ts`
 * for why the live stroke is not in a store.
 */
function Whiteboard({ id, width, height }: { id: string; width: number; height: number }) {
  const frame = 0.03
  const strokes = useLibraryStore((s) => s.drawings[id])
  const painter = useMemo(() => makeBoardCanvas(width, height), [width, height])
  useEffect(() => () => painter.dispose(), [painter])

  useLayoutEffect(() => painter.repaint(strokes ?? []), [painter, strokes])

  // The live stroke gains points outside React, so the only way to notice is to
  // look. One integer compared per frame per board, against a hand that is not
  // usually holding a marker at all.
  const seen = useRef(drawing.revision)
  useFrame(() => {
    if (drawing.revision === seen.current) return
    seen.current = drawing.revision
    if (drawing.boardId === id) painter.extend()
  })

  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width + frame * 2, height + frame * 2, 0.05]} />
        <meshStandardMaterial color={ALUMINIUM} roughness={0.42} metalness={0.55} />
      </mesh>
      {/* The face, a hair proud of the frame so the two never z-fight. */}
      <mesh position={[0, 0, 0.027]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={BOARD_WHITE} map={painter.texture} roughness={0.32} />
      </mesh>
      {/* Pen tray along the bottom edge, tipped up to hold what is in it. */}
      <mesh position={[0, -height / 2 - frame, 0.05]} rotation-x={-0.35} castShadow>
        <boxGeometry args={[width * 0.55, 0.02, 0.07]} />
        <meshStandardMaterial color={ALUMINIUM} roughness={0.45} metalness={0.5} />
      </mesh>
      {MARKER_INKS.map((ink, i) => (
        <mesh
          key={ink}
          position={[(i - 1) * 0.09, -height / 2 - frame + 0.02, 0.062]}
          rotation-z={Math.PI / 2}
        >
          <cylinderGeometry args={[0.008, 0.008, 0.1, 8]} />
          <meshStandardMaterial color={ink} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** An open crate of tapes: four low sides and a base, and nothing else. */
function TapeCrate({ width, depth, height }: { width: number; depth: number; height: number }) {
  const wall = 0.016
  return (
    <group>
      <mesh position={[0, wall / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={CARD_DARK} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`x${side}`} position={[(side * (width - wall)) / 2, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={OAK} roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`z${side}`} position={[0, height / 2, (side * (depth - wall)) / 2]} castShadow receiveShadow>
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color={OAK} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The television: a portable colour set, which is to say a heavy one.
 *
 * The screen is the only interesting part. When a tape is running it carries a
 * `VideoTexture` over the one `<video>` element `state/video.ts` owns, so the
 * picture is the tape rather than a decoration; the rest of the time it is the
 * dead green a tube actually is, with a soft scanline wash over it so a set that
 * is off still reads as glass rather than as a hole in the casing.
 *
 * The texture is created here rather than in the store because the store has no
 * business knowing about three; the element is a singleton, so this is the one
 * place that needs to dispose of anything.
 */
function Crt({
  width,
  depth,
  height,
  playing,
}: {
  width: number
  depth: number
  height: number
  playing: string | null
}) {
  const screenW = width * 0.78
  const screenH = height * 0.72

  const picture = useMemo(() => {
    if (!playing) return null
    const texture = new THREE.VideoTexture(videoElement())
    texture.colorSpace = THREE.SRGBColorSpace
    // A tube's picture does not tile, and a tape's aspect is whatever it is:
    // clamped and stretched to the glass, which is what a 4:3 set did to
    // everything anyway.
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }, [playing])
  useEffect(() => () => picture?.dispose(), [picture])

  return (
    <group>
      {/* The casing, with the tube's depth in it. */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={CASING} roughness={0.72} />
      </mesh>
      {/* A recessed bezel, so the glass sits inside the box rather than on it. */}
      <mesh position={[0, height * 0.54, depth / 2 + 0.004]}>
        <boxGeometry args={[screenW + 0.035, screenH + 0.035, 0.02]} />
        <meshStandardMaterial color={CASING_DARK} roughness={0.8} />
      </mesh>
      <mesh position={[0, height * 0.54, depth / 2 + 0.016]}>
        <planeGeometry args={[screenW, screenH]} />
        {/* Keyed so a tape starting mounts a *new* material: swapping a map into
            a live one reuses its map-less shader program and draws black, which
            is the same trap the picture frames fell into. */}
        {picture ? (
          <meshBasicMaterial key="tape" map={picture} toneMapped={false} />
        ) : (
          <meshStandardMaterial key="off" color={TUBE_OFF} roughness={0.16} metalness={0.3} />
        )}
      </mesh>

      {/* The control panel down the side of the glass: a dial, a smaller dial,
          and the slot the tape goes into. */}
      {[0.66, 0.5].map((at, i) => (
        <mesh
          key={at}
          position={[width * 0.42, height * at, depth / 2 + 0.012]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.022 - i * 0.005, 0.022 - i * 0.005, 0.022, 12]} />
          <meshStandardMaterial color={CASING_DARK} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[width * 0.42, height * 0.2, depth / 2 + 0.006]}>
        <boxGeometry args={[width * 0.11, 0.026, 0.012]} />
        <meshStandardMaterial color="#3a3630" roughness={0.9} />
      </mesh>
      {/* The speaker grille, under the glass. */}
      <mesh position={[-width * 0.1, height * 0.12, depth / 2 + 0.006]}>
        <boxGeometry args={[width * 0.5, 0.05, 0.01]} />
        <meshStandardMaterial color={CASING_DARK} roughness={0.95} />
      </mesh>

      {/* Feet, and a telescopic aerial pulled up at the back. */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`foot${sx}${sz}`}
            position={[(sx * width) / 2.6, 0.008, (sz * depth) / 2.8]}
            castShadow
          >
            <boxGeometry args={[0.05, 0.016, 0.05]} />
            <meshStandardMaterial color="#332f2b" roughness={0.9} />
          </mesh>
        )),
      )}
      <group position={[-width * 0.36, height, -depth * 0.3]} rotation-z={0.42}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.005, 0.007, 0.44, 6]} />
          <meshStandardMaterial color={STEEL} roughness={0.35} metalness={0.7} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * The arcade cabinet: an upright box of painted chipboard with a tube in it.
 *
 * The screen is a `CanvasTexture` exactly one texel per CHIP-8 pixel — see
 * `arcadeScreen.ts` — painted here per frame while a cartridge is in, because
 * the machine itself is stepped elsewhere (`Arcade.tsx`) and this component
 * only shows it. Painting an 8 KB texture per frame is nothing; the keyed
 * material is the same trap-avoidance the television's glass does.
 *
 * No point light, deliberately: the marquee and the glass glow with emissive
 * materials instead, because a light is a standing charge on every lit
 * fragment in the room — the rule `CrtGlow` follows.
 */
function ArcadeCabinet({
  width,
  depth,
  height,
  running,
}: {
  width: number
  depth: number
  height: number
  running: boolean
}) {
  const screen = useMemo(makeArcadeScreen, [])
  useEffect(() => () => screen.dispose(), [screen])

  // Repainted only while something is running; a dead machine was painted dark
  // once by `makeArcadeScreen` and stays that way without another upload.
  useFrame(() => {
    if (running) screen.paint(arcadeMachine())
  })

  // A friendly machine, not a monolith: warm terracotta over cream, with the
  // painted stripes a cabinet of that era wore round its middle.
  const body = '#a35d40'
  const trim = '#4a3226'
  const cream = '#d8cdb4'
  const deckY = height * 0.58
  // The head unit sits back a little on the base; everything mounted on its
  // face — marquee, bezel, glass — must stand *proud* of this or it is
  // swallowed by the box, which is how the screen's top half went missing.
  const headFront = depth * 0.26

  return (
    <group>
      {/* The lower cabinet, full depth, and the head unit set back on top. */}
      <mesh position={[0, deckY / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, deckY, depth]} />
        <meshStandardMaterial color={body} roughness={0.8} />
      </mesh>
      <mesh position={[0, (deckY + height) / 2, -depth * 0.12]} castShadow receiveShadow>
        <boxGeometry args={[width, height - deckY, depth * 0.76]} />
        <meshStandardMaterial color={body} roughness={0.8} />
      </mesh>

      {/* The painted stripes, wrapped round the lower cabinet. */}
      {[
        { y: deckY * 0.36, colour: '#d8a03c', band: 0.07 },
        { y: deckY * 0.25, colour: '#5f8a80', band: 0.028 },
      ].map(({ y, colour, band }) => (
        <mesh key={colour} position={[0, y, 0]}>
          <boxGeometry args={[width + 0.006, band, depth + 0.006]} />
          <meshStandardMaterial color={colour} roughness={0.85} />
        </mesh>
      ))}

      {/* The marquee across the top, on the head unit's face, lit while the
          machine is on and a cheerful cream when it is not. */}
      <mesh position={[0, height - 0.085, headFront + 0.018]}>
        <boxGeometry args={[width * 0.94, 0.15, 0.03]} />
        {running ? (
          <meshStandardMaterial
            key="lit"
            color="#f4d9a0"
            emissive="#e8b45c"
            emissiveIntensity={0.9}
            roughness={0.4}
          />
        ) : (
          <meshStandardMaterial key="dark" color={cream} roughness={0.6} />
        )}
      </mesh>

      {/* The bezel and the glass, tipped back only slightly — tip it further
          and the top of the tube leans back inside the cabinet. */}
      <group position={[0, height * 0.755, headFront + 0.024]} rotation-x={-0.1}>
        <mesh>
          <boxGeometry args={[width * 0.88, height * 0.28, 0.03]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0, 0.017]}>
          <planeGeometry args={[width * 0.72, width * 0.36]} />
          {/* Keyed, so power-on mounts a new material: swapping a map into a
              live one reuses its map-less shader program and draws black. */}
          {running ? (
            <meshBasicMaterial key="on" map={screen.texture} toneMapped={false} />
          ) : (
            <meshStandardMaterial key="off" color={TUBE_OFF} roughness={0.16} metalness={0.3} />
          )}
        </mesh>
      </group>

      {/* The control deck, with a stick and two buttons. */}
      <mesh position={[0, deckY + 0.02, depth * 0.32]} rotation-x={0.12} castShadow>
        <boxGeometry args={[width, 0.06, depth * 0.36]} />
        <meshStandardMaterial color={cream} roughness={0.7} />
      </mesh>
      <mesh position={[-width * 0.2, deckY + 0.1, depth * 0.32]}>
        <cylinderGeometry args={[0.008, 0.008, 0.09, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh position={[-width * 0.2, deckY + 0.15, depth * 0.32]}>
        <sphereGeometry args={[0.021, 10, 8]} />
        <meshStandardMaterial color="#b8433a" roughness={0.35} />
      </mesh>
      {[
        { at: 0.1, colour: '#b8433a' },
        { at: 0.24, colour: '#3f6b8a' },
      ].map(({ at, colour }) => (
        <mesh key={colour} position={[width * at, deckY + 0.055, depth * 0.34]}>
          <cylinderGeometry args={[0.018, 0.018, 0.02, 12]} />
          <meshStandardMaterial color={colour} roughness={0.5} />
        </mesh>
      ))}

      {/* The cartridge slot, under the deck, where the game goes in. */}
      <mesh position={[0, deckY - 0.09, depth / 2 + 0.002]}>
        <boxGeometry args={[0.15, 0.028, 0.012]} />
        <meshStandardMaterial color={trim} roughness={0.9} />
      </mesh>
    </group>
  )
}

/** The cartridge everywhere it appears: in the crate, and in your hand. */
export const ROM_CARTRIDGE = { width: 0.09, height: 0.12, depth: 0.017 }

/** Where up to six shells lean in the crate: offset across it, and a tilt. */
const SHELL_SLOTS: [number, number][] = [
  [-0.34, 0.12],
  [-0.21, 0.03],
  [-0.08, -0.06],
  [0.05, 0.1],
  [0.18, 0.0],
  [0.31, -0.08],
]

/**
 * The crate of cartridges beside the cabinet. One shell per ROM the folder
 * actually holds — minus the one in your hand or in the machine — but they are
 * anonymous: a crate of a handful of games does not earn a third atlas, so the
 * HUD names what you took. Same argument the tape crate's own small grid
 * makes, taken one step further down.
 */
function RomBox({ width, depth, height }: { width: number; depth: number; height: number }) {
  const inCrate = useArcadeStore((s) => s.roms.length - (s.inserted !== null ? 1 : 0))
  const heldRom = useAppStore((s) => s.heldRom)
  const shells = Math.min(SHELL_SLOTS.length, Math.max(0, inCrate - (heldRom !== null ? 1 : 0)))

  const wall = 0.016
  return (
    <group>
      {/* An open crate: bottom and four sides. */}
      <mesh position={[0, wall / 2, 0]} receiveShadow>
        <boxGeometry args={[width, wall, depth]} />
        <meshStandardMaterial color={CARD_DARK} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`w${side}`} position={[(side * (width - wall)) / 2, height / 2, 0]} castShadow>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`d${side}`} position={[0, height / 2, (side * (depth - wall)) / 2]} castShadow>
          <boxGeometry args={[width - wall * 2, height, wall]} />
          <meshStandardMaterial color={CARD} roughness={1} />
        </mesh>
      ))}
      {SHELL_SLOTS.slice(0, shells).map(([at, lean], i) => (
        <mesh
          key={at}
          position={[width * at, height * 0.52, 0]}
          rotation-z={lean}
          castShadow
        >
          <boxGeometry args={[ROM_CARTRIDGE.depth, ROM_CARTRIDGE.height, ROM_CARTRIDGE.width]} />
          <meshStandardMaterial color={i % 2 === 1 ? '#4a4038' : '#33383c'} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The catalogue terminal: a monitor on a box, with a keyboard in front of it.
 *
 * What it does lives in the HUD: a search you type has to be readable, and a
 * canvas texture on a 40 cm screen across a desk is not. This is the thing you
 * walk up to.
 */
function Computer({ width, depth, height, awake }: { width: number; depth: number; height: number; awake: boolean }) {
  const screenW = width * 0.62
  const screenH = height * 0.5

  return (
    <group>
      {/* The case, tipped back a little on its own feet the way they were. */}
      <mesh position={[0, height * 0.42, -depth * 0.14]} rotation-x={-0.07} castShadow receiveShadow>
        <boxGeometry args={[width * 0.78, height * 0.7, depth * 0.62]} />
        <meshStandardMaterial color={PUTTY} roughness={0.78} />
      </mesh>
      <mesh position={[0, height * 0.06, -depth * 0.14]} castShadow>
        <boxGeometry args={[width * 0.64, height * 0.12, depth * 0.5]} />
        <meshStandardMaterial color={PUTTY_DARK} roughness={0.85} />
      </mesh>
      {/* The glass, and the phosphor behind it. Not a texture: what is on this
          screen is a DOM overlay, and a fake page of type under a real one is
          two different searches in one room. */}
      <mesh position={[0, height * 0.46, -depth * 0.14 + depth * 0.31 * Math.cos(0.07)]} rotation-x={-0.07}>
        <planeGeometry args={[screenW, screenH]} />
        <meshStandardMaterial
          color={awake ? '#1b3324' : '#16211b'}
          emissive={awake ? '#5ce08a' : '#20402c'}
          emissiveIntensity={awake ? 0.9 : 0.22}
          roughness={0.2}
        />
      </mesh>
      {/* The keyboard, at the front where a hand would be. */}
      <mesh position={[0, 0.016, depth * 0.3]} rotation-x={-0.06} castShadow receiveShadow>
        <boxGeometry args={[width * 0.86, 0.03, depth * 0.3]} />
        <meshStandardMaterial color={PUTTY_DARK} roughness={0.85} />
      </mesh>
    </group>
  )
}

/**
 * A pad of notes, on a desk.
 *
 * Sheets rather than a block: the top one is a hair proud of the rest and every
 * sheet under it is offset by a fraction of a millimetre, because a pad you can
 * see the leaves of is the difference between "a stack of paper" and "a yellow
 * cube". Taking one is `E`, which opens the field you write on it.
 */
function PostIts({ width, depth }: { width: number; depth: number }) {
  const leaves = 9
  const leaf = 0.0035
  return (
    <group>
      {Array.from({ length: leaves }, (_, i) => (
        <mesh
          key={i}
          position={[((i % 3) - 1) * 0.0009, leaf * (i + 0.5), ((i % 2) - 0.5) * 0.0012]}
          rotation-y={((i * 37) % 11) / 11 - 0.5 > 0 ? 0.012 : -0.014}
          castShadow={i === leaves - 1}
          receiveShadow
        >
          <boxGeometry args={[width, leaf, depth]} />
          <meshStandardMaterial color={i === leaves - 1 ? '#f4e276' : '#e8d76a'} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Two treads hanging off the edge of a deck.
 *
 * Not solid, and not a `stairs`: the drop from the decking to the ground is 24 cm,
 * which is inside the step the walk controller takes unaided, so there is no ramp
 * to build. This exists so the place you walk down looks like a place to walk
 * down. It hangs *below* its own origin, which is the top of the deck.
 */
function Step({ width, depth, height }: { width: number; depth: number; height: number }) {
  const tread = height / 2
  const run = depth / 2
  return (
    <group>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          position={[0, -tread * (i + 0.5), -run / 2 + run * i]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[width, tread, run]} />
          <meshStandardMaterial color={MATERIALS.timber} roughness={0.92} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Whether anything in the library is lit, for the switch plates to show.
 *
 * Only asked when there is a switch on screen: it walks every lamp in the
 * building, and no other piece of furniture cares.
 */
function useAnyLightOn(wanted: boolean): boolean {
  const lamps = useWorldStore((s) => s.world?.lights)
  const on = useAmbienceStore((s) => s.on)
  if (!wanted || !lamps) return false
  return lamps.some((lamp) => on[lamp.id] ?? lamp.defaultOn)
}

function Piece({ item, source }: { item: DerivedFurniture; source: string | null }) {
  const lit = useAmbienceStore((s) => (LAMPS.has(item.kind) ? s.isOn(item.id, item.on ?? true) : false))
  // A record is on one deck at a time, so only that deck shows it. Reading
  // `playing` alone put the same disc on the platter of every deck in the house.
  const playing = useMediaStore((s) => (s.deck === item.id ? s.playing : null))
  const paused = useMediaStore((s) => s.paused)
  // A tape is in one set at a time, the record player's rule: only that
  // screen shows the picture.
  const tape = useVideoStore((s) => (item.kind === 'crt' && s.crt === item.id ? s.playing : null))
  const romIn = useArcadeStore((s) => (item.kind === 'arcade' ? s.inserted : null))
  const brewing = useAppStore((s) => s.brewing === item.id)
  const potFull = useAppStore((s) =>
    item.kind === 'coffeemaker' ? (s.readyPots[item.id] ?? false) : false,
  )
  // Whether the one cup is at home by the machine: not standing somewhere in
  // the room, and not in your hand.
  const cupOut = useLibraryStore((s) => (item.kind === 'coffeemaker' ? 'cup' in s.props : false))
  const cupInHand = useAppStore((s) =>
    item.kind === 'coffeemaker' ? s.heldProp?.kind === 'cup' : false,
  )
  // The lamp is away from home while it is on anybody's head *or* standing
  // somewhere as a prop — either way this spot has nothing to draw.
  const lampAway = useAppStore((s) => (item.kind === 'headlamp' ? s.wornLamp !== null : false))
  const lampOut = useLibraryStore((s) =>
    item.kind === 'headlamp' ? 'headlamp' in s.props : false,
  )
  const heldMarker = useAppStore((s) => (item.kind === 'marker' ? s.heldMarker === item.id : false))
  // A door's open bit rides the same keyed store the lamps use — which doors
  // stand open is a fact about the room, saved beside the weather.
  const doorOpen = useAmbienceStore((s) =>
    item.kind === 'door' ? s.isOn(item.id, item.on ?? true) : false,
  )
  const ink = useAppStore((s) => (item.kind === 'marker' ? s.markerInk : 0))
  const allOn = useAnyLightOn(item.kind === 'lightswitch')
  // The terminal's screen lights when its search is open, so the thing you are
  // typing into is visibly the thing in front of you.
  const searching = useAppStore((s) => (item.kind === 'computer' ? s.searching : false))

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
      case 'desk':
        return <Desk width={item.width} depth={item.depth} height={item.height} />
      case 'bed':
        return <Bed width={item.width} depth={item.depth} />
      case 'rug':
        return <Rug width={item.width} depth={item.depth} />
      case 'floorlamp':
        return <FloorLamp lit={lit} />
      case 'pendant':
        return <Pendant lit={lit} />
      case 'fairylights':
        return <FairyLights width={item.width} sag={item.size?.[1] ?? 0.18} lit={lit} />
      case 'lightswitch':
        return <LightSwitch width={item.width} height={item.height} allOn={allOn} />
      case 'fireplace':
        return <Fireplace width={item.width} height={item.height} lit={lit} />
      case 'plant':
        return <Plant height={item.height} />
      case 'kitchencounter':
        return <KitchenCounter width={item.width} depth={item.depth} height={item.height} />
      case 'bathtub':
        return <Bathtub width={item.width} depth={item.depth} height={item.height} />
      case 'toilet':
        return <Toilet width={item.width} depth={item.depth} height={item.height} />
      case 'basin':
        return <Basin width={item.width} depth={item.depth} height={item.height} />
      case 'clock':
        return <Clock size={item.width} />
      case 'marker':
        // Hidden while it is in your hand, the way a record leaves its crate.
        return heldMarker ? null : <Marker width={item.width} colour={inkAt(ink)} />
      case 'coffeemaker':
        return <CoffeeMaker brewing={brewing} potFull={potFull} cupHome={!cupOut && !cupInHand} />
      case 'phone':
        return <Phone width={item.width} depth={item.depth} height={item.height} />
      case 'fridge':
        return <Fridge width={item.width} depth={item.depth} height={item.height} />
      case 'bin':
        return <Bin width={item.width} height={item.height} />
      case 'headlamp':
        return lampAway || lampOut ? null : <PropModel kind="headlamp" full={false} />
      case 'door':
        return <DoorLeaf width={item.width} height={item.height} open={doorOpen} />
      case 'tent':
        return <Tent width={item.width} depth={item.depth} height={item.height} />
      case 'campfire':
        return <Campfire lit={lit} />
      case 'computer':
        return (
          <Computer width={item.width} depth={item.depth} height={item.height} awake={searching} />
        )
      case 'postits':
        return <PostIts width={item.width} depth={item.depth} />
      case 'recordshelf':
        return <RecordShelf width={item.width} depth={item.depth} height={item.height} />
      case 'recordplayer':
        return <RecordPlayer spinning={playing !== null && !paused} playing={playing} />
      case 'tapecrate':
        return <TapeCrate width={item.width} depth={item.depth} height={item.height} />
      case 'crt':
        return (
          <Crt width={item.width} depth={item.depth} height={item.height} playing={tape} />
        )
      case 'arcade':
        return (
          <ArcadeCabinet
            width={item.width}
            depth={item.depth}
            height={item.height}
            running={romIn !== null}
          />
        )
      case 'rombox':
        return <RomBox width={item.width} depth={item.depth} height={item.height} />
      case 'picture':
        return <Picture item={item} source={source} />
      case 'whiteboard':
        return <Whiteboard id={item.id} width={item.width} height={item.height} />
      case 'box':
        return <MovingBox width={item.width} depth={item.depth} />
      case 'boxstack':
        return <BoxStack width={item.width} depth={item.depth} height={item.height} />
      case 'stairs':
        return <Stairs width={item.width} run={item.depth} rise={item.height} />
      case 'step':
        return <Step width={item.width} depth={item.depth} height={item.height} />
    }
  })()

  // `item.y` is the base of every piece, but a picture and a whiteboard are
  // modelled about their centres — which is the only way to draw a frame — so
  // the two hung kinds are lifted by half their height. Done here rather than in
  // each body so the next thing hung on a wall cannot get it wrong: without it
  // the board's own `y` of 1.5 m put its centre at 0.9 and its pen tray at knee
  // height.
  const lift = WALL_MOUNTED.has(item.kind) ? item.height / 2 : 0

  return (
    <group
      position={[item.x, item.y + lift, item.z]}
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
  const boards = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    sceneRefs.seats = seats.current
    sceneRefs.boxes = boxes.current
    sceneRefs.surfaces = surfaces.current
    sceneRefs.fixtures = fixtures.current
    sceneRefs.boards = boards.current
    return () => {
      sceneRefs.seats = null
      sceneRefs.boxes = null
      sceneRefs.surfaces = null
      sceneRefs.fixtures = null
      sceneRefs.boards = null
    }
  }, [world, artwork])

  /**
   * Which picture hangs in which frame. A frame with a `source` names its file;
   * the rest are dealt out of `artwork/` in document order, so two frames in a
   * room do not show the same print.
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
  const pinnable = world.furniture.filter((item) => item.kind === 'whiteboard')
  const claimed = new Set(
    [...sittable, ...movingBoxes, ...operable, ...tops, ...pinnable].map((i) => i.id),
  )
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

      {/* Whiteboards, which the crosshair treats as walls you may pin to rather
          than as furniture you may do anything else with. */}
      <group ref={boards}>
        {pinnable.map((item) => (
          <Piece key={`${item.roomId}:${item.id}`} item={item} source={null} />
        ))}
      </group>
    </group>
  )
}

/**
 * The lights, separate from the furniture that carries them: a `pointLight`
 * inside `Piece` would be remounted on every unrelated re-render, and three
 * re-allocates a shadow map when that happens.
 *
 * A lamp that is off stays in the scene with no intensity. The light count is
 * baked into every shader three compiles, so unmounting one recompiles the whole
 * cabin mid-frame.
 */
export function FurnitureLights() {
  const world = useWorldStore((s) => s.world)
  const on = useAmbienceStore((s) => s.on)
  if (!world) return null

  return (
    <>
      {world.lights
        // The campfire's light mounts only while it burns, like the
        // television's glow: every point light is a term every lit fragment
        // pays for even at zero intensity, and the campfire is dark almost
        // always. Lighting it recompiles the shaders once, behind the far
        // larger cost of walking to the camp.
        .filter((lamp) => lamp.kind !== 'campfire' || (on[lamp.id] ?? lamp.defaultOn))
        .map((lamp) => {
        const lit = on[lamp.id] ?? lamp.defaultOn
        const fire = lamp.kind === 'fireplace' || lamp.kind === 'campfire'
        const fairy = lamp.kind === 'fairylights'
        return (
          <Lamp
            key={lamp.id}
            // Candela, falling off with the square of distance, so these are
            // larger than they look: at the 2 m from a pendant to the table
            // under it, 4.5 cd arrives as just over 1. Intensity pools glare at
            // the fitting; distance is what carries a soft edge into the
            // corners. Fairy lights are dimmer and reach further, which makes
            // them decoration rather than lighting.
            target={!lit ? 0 : fire || lamp.kind === 'pendant' ? 4.5 : fairy ? 1.8 : 2.8}
            breathing={fire}
            position={[lamp.x, lamp.y, lamp.z]}
            distance={fire ? 6 : lamp.kind === 'pendant' ? 10 : fairy ? 7 : 5.6}
            color={fire ? '#ff9346' : fairy ? '#ffcf82' : BULB}
          />
        )
      })}
      <CrtGlows world={world} />
    </>
  )
}

/**
 * One lamp, eased rather than switched: a toggle stepping 0 → 2.8 in a single
 * frame reads as a relay closing, a ~quarter-second ramp reads as a filament
 * warming. One float write per frame during the fade only — the light itself
 * stays mounted (see `FurnitureLights` on why unmounting recompiles shaders).
 * A fire also breathes a slow ±7%: the mesh's flames are deliberately static
 * (see `Fireplace`), but a light is below the corner-of-eye threshold.
 */
function Lamp({
  target,
  breathing,
  position,
  distance,
  color,
}: {
  target: number
  breathing: boolean
  position: [number, number, number]
  distance: number
  color: string
}) {
  const light = useRef<THREE.PointLight>(null)
  const primed = useRef(false)

  useFrame(({ clock }, delta) => {
    const node = light.current
    if (!node) return
    // First frame lands on the target: the room must not visibly warm up on load.
    if (!primed.current) {
      primed.current = true
      node.intensity = target
      return
    }
    const swing = breathing && target > 0 ? 1 + Math.sin(clock.elapsedTime * 1.7) * 0.07 : 1
    const wanted = target * swing
    const diff = wanted - node.intensity
    if (Math.abs(diff) < 0.005) {
      if (node.intensity !== wanted) node.intensity = wanted
      return
    }
    node.intensity += diff * Math.min(1, delta * 9)
  })

  return <pointLight ref={light} position={position} distance={distance} color={color} />
}

/**
 * The cold light a running television throws into the room.
 *
 * A point light hung just in front of the glass, unsteady the way a picture is
 * — the flicker is two incommensurate sines, which never repeat obviously and
 * cost nothing. Mounted only while a tape is *in* the machine, unlike the
 * lamps: every point light in the scene is a term every lit fragment pays for
 * even at zero intensity, which the software rasteriser the tests run on
 * cannot afford as a standing charge. Inserting a tape recompiles the shaders
 * once, behind the far larger cost of the video element spinning up; pause
 * only zeroes the intensity, so leaning on space never recompiles anything.
 */
function CrtGlows({ world }: { world: { furniture: DerivedFurniture[] } }) {
  const loaded = useVideoStore((s) => s.playing !== null)
  const crtId = useVideoStore((s) => s.crt)
  if (!loaded) return null
  // Only the set the tape is in glows; the others are dark glass. The first
  // set stands in when nothing recorded which one (a tape started before the
  // id was tracked), matching `sourceOf` in Sound.
  const sets = world.furniture.filter((item) => item.kind === 'crt')
  const lit = sets.find((item) => item.id === crtId) ?? sets[0]
  return lit ? <CrtGlow key={lit.id} item={lit} /> : null
}

function CrtGlow({ item }: { item: DerivedFurniture }) {
  const light = useRef<THREE.PointLight>(null)

  useFrame(({ clock }) => {
    const node = light.current
    if (!node) return
    const video = useVideoStore.getState()
    const running = video.playing !== null && !video.paused
    if (!running) {
      node.intensity = 0
      return
    }
    const t = clock.elapsedTime
    node.intensity = 0.9 + (Math.sin(t * 13.7) * Math.sin(t * 7.3) * 0.5 + 0.5) * 0.5
  })

  // Just proud of the screen, on whichever way the set is turned.
  const reach = item.depth / 2 + 0.35
  return (
    <pointLight
      ref={light}
      position={[
        item.x + Math.sin(item.rotationY) * reach,
        item.y + item.height * 0.6,
        item.z + Math.cos(item.rotationY) * reach,
      ]}
      intensity={0}
      distance={4}
      color="#8fb1e8"
    />
  )
}
