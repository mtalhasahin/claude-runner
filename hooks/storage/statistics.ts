/**
 * What Claude Runner keeps across sessions: counts and durations only. No
 * prompt, file, tool output, path or key ever reaches it.
 */
export type Statistics = {
  bestScore: number
  /**
   * Runs that ended: by a hit, by Claude's answer, or by Claude's failure.
   */
  gamesPlayed: number
  /**
   * Main-loop turns that ended: each one a wait for Claude.
   */
  totalClaudeSessions: number
  totalWaitingMilliseconds: number
}

export const STATISTICS_STORE_KEY = 'statistics'

export const EMPTY_STATISTICS: Statistics = {
  bestScore: 0,
  gamesPlayed: 0,
  totalClaudeSessions: 0,
  totalWaitingMilliseconds: 0,
}

/**
 * Bounds what any one report may add, so a corrupt store file or a bad post
 * cannot push the numbers anywhere absurd.
 */
const LARGEST_SCORE = 10_000_000

const LARGEST_DURATION_MILLISECONDS = 24 * 60 * 60 * 1000

function countOf(value: unknown, largest: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(largest, Math.max(0, Math.floor(value)))
    : 0
}

/**
 * The statistics in a stored value, each field checked; a missing or broken
 * field reads as 0.
 */
export function statisticsOf(stored: unknown): Statistics {
  if (typeof stored !== 'object' || stored === null) {
    return EMPTY_STATISTICS
  }

  const field = (name: keyof Statistics) => Reflect.get(stored, name)

  return {
    bestScore: countOf(field('bestScore'), LARGEST_SCORE),
    gamesPlayed: countOf(field('gamesPlayed'), Number.MAX_SAFE_INTEGER),
    totalClaudeSessions: countOf(
      field('totalClaudeSessions'),
      Number.MAX_SAFE_INTEGER,
    ),
    totalWaitingMilliseconds: countOf(
      field('totalWaitingMilliseconds'),
      Number.MAX_SAFE_INTEGER,
    ),
  }
}

/**
 * A run's end as the game posts it.
 */
export type RunEnded = {
  kind: 'run-ended'
  score: number
}

/**
 * Whether a `ui.message` post says a run started.
 */
export function isRunStartedPost(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    Reflect.get(data, 'kind') === 'run-started'
  )
}

/**
 * The run's end in a `ui.message` post, or null when the post is anything
 * else. The post is code's word, not a fact: its shape is checked and its
 * score bounded.
 */
export function runEndedOf(data: unknown): RunEnded | null {
  const isRunEnded =
    typeof data === 'object' &&
    data !== null &&
    Reflect.get(data, 'kind') === 'run-ended'

  if (!isRunEnded) {
    return null
  }

  return { kind: 'run-ended', score: countOf(Reflect.get(data, 'score'), LARGEST_SCORE) }
}

export function withRunEnded(
  statistics: Statistics,
  score: number,
): Statistics {
  return {
    ...statistics,
    bestScore: Math.max(statistics.bestScore, countOf(score, LARGEST_SCORE)),
    gamesPlayed: statistics.gamesPlayed + 1,
  }
}

export function withTurnCompleted(
  statistics: Statistics,
  durationMilliseconds: number,
): Statistics {
  return {
    ...statistics,
    totalClaudeSessions: statistics.totalClaudeSessions + 1,
    totalWaitingMilliseconds:
      statistics.totalWaitingMilliseconds +
      countOf(durationMilliseconds, LARGEST_DURATION_MILLISECONDS),
  }
}

/**
 * `04h 21m`, or `12m 05s` under an hour.
 */
export function durationTextOf(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  const twoDigits = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${twoDigits(hours)}h ${twoDigits(minutes)}m`
    : `${twoDigits(minutes)}m ${twoDigits(seconds)}s`
}

/**
 * The `/runner stats` report.
 */
export function statisticsTextOf(statistics: Statistics): string {
  const rows: [string, string][] = [
    ['Games', String(statistics.gamesPlayed)],
    ['Best Score', String(statistics.bestScore)],
    ['Claude Sessions', String(statistics.totalClaudeSessions)],
    ['Waiting Time', durationTextOf(statistics.totalWaitingMilliseconds)],
  ]

  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2

  return [
    'Claude Runner Stats',
    '',
    ...rows.map(([label, value]) => `${`${label}:`.padEnd(labelWidth)}${value}`),
  ].join('\n')
}
