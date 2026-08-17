import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { between, mulberry32 } from '../lib/rng'
import type { Bounds } from '../world/derive'
import { occupied } from '../world/forest'
import { GROUND_Y, PATH, lakeRadius } from '../world/terrain'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'
import { place, type Placed } from './Outside'

/**
 * The forest floor: tufts, ferns, mushrooms and a couple of fallen logs. Grown
 * with the erratics' rejection test, and like them not collidable — this is
 * ankle-height scenery you step over, and the trunks are what you walk into.
 */

const TUFT_GREENS = ['#4a5c34', '#55683b', '#41522d', '#5e6f3f']
const FERN_GREENS = ['#2f4626', '#3a552e', '#293d21']
const MUSHROOM_TONES = ['#b98a5a', '#c9563e', '#d8c9a8']
const LOG_BROWN = '#5c4a33'

/** Five thin blades crossed about a centre, unit height with the base at 0. */
function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const blades = 5
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2 + i * 0.7
    const lean = 0.18 + (i % 3) * 0.08
    const ox = Math.cos(angle) * 0.05
    const oz = Math.sin(angle) * 0.05
    // Base edge perpendicular to the lean, tip leaning outward.
    const px = -Math.sin(angle) * 0.035
    const pz = Math.cos(angle) * 0.035
    positions.push(
      ox - px, 0, oz - pz,
      ox + px, 0, oz + pz,
      ox + Math.cos(angle) * lean, 1, oz + Math.sin(angle) * lean,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Six fronds radiating from a crown, arcing up and drooping at the tip. */
function fernGeometry(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.PlaneGeometry(0.16, 1, 1, 3)
    frond.translate(0, 0.5, 0)
    const positions = frond.attributes.position as THREE.BufferAttribute
    for (let v = 0; v < positions.count; v++) {
      const y = positions.getY(v)
      positions.setZ(v, positions.getZ(v) + y * y * 0.6)
      positions.setY(v, y * (1 - y * 0.45))
    }
    frond.rotateY((i / 6) * Math.PI * 2 + (i % 2) * 0.35)
    parts.push(frond)
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  merged?.computeVertexNormals()
  return merged
}

/** Stem and cap in one piece; the cap is stretched, since the y-scale squashes it. */
function mushroomGeometry(): THREE.BufferGeometry | null {
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 1, 6)
  stem.translate(0, 0.5, 0)
  const cap = new THREE.SphereGeometry(0.05, 7, 5)
  cap.scale(1, 3.2, 1)
  cap.translate(0, 1, 0)
  const merged = mergeGeometries([stem, cap], false)
  stem.dispose()
  cap.dispose()
  return merged
}

/** A trunk lying down: rolled onto the x axis so the instance yaw aims it. */
function logGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(1, 1.12, 1, 7)
  trunk.rotateZ(Math.PI / 2)
  return trunk
}

