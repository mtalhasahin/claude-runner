/**
 * Speed and score over the run's elapsed time.
 *
 * The score grows about 10 points a second at the start and a little faster
 * as the run speeds up: a two-minute wait is worth roughly 1,500, not tens of
 * thousands.
 */
export const START_SPEED_COLUMNS_PER_SECOND = 14

export const MAXIMUM_SPEED_COLUMNS_PER_SECOND = 30

/**
 * Seconds of running until the run is at full difficulty.
 */
export const FULL_DIFFICULTY_SECONDS = 90

const POINTS_PER_SECOND_AT_START = 10

/**
 * 0 at the start, rising to 1 at FULL_DIFFICULTY_SECONDS.
 */
export function difficultyOf(runningMilliseconds: number): number {
  return Math.min(1, runningMilliseconds / 1000 / FULL_DIFFICULTY_SECONDS)
}

export function speedOf(runningMilliseconds: number): number {
  return (
    START_SPEED_COLUMNS_PER_SECOND +
    (MAXIMUM_SPEED_COLUMNS_PER_SECOND - START_SPEED_COLUMNS_PER_SECOND) *
      difficultyOf(runningMilliseconds)
  )
}

/**
 * The points one frame adds: time run, weighted by how fast the run is.
 */
export function pointsFor(milliseconds: number, speed: number): number {
  const speedMultiplier = speed / START_SPEED_COLUMNS_PER_SECOND

  return (milliseconds / 1000) * POINTS_PER_SECOND_AT_START * speedMultiplier
}
