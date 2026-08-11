import { useMemo } from 'react'
import * as THREE from 'three'
import { useShelfTransforms } from './transforms'
import { packRow } from './shelving'
import { INTERIOR_WIDTH, rowMetrics } from '../world/shelf'
import { rowKey } from './shelving'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * Shows where the book in your hand would land: a slot marker between the two
 * books it would sit between, plus a wash over the whole compartment. Without
 * this, placing is guesswork — you cannot see an insertion point.
 */
export function PlacementGhost() {
  const target = useAppStore((s) => s.shelfTarget)
  const held = useAppStore((s) => s.held)
  const rows = useLibraryStore((s) => s.rows)
  const dims = useLibraryStore((s) => s.dims)
  const world = useWorldStore((s) => s.world)
  const transforms = useShelfTransforms()

  const pose = useMemo(() => {
    if (!target || !held || !world) return null
    const transform = transforms[target.shelf]
    const shelf = world.shelves[target.shelf]
    const size = dims.get(held)
    if (!transform || !shelf || !size) return null

    const packed = packRow(
      shelf,
      target.shelf,
      target.row,
      rows[rowKey(shelf.id, target.row)] ?? [],
      (id) => dims.get(id),
    )

    // Sit the marker on the boundary between neighbours rather than under the
    // crosshair, so it snaps to where the book will actually end up.
    const before = packed[target.index - 1]
    const edge = before
      ? before.localX + (dims.get(before.id)?.thickness ?? 0) / 2
      : -INTERIOR_WIDTH / 2 + 0.008
    const localX = edge + size.thickness / 2

    const { rowHeight, surfaceY } = rowMetrics(shelf.rows)
    const surface = surfaceY(target.row)
    return {
      quaternion: transform.quaternion.clone(),
      book: new THREE.Vector3(localX, surface + size.height / 2, 0.09).applyMatrix4(
        transform.matrix,
      ),
      shelf: new THREE.Vector3(0, surface + rowHeight / 2, 0.02).applyMatrix4(transform.matrix),
      rowHeight,
      size,
    }
  }, [target, held, rows, dims, world, transforms])

  if (!pose) return null

  return (
    <group>
      <mesh position={pose.shelf} quaternion={pose.quaternion}>
        <planeGeometry args={[INTERIOR_WIDTH, pose.rowHeight]} />
        <meshBasicMaterial
          color="#f3d9a0"
          transparent
          opacity={0.09}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={pose.book} quaternion={pose.quaternion}>
        <boxGeometry args={[pose.size.thickness, pose.size.height, pose.size.depth]} />
        <meshBasicMaterial color="#f3d9a0" transparent opacity={0.34} depthWrite={false} />
      </mesh>
    </group>
  )
}
