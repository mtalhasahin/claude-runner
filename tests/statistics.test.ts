import { describe, expect, test } from 'claude-code/testing'

import {
  EMPTY_STATISTICS,
  durationTextOf,
  runEndedOf,
  statisticsOf,
  statisticsTextOf,
  withRunEnded,
  withTurnCompleted,
} from '../hooks/storage/statistics'

describe('statistics', () => {
  test('a stored value is read field by field; junk reads as zero', () => {
    expect(statisticsOf(undefined)).toEqual(EMPTY_STATISTICS)
    expect(statisticsOf('nonsense')).toEqual(EMPTY_STATISTICS)

    expect(
      statisticsOf({
        bestScore: 8_420.7,
        gamesPlayed: -3,
        totalClaudeSessions: 'many',
        totalWaitingMilliseconds: 15_660_000,
      }),
    ).toEqual({
      bestScore: 8_420,
      gamesPlayed: 0,
      totalClaudeSessions: 0,
      totalWaitingMilliseconds: 15_660_000,
    })
  })

  test('a post is a run end only in the expected shape, its score bounded', () => {
    expect(runEndedOf({ kind: 'run-ended', score: 1_840 })).toEqual({
      kind: 'run-ended',
      score: 1_840,
    })
    expect(runEndedOf({ kind: 'run-ended', score: 1e12 })?.score).toBe(10_000_000)
    expect(runEndedOf({ kind: 'run-ended', score: 'lots' })?.score).toBe(0)
    expect(runEndedOf({ kind: 'something-else', score: 5 })).toBeNull()
    expect(runEndedOf(null)).toBeNull()
  })

  test('a run end counts a game and raises the best only when beaten', () => {
    const once = withRunEnded(EMPTY_STATISTICS, 1_200)
    const twice = withRunEnded(once, 800)

    expect(twice.gamesPlayed).toBe(2)
    expect(twice.bestScore).toBe(1_200)
  })

  test('a finished turn counts a Claude session and its waiting time', () => {
    const counted = withTurnCompleted(
      withTurnCompleted(EMPTY_STATISTICS, 90_000),
      30_000,
    )

    expect(counted.totalClaudeSessions).toBe(2)
    expect(counted.totalWaitingMilliseconds).toBe(120_000)
  })

  test('the report reads like the spec', () => {
    expect(durationTextOf(15_660_000)).toBe('04h 21m')
    expect(durationTextOf(725_000)).toBe('12m 05s')

    expect(
      statisticsTextOf({
        bestScore: 8_420,
        gamesPlayed: 127,
        totalClaudeSessions: 86,
        totalWaitingMilliseconds: 15_660_000,
      }),
    ).toBe(
      [
        'Claude Runner Stats',
        '',
        'Games:           127',
        'Best Score:      8420',
        'Claude Sessions: 86',
        'Waiting Time:    04h 21m',
      ].join('\n'),
    )
  })
})
