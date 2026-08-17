import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIALS } from './materials'
import { useWorldStore } from '../state/world'
import type { DerivedRoof } from '../world/derive'

/**
 * The roof. Three decisions worth knowing:
 *
 *   - the pitched planes are *slabs*, not planes: from below the eaves a roof
 *     has an underside and a thickness, both visible from the porch;
 *   - the gable ends come from the roof's own geometry rather than taller
 *     walls, so the pitch is owned in one place;
 *   - none of it collides. A roof starts at the top of the walls and only the
 *     eaves come down, outside and over head height (see `roofsOf`).
 *
 * None of it is in the shadow pass, deliberately. These are the largest
 * surfaces in the scene, the shadow map costs texels in proportion to what is
 * rasterised into it, and the shadow lands almost nowhere — every room has a
 * ceiling, so only the strip under the eaves could darken, and the walls
 * already shade that.
 */

/** How thick a roof slab is, in metres. Rafters, boards and shingles. */
const THICKNESS = 0.11

/**
 * How high the underside of the roof is over a point, measured from the eaves.
 *
 * For a shed that is the distance from the low edge; for a gable it is the
 * distance from whichever eave is nearer, which is the same thing said twice
 * about a roof with two slopes.
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
 * The pitched planes of one roof.
 *
 * A gable is two slabs meeting at the ridge; a shed is one; a flat roof is a lid
 * and needs no tipping at all. The length of a slope is the span it covers
 * divided by the cosine of its pitch, which is the only trigonometry in here and
 * the reason a steeper roof is not a shorter one.
 */
function slopesOf(roof: DerivedRoof): THREE.BufferGeometry[] {
  const { covers, eaves, pitch } = roof
  const width = roof.axis === 'z' ? covers.maxX - covers.minX : covers.maxZ - covers.minZ
  const acrossFrom = roof.axis === 'z' ? covers.minZ : covers.minX
  const acrossTo = roof.axis === 'z' ? covers.maxZ : covers.maxX
  const span = acrossTo - acrossFrom
  const middle = (acrossFrom + acrossTo) / 2
  const other = roof.axis === 'z' ? (covers.minX + covers.maxX) / 2 : (covers.minZ + covers.maxZ) / 2

  // Half the slab's thickness, measured vertically: a tipped slab's top face is
  // higher than its centre line by this, so the centre is dropped by it and the
  // *upper* surface lands exactly on the derived plane.
  const sink = THICKNESS / (2 * Math.cos(pitch))

  /** One slope, from `(fromAlong, fromY)` up to `(toAlong, toY)`. */
  const one = (fromAlong: number, toAlong: number) => {
    const fromY = eaves + riseAt(roof, fromAlong)
    const toY = eaves + riseAt(roof, toAlong)
    const run = Math.abs(toAlong - fromAlong)
    const length = run / Math.cos(pitch)
    const midAlong = (fromAlong + toAlong) / 2
    const midY = (fromY + toY) / 2 - sink
    // The slab's long axis is its local Z for a roof falling along Z, and its
    // local X for one falling along X; the sign of the angle is whichever tips
    // that axis downhill.
    const downhill = toY < fromY ? 1 : -1
    return roof.axis === 'z'
      ? slab(
          [width, THICKNESS, length],
          [other, midY, midAlong],
          X_AXIS,
          // Tipping about +X sends local +Z downwards, so a slope whose far end
          // is lower than its near end takes a positive angle only when it also
          // runs towards +Z. Both signs are folded together here.
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
 * The gable end: the wall-coloured infill between the top of the wall and the
 * underside of the roof.
 *
 * Built as an explicit polygon rather than by extruding a shape, because the
 * outline is not a triangle — the overhang means the roof plane is already above
 * the eaves line where it crosses the wall, so there is a short upright at each
 * end before the pitch starts. Fanned from the first vertex, which is safe
 * because both outlines a roof can produce (triangle-on-a-plinth for a gable, a
 * trapezoid for a shed) are convex.
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
 * A fascia across the rafter ends at each eave: both low edges of a gable,
 * the one low edge of a shed. Plumb and centred on the eave line, tall enough
 * to cover the slab's raw cut end — which is what the board is for on a real
 * roof too. Timber, so it rides the ridge merge.
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
 * One merged mesh per material for the whole building, not per room.
 *
 * Six roofs is a dozen slabs, a dozen gable ends and a handful of ridge boards.
 * None of them ever move relative to each other, which is the same argument the
 * room shells make for merging, and for the same payoff: two draw calls for
 * every roof in the library.
 */
export function Roofs() {
  const world = useWorldStore((s) => s.world)
  const roofs = world?.roofs ?? []

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
