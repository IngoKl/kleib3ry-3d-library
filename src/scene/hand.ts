import * as THREE from 'three'
import { approach } from '../lib/ease'

/**
 * The frame a held thing is carried in — the camera's, a moment late.
 *
 * A book, record, tape or sheet rides the camera per frame rather than being
 * parented to it. Copying the camera's orientation exactly reads as painted on
 * the screen rather than held, so the hand keeps its own orientation and eases
 * towards the camera's; offsets are measured in *that* frame, so a turn swings
 * what you carry out a little and lets it settle back.
 *
 * `RATE` is a fifth of a second of settle. Slower reads as underwater; faster
 * is not visible at all.
 */
const RATE = 14

export type Hand = {
  /** Advance the hand and return its basis, in world space. */
  follow(
    camera: THREE.Camera,
    delta: number,
  ): { quaternion: THREE.Quaternion; forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 }
}

export function makeHand(): Hand {
  const quaternion = new THREE.Quaternion()
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  let primed = false

  return {
    follow(camera, delta) {
      if (!primed) {
        // The first frame is not a turn: a teleport, a spawn or a book picked up
        // while facing somewhere new must not send it swinging in from behind.
        quaternion.copy(camera.quaternion)
        primed = true
      } else {
        quaternion.slerp(camera.quaternion, approach(RATE, Math.min(delta, 1 / 20)))
      }

      forward.set(0, 0, -1).applyQuaternion(quaternion)
      right.set(1, 0, 0).applyQuaternion(quaternion)
      up.set(0, 1, 0).applyQuaternion(quaternion)
      return { quaternion, forward, right, up }
    },
  }
}
