import { nextRandom } from './random'

/**
 * A developer's hazard: its name, drawn above it, and its size in cells.
 *
 * Every kind is low and narrow enough to clear with one jump at the starting
 * speed: height 2 at most, and width plus the runner's hitbox within what a
 * jump spends above that height.
 */
export type ObstacleKind = {
  name: string
  width: number
  height: number
  color: string
  /**
   * Points for clearing it; only the rare easter eggs carry any.
   */
  bonus: number
}

export const OBSTACLE_KINDS: readonly ObstacleKind[] = [
  { name: 'Bug', width: 1, height: 1, color: '#e5534b', bonus: 0 },
  { name: 'TODO', width: 2, height: 1, color: '#d4a72c', bonus: 0 },
  { name: 'Error', width: 1, height: 2, color: '#e5534b', bonus: 0 },
  { name: 'Timeout', width: 3, height: 1, color: '#539bf5', bonus: 0 },
  { name: 'Exception', width: 2, height: 2, color: '#b083f0', bonus: 0 },
  { name: 'Merge Conflict', width: 3, height: 2, color: '#e0823d', bonus: 0 },
]

/**
 * The rare ones: drawn in gold, worth a bonus when cleared.
 */
export const EASTER_EGG_KINDS: readonly ObstacleKind[] = [
  { name: '404 Bug', width: 2, height: 1, color: '#f2cc60', bonus: 100 },
  { name: 'NullReferenceException', width: 3, height: 1, color: '#f2cc60', bonus: 150 },
  { name: 'Production Friday', width: 3, height: 2, color: '#f2cc60', bonus: 250 },
  { name: 'Merge Conflict x3', width: 3, height: 2, color: '#f2cc60', bonus: 200 },
]

/**
 * The chance that an obstacle is an easter egg instead.
 */
export const EASTER_EGG_CHANCE = 0.03

export type Obstacle = {
  kind: ObstacleKind
  /**
   * Column of its left edge from the playfield's left; fractional while it
   * moves, drawn rounded.
   */
  column: number
  /**
   * True once the runner has passed it, so it counts once.
   */
  isCleared: boolean
}

/**
 * Columns of open ground between one obstacle and the next at a speed: never
 * less than a landing and a fresh jump need, and tighter as the run goes on.
 *
 * @param speed columns per second
 * @param difficulty 0 at the start, 1 at full difficulty
 */
export function gapRangeOf(
  speed: number,
  difficulty: number,
): { minimum: number; maximum: number } {
  const minimum = Math.ceil(speed * 0.75) + 3
  const spread = Math.round(22 - 14 * difficulty)

  return { minimum, maximum: minimum + spread }
}

/**
 * A new obstacle just past the right edge, and the gap after it.
 */
export function spawnedObstacle(
  seed: number,
  playfieldColumns: number,
  speed: number,
  difficulty: number,
): { obstacle: Obstacle; gapAfter: number; seed: number } {
  const eggRoll = nextRandom(seed)
  const kindRoll = nextRandom(eggRoll.seed)
  const gapRoll = nextRandom(kindRoll.seed)

  const kinds =
    eggRoll.value < EASTER_EGG_CHANCE ? EASTER_EGG_KINDS : OBSTACLE_KINDS
  const kindIndex = Math.floor(kindRoll.value * kinds.length)
  const kind = kinds[kindIndex] ?? OBSTACLE_KINDS[0]!
  const { minimum, maximum } = gapRangeOf(speed, difficulty)
  const gapAfter = minimum + Math.floor(gapRoll.value * (maximum - minimum + 1))

  return {
    obstacle: { kind, column: playfieldColumns, isCleared: false },
    gapAfter,
    seed: gapRoll.seed,
  }
}