export function Undergrowth({ keepOut }: { keepOut: readonly Bounds[] }) {
  const world = useWorldStore((s) => s.world)
  const low = useSettings((s) => s.lowPerformance)
  const tufts = useRef<THREE.InstancedMesh>(null)
  const ferns = useRef<THREE.InstancedMesh>(null)
  const mushrooms = useRef<THREE.InstancedMesh>(null)
  const logs = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(
    () => ({
      tuft: tuftGeometry(),
      fern: fernGeometry(),
      mushroom: mushroomGeometry(),
      log: logGeometry(),
    }),
    [],
  )
  useEffect(
    () => () => {
      geometry.tuft.dispose()
      geometry.fern?.dispose()
      geometry.mushroom?.dispose()
      geometry.log.dispose()
    },
    [geometry],
  )

  const strewn = useMemo(() => {
    const random = mulberry32(0x9e0b)
    const pickFrom = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!
    const clear = (x: number, z: number) =>
      !occupied(x, z, keepOut) && lakeRadius(x, z) >= PATH.to + 0.06
    const trees = world?.trees ?? []
    const conifers = trees.filter((tree) => tree.species !== 'birch')

    const tuft: Placed[] = []
    const tuftWant = low ? 110 : 240
    for (let i = 0; i < tuftWant * 5 && tuft.length < tuftWant; i++) {
      const angle = random() * Math.PI * 2
      const distance = 9 + Math.sqrt(random()) * 36
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (!clear(x, z)) continue
      const size = between(random, 0.15, 0.4)
      tuft.push({
        x,
        y: GROUND_Y,
        z,
        scale: [size, size * between(random, 0.8, 1.2), size],
        yaw: random() * Math.PI * 2,
        colour: pickFrom(TUFT_GREENS),
      })
    }

    // Ferns keep to the shade: each one stands a stride from a conifer.
    const fern: Placed[] = []
    const fernWant = low ? 25 : 60
    for (let i = 0; i < fernWant * 6 && fern.length < fernWant && conifers.length > 0; i++) {
      const host = conifers[Math.floor(random() * conifers.length)]!
      const angle = random() * Math.PI * 2
      const away = between(random, 0.6, 1.8)
      const x = host.x + Math.cos(angle) * away
      const z = host.z + Math.sin(angle) * away
      if (!clear(x, z)) continue
      const size = between(random, 0.3, 0.6)
      fern.push({
        x,
        y: GROUND_Y,
        z,
        scale: [size, size * between(random, 0.7, 1.1), size],
        yaw: random() * Math.PI * 2,
        colour: pickFrom(FERN_GREENS),
      })
    }

    const mushroom: Placed[] = []
    const mushroomWant = low ? 14 : 36
    for (let i = 0; i < mushroomWant * 6 && mushroom.length < mushroomWant && trees.length > 0; i++) {
      const host = trees[Math.floor(random() * trees.length)]!
      const angle = random() * Math.PI * 2
      const away = between(random, 0.25, 0.7)
      const x = host.x + Math.cos(angle) * away
      const z = host.z + Math.sin(angle) * away
      if (!clear(x, z)) continue
      const girth = between(random, 0.85, 1.5)
      mushroom.push({
        x,
        y: GROUND_Y,
        z,
        scale: [girth, between(random, 0.06, 0.13), girth],
        yaw: random() * Math.PI * 2,
        colour: pickFrom(MUSHROOM_TONES),
      })
    }

    const log: Placed[] = []
    for (let i = 0; i < 80 && log.length < 2; i++) {
      const angle = random() * Math.PI * 2
      const distance = between(random, 15, 35)
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      const yaw = random() * Math.PI * 2
      // Both ends checked too — 3.5 m of trunk lying across the trail would
      // read as a barrier the walk controller ignores.
      const endX = Math.cos(yaw) * 1.75
      const endZ = -Math.sin(yaw) * 1.75
      if (!clear(x, z) || !clear(x + endX, z + endZ) || !clear(x - endX, z - endZ)) continue
      log.push({
        x,
        y: GROUND_Y + 0.24,
        z,
        scale: [3.5, 0.28, 0.28],
        yaw,
        colour: LOG_BROWN,
      })
    }

    return { tuft, fern, mushroom, log }
  }, [keepOut, low, world])

  useLayoutEffect(() => {
    place(tufts.current, strewn.tuft)
    place(ferns.current, strewn.fern)
    place(mushrooms.current, strewn.mushroom)
    place(logs.current, strewn.log)
  }, [strewn])

  return (
    <group>
      {strewn.tuft.length > 0 && (
        <instancedMesh
          key={`tuft-${strewn.tuft.length}`}
          ref={tufts}
          args={[geometry.tuft, undefined, strewn.tuft.length]}
        >
          <meshStandardMaterial roughness={1} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      {geometry.fern && strewn.fern.length > 0 && (
        <instancedMesh
          key={`fern-${strewn.fern.length}`}
          ref={ferns}
          args={[geometry.fern, undefined, strewn.fern.length]}
        >
          <meshStandardMaterial roughness={1} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      {geometry.mushroom && strewn.mushroom.length > 0 && (
        <instancedMesh
          key={`mushroom-${strewn.mushroom.length}`}
          ref={mushrooms}
          args={[geometry.mushroom, undefined, strewn.mushroom.length]}
        >
          <meshStandardMaterial roughness={1} flatShading />
        </instancedMesh>
      )}
      {strewn.log.length > 0 && (
        <instancedMesh
          key={`log-${strewn.log.length}`}
          ref={logs}
          args={[geometry.log, undefined, strewn.log.length]}
          castShadow
        >
          <meshStandardMaterial roughness={1} flatShading />
        </instancedMesh>
      )}
    </group>
  )
}
