/**
 * How many frames the headlamp's warm-up beam has been mounted for — 0 when it
 * is not mounted at all. A plain mutable object rather than store state, like
 * `state/player.ts`: it changes per frame during the load and must not
 * re-render anything.
 *
 * It exists because two separate things change every lit material's shader —
 * the beam and the environment map — and what stalls is a *combination* nobody
 * compiled. Reading in the dark with the lamp on is the case that matters, and
 * it is exactly the pair the load would otherwise miss, so `SceneEnvironment`
 * reads this and unhooks itself for the first couple of the beam's warm frames.
 */
export const shaderWarm = { spotlight: 0 }
