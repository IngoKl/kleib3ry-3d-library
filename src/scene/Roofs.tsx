import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIALS } from './materials'
import { useWorldStore } from '../state/world'
import type { DerivedRoof } from '../world/derive'

/**
 * The roof. The pitched planes are slabs rather than planes, because from under
 * the eaves a roof has an underside and a thickness; the gable ends come from
 * the roof's own geometry, so the pitch is owned in one place; and none of it
 * collides, since it starts at the top of the walls.
 *
 * Deliberately out of the shadow pass: these are the largest surfaces in the
 * scene, the map costs texels in proportion to what is rasterised into it, and
 * every room has a ceiling — so the shadow lands almost nowhere.
 */

/** How thick a roof slab is, in metres. Rafters, boards and shingles. */
const THICKNESS = 0.11

/**
 * How high the underside is over a point: for a shed, the distance from the low
 * edge; for a gable, from whichever eave is nearer.
 */
function riseAt(roof: DerivedRoof, along: number): number {
  if (roof.kind === 'flat') return 0
  const low = roof.axis === 'z' ? roof.covers.minZ : roof.covers.minX
  const high = roof.axis === 'z' ? roof.covers.maxZ : roof.covers.maxX
  const tan = Math.tan(roof.pitch)

  if (roof.kind === 'shed') {
    // `fall` names the low side; the plane climbs away from it.
    const fromLow =
      roof.fall === 'south' || roof.fall === 'east' ? high - along : along - low
    return Math.max(0, fromLow) * tan
  }
  return Math.min(along - low, high - along) * tan
}

/** A box, tipped by `angle` about `axis`, centred at `centre`. */
function slab(
  size: [number, number, number],
  centre: [number, number, number],
  axis: THREE.Vector3,
  angle: number,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(...size)
  box.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...centre),
      new THREE.Quaternion().setFromAxisAngle(axis, angle),
      new THREE.Vector3(1, 1, 1),
    ),
  )
  return box
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

/**
 * A gable is two slabs meeting at the ridge, a shed is one, a flat roof is a lid.
 * A slope's length is its span over the cosine of its pitch, which is why a
 * steeper roof is not a shorter one.
 */
function slopesOf(roof: DerivedRoof): THREE.BufferGeometry[] {
  const { covers, eaves, pitch } = roof
  const width = roof.axis === 'z' ? covers.maxX - covers.minX : covers.maxZ - covers.minZ
  const acrossFrom = roof.axis === 'z' ? covers.minZ : covers.minX
  const acrossTo = roof.axis === 'z' ? covers.maxZ : covers.maxX
  const span = acrossTo - acrossFrom
  const middle = (acrossFrom + acrossTo) / 2
  const other = roof.axis === 'z' ? (covers.minX + covers.maxX) / 2 : (covers.minZ + covers.maxZ) / 2

  // Half the thickness, measured vertically: dropping the centre by this lands
  // the upper surface exactly on the derived plane.
  const sink = THICKNESS / (2 * Math.cos(pitch))

  /** One slope, from `(fromAlong, fromY)` up to `(toAlong, toY)`. */
  const one = (fromAlong: number, toAlong: number) => {
    const fromY = eaves + riseAt(roof, fromAlong)
    const toY = eaves + riseAt(roof, toAlong)
    const run = Math.abs(toAlong - fromAlong)
    const length = run / Math.cos(pitch)
    const midAlong = (fromAlong + toAlong) / 2
    const midY = (fromY + toY) / 2 - sink
    // The long axis follows the fall direction; the sign of the angle is
    // whichever tips that axis downhill.
    const downhill = toY < fromY ? 1 : -1
    return roof.axis === 'z'
      ? slab(
          [width, THICKNESS, length],
          [other, midY, midAlong],
          X_AXIS,
          // Tipping about +X sends local +Z down, so the sign depends on both
          // which end is lower and which way the slope runs.
          (toAlong > fromAlong ? 1 : -1) * downhill * pitch,
        )
      : slab(
          [length, THICKNESS, width],
          [midAlong, midY, other],
          Z_AXIS,
          // Tipping about +Z sends local +X *up*, hence the extra minus.
          -(toAlong > fromAlong ? 1 : -1) * downhill * pitch,
        )
  }

  if (roof.kind === 'flat') {
    const size: [number, number, number] =
      roof.axis === 'z' ? [width, THICKNESS, span] : [span, THICKNESS, width]
    const centre: [number, number, number] =
      roof.axis === 'z' ? [other, eaves - THICKNESS / 2, middle] : [middle, eaves - THICKNESS / 2, other]
    return [slab(size, centre, X_AXIS, 0)]
  }

  if (roof.kind === 'shed') return [one(acrossFrom, acrossTo)]

  // A gable: ridge in the middle, a slope down to each eave.
  return [one(middle, acrossFrom), one(middle, acrossTo)]
}

/**
 * The wall-coloured infill between the top of the wall and the underside of the
 * roof. An explicit polygon, because the overhang means the roof plane is
 * already above the eaves where it crosses the wall — so the outline is not a
 * triangle. Fanned from the first vertex, which is safe: both outlines a roof
 * can produce are convex.
 */
