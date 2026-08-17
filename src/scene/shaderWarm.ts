/**
 * How many frames the headlamp's warm-up beam has been mounted for, 0 when it is
 * not. A plain mutable object, like `state/player.ts`: it changes per frame
 * during the load and must not re-render anything.
 *
 * Two things change every lit material's shader — the beam and the environment
 * map — and what stalls is a combination nobody compiled. Reading in the dark
 * with the lamp on is that pair, so `SceneEnvironment` reads this and unhooks
 * itself for the beam's first warm frames.
 */
export const shaderWarm = { spotlight: 0 }
