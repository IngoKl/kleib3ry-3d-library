import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32 } from '../lib/rng'
import { useAmbienceStore } from '../state/ambience'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'

/**
 * Dust drifting in the lamplight.
 *
 * A handful of specks wandering slowly under each lit floor lamp and pendant —
 * the cheapest thing that makes still air read as air. One instanced mesh for
 * every mote in the building; a mote under an unlit lamp is scaled to nothing
 * rather than unmounted, so flipping a switch never rebuilds anything. The
 * paths are closed lissajous curves off a seeded generator: no allocation and
 * no randomness in the frame loop, and the same lamp gathers the same dust on
 * every visit.
 *
 * Only fittings with a bulb get dust — a fireplace has smoke and fairy lights
 * are a string, not a beam.
 */
const MOTES_PER_LAMP = 6
/** The volume the dust wanders, centred under the fitting. */
const SPREAD = 0.42
const FALL = 0.55

type Mote = {
  lamp: number
  px: number
  py: number
  pz: number
  sx: number
  sy: number
  sz: number
}

export function DustMotes() {
  const world = useWorldStore((s) => s.world)
  const low = useSettings((s) => s.lowPerformance)
  const mesh = useRef<THREE.InstancedMesh>(null)

  const lamps = useMemo(
    () =>
      (world?.lights ?? []).filter(
        (lamp) => lamp.kind === 'floorlamp' || lamp.kind === 'pendant',
      ),
    [world],
  )

  const motes = useMemo<Mote[]>(() => {
    const random = mulberry32(0xd057)
    return lamps.flatMap((_, lamp) =>
      Array.from({ length: MOTES_PER_LAMP }, () => ({
        lamp,
        px: random() * Math.PI * 2,
        py: random() * Math.PI * 2,
        pz: random() * Math.PI * 2,
        sx: 0.05 + random() * 0.09,
        sy: 0.04 + random() * 0.06,
        sz: 0.05 + random() * 0.09,
      })),
    )
  }, [lamps])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      size: new THREE.Vector3(),
      hidden: new THREE.Vector3(0, 0, 0),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const node = mesh.current
    if (!node) return
    const t = clock.elapsedTime
    const ambience = useAmbienceStore.getState()

    motes.forEach((mote, i) => {
      const lamp = lamps[mote.lamp]!
      const lit = ambience.isOn(lamp.id, lamp.defaultOn)
      if (!lit) {
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.hidden)
        node.setMatrixAt(i, scratch.matrix)
        return
      }
      scratch.position.set(
        lamp.x + Math.sin(t * mote.sx * Math.PI + mote.px) * SPREAD,
        lamp.y - 0.28 - (Math.sin(t * mote.sy * Math.PI + mote.py) * 0.5 + 0.5) * FALL,
        lamp.z + Math.sin(t * mote.sz * Math.PI + mote.pz) * SPREAD,
      )
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.size.setScalar(1))
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  // Instances are rewritten around fixed lamps every frame; the sphere a frame
  // computed once from an empty mesh would cull the lot.
  useEffect(() => {
    if (mesh.current) mesh.current.frustumCulled = false
  }, [motes.length])

  if (low || motes.length === 0) return null
  return (
    <instancedMesh
      key={motes.length}
      ref={mesh}
      args={[undefined, undefined, motes.length]}
    >
      {/* A speck with faces, not a billboard: at 6 mm nobody can tell, and it
          saves orienting every mote at the camera each frame. */}
      <octahedronGeometry args={[0.006, 0]} />
      <meshBasicMaterial color="#ffe9c4" transparent opacity={0.4} depthWrite={false} />
    </instancedMesh>
  )
}