function endsOf(roof: DerivedRoof): THREE.BufferGeometry[] {
  const { walls, eaves } = roof
  if (roof.kind === 'flat') return []

  const from = roof.axis === 'z' ? walls.minZ : walls.minX
  const to = roof.axis === 'z' ? walls.maxZ : walls.maxX
  const middle = (from + to) / 2

  /** The outline, as `(along, height)` pairs running along the wall's top. */
  const outline: [number, number][] = [
    [from, eaves],
    [to, eaves],
    [to, eaves + riseAt(roof, to)],
  ]
  // A gable turns a corner at the ridge; a shed goes straight to the high side.
  if (roof.kind === 'gable') outline.push([middle, eaves + riseAt(roof, middle)])
  outline.push([from, eaves + riseAt(roof, from)])

  const at = roof.axis === 'z' ? [walls.minX, walls.maxX] : [walls.minZ, walls.maxZ]

  return at.map((fixed) => {
    const positions: number[] = []
    const push = ([along, y]: [number, number]) => {
      if (roof.axis === 'z') positions.push(fixed, y, along)
      else positions.push(along, y, fixed)
    }
    for (let i = 1; i < outline.length - 1; i++) {
      push(outline[0]!)
      push(outline[i]!)
      push(outline[i + 1]!)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    return geometry
  })
}

/** A capping board along the ridge, which is where two slopes never quite meet. */
function ridgeOf(roof: DerivedRoof): THREE.BufferGeometry[] {
  if (roof.kind !== 'gable') return []
  const { covers, peak } = roof
  return roof.axis === 'z'
    ? [
        slab(
          [covers.maxX - covers.minX, 0.1, 0.22],
          [(covers.minX + covers.maxX) / 2, peak + 0.02, (covers.minZ + covers.maxZ) / 2],
          X_AXIS,
          0,
        ),
      ]
    : [
        slab(
          [0.22, 0.1, covers.maxZ - covers.minZ],
          [(covers.minX + covers.maxX) / 2, peak + 0.02, (covers.minZ + covers.maxZ) / 2],
          Z_AXIS,
          0,
        ),
      ]
}

/**
 * A board across the rafter ends at each eave, tall enough to cover the slab's
 * raw cut end — which is what a fascia is for on a real roof too.
 */
function fasciaOf(roof: DerivedRoof): THREE.BufferGeometry[] {
  if (roof.kind === 'flat') return []
  const { covers, eaves } = roof
  const low = roof.axis === 'z' ? covers.minZ : covers.minX
  const high = roof.axis === 'z' ? covers.maxZ : covers.maxX
  const edges =
    roof.kind === 'gable'
      ? [low, high]
      : [roof.fall === 'south' || roof.fall === 'east' ? high : low]
  const y = eaves - 0.06

  return edges.map((edge) =>
    roof.axis === 'z'
      ? slab(
          [covers.maxX - covers.minX, 0.14, 0.05],
          [(covers.minX + covers.maxX) / 2, y, edge],
          X_AXIS,
          0,
        )
      : slab(
          [0.05, 0.14, covers.maxZ - covers.minZ],
          [edge, y, (covers.minZ + covers.maxZ) / 2],
          Z_AXIS,
          0,
        ),
  )
}

/**
 * One merged mesh per material for the whole building rather than per room: six
 * roofs is a dozen slabs and as many gable ends, none of which move relative to
 * each other. Two draw calls for every roof in the library.
 */

/** A stable stand-in for "no world yet", so the memo below is not rebuilt per render. */
const NO_ROOFS: DerivedRoof[] = []

export function Roofs() {
  const world = useWorldStore((s) => s.world)
  const roofs = world?.roofs ?? NO_ROOFS

  const geometry = useMemo(() => {
    const collect = (parts: THREE.BufferGeometry[]) => {
      if (parts.length === 0) return null
      const merged = mergeGeometries(parts, false)
      parts.forEach((part) => part.dispose())
      return merged
    }
    return {
      slopes: collect(roofs.flatMap(slopesOf)),
      ends: collect(roofs.flatMap(endsOf)),
      ridges: collect(roofs.flatMap((roof) => [...ridgeOf(roof), ...fasciaOf(roof)])),
    }
  }, [roofs])

  useEffect(
    () => () => {
      geometry.slopes?.dispose()
      geometry.ends?.dispose()
      geometry.ridges?.dispose()
    },
    [geometry],
  )

  if (roofs.length === 0) return null

  return (
    <group>
      {geometry.slopes && (
        <mesh geometry={geometry.slopes}>
          <meshStandardMaterial color={MATERIALS.shingle} roughness={0.95} flatShading />
        </mesh>
      )}
      {/* Double-sided: a gable end is infill a hand's width thick, and which
          side of it you are on depends on which side of the building you are. */}
      {geometry.ends && (
        <mesh geometry={geometry.ends}>
          <meshStandardMaterial
            color={MATERIALS.soffit}
            roughness={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {geometry.ridges && (
        <mesh geometry={geometry.ridges}>
          <meshStandardMaterial color={MATERIALS.timber} roughness={0.85} />
        </mesh>
      )}
    </group>
  )
}
