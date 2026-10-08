import { describe, expect, test } from 'claude-code/testing'

import type { GameState } from '../hooks/game/game'
import {
  RUNNER_COLUMN,
  RUNNER_WIDTH,
  comboBonusOf,
  isComboCount,
  newGame,
  pressedJump,
  pressedPause,
  startedRun,
  stepped,
} from '../hooks/game/game'
import {
  EASTER_EGG_KINDS,
  OBSTACLE_KINDS,
  spawnedObstacle,
} from '../hooks/game/obstacle'
import { FRAME_ROWS, frameOf } from '../hooks/game/renderer'
import { speedOf } from '../hooks/game/score'

const PLAYFIELD_COLUMNS = 38

const HITBOX_RIGHT = RUNNER_COLUMN + RUNNER_WIDTH - 0.5

function running(seed = 7): GameState {
  return startedRun(seed)
}

/**
 * Plays like a careful person: jumps once the next obstacle is a fixed lead
 * time away. Steps in 10 ms so the lead is exact.
 */
function playedByBot(state: GameState, milliseconds: number): GameState {
  let current = state

  for (let elapsed = 0; elapsed < milliseconds; elapsed += 10) {
    const speed = speedOf(current.runningMilliseconds)

    const isObstacleClose = current.obstacles.some(obstacle => {
      const distance = obstacle.column - HITBOX_RIGHT

      return distance > 0 && distance <= speed * 0.14
    })

    if (isObstacleClose) {
      current = pressedJump(current)
    }

    current = stepped(current, 10, PLAYFIELD_COLUMNS)
  }

  return current
}

describe('game', () => {
  test('a game waiting for Claude ignores the keys and the clock', () => {
    const waiting = newGame(1)

    expect(waiting.status).toBe('waiting')
    expect(stepped(waiting, 1_000, PLAYFIELD_COLUMNS)).toBe(waiting)
    expect(pressedJump(waiting)).toBe(waiting)
    expect(pressedPause(waiting)).toBe(waiting)
  })

  test('a slower course scrolls and scores slower, jumps unchanged', () => {
    const fullSpeed = stepped(running(), 1_000, PLAYFIELD_COLUMNS)
    const slowed = stepped(running(), 1_000, PLAYFIELD_COLUMNS, 0.7)

    expect(Math.abs(slowed.distance - fullSpeed.distance * 0.7)).toBeLessThan(1e-6)
    expect(Math.abs(slowed.score - fullSpeed.score * 0.7)).toBeLessThan(1e-6)
  })

  test('a jump rises about three rows and lands within 0.7 s', () => {
    const jumping = pressedJump(running())

    const atPeak = stepped(jumping, 330, PLAYFIELD_COLUMNS)

    expect(atPeak.body.height).toBeGreaterThan(3)
    expect(atPeak.body.height).toBeLessThan(3.5)

    const landed = stepped(jumping, 700, PLAYFIELD_COLUMNS)

    expect(landed.body.height).toBe(0)
  })

  test('a jump pressed just before landing fires on touch down', () => {
    const inTheAir = stepped(pressedJump(running()), 600, PLAYFIELD_COLUMNS)

    expect(inTheAir.body.height).toBeGreaterThan(0)

    const buffered = pressedJump(inTheAir)
    const afterLanding = stepped(buffered, 120, PLAYFIELD_COLUMNS)

    expect(afterLanding.body.velocity).toBeGreaterThan(0)
  })

  test('running into an obstacle ends the run', () => {
    const blocked: GameState = {
      ...running(),
      obstacles: [
        { kind: OBSTACLE_KINDS[0]!, column: HITBOX_RIGHT + 0.2, isCleared: false },
      ],
      columnsToNextSpawn: 100,
    }

    expect(stepped(blocked, 100, PLAYFIELD_COLUMNS).status).toBe('over')
  })

  test('a run speeds up and spawns obstacles as it goes', () => {
    expect(speedOf(0)).toBe(14)
    expect(speedOf(90_000)).toBe(30)

    const later = playedByBot(running(), 5_000)

    expect(later.obstacles.length + later.clearedCount).toBeGreaterThan(0)
  })

  test('every course can be cleared: a bot survives two minutes', () => {
    for (const seed of [1, 2, 3, 42, 1_234_567]) {
      const played = playedByBot(running(seed), 120_000)

      expect(played.status, `seed ${seed}`).toBe('running')
      expect(played.clearedCount, `seed ${seed}`).toBeGreaterThan(40)
    }
  })

  test('the score is about ten a second at the start, not runaway', () => {
    const emptyCourse: GameState = {
      ...running(),
      columnsToNextSpawn: Number.POSITIVE_INFINITY,
    }

    const afterTenSeconds = stepped(emptyCourse, 10_000, PLAYFIELD_COLUMNS)

    expect(afterTenSeconds.clearedCount).toBe(0)
    expect(afterTenSeconds.score).toBeGreaterThan(100)
    expect(afterTenSeconds.score).toBeLessThan(115)
  })

  test('a streak of 5, 10, then every 25 is a combo worth 10 a step', () => {
    expect([1, 4, 5, 6, 10, 20, 25, 49, 50, 75].filter(isComboCount)).toEqual([
      5, 10, 25, 50, 75,
    ])

    const fourCleared: GameState = {
      ...running(),
      clearedCount: 4,
      columnsToNextSpawn: Number.POSITIVE_INFINITY,
      obstacles: [
        { kind: OBSTACLE_KINDS[0]!, column: RUNNER_COLUMN - 0.4, isCleared: false },
      ],
    }

    const fifth = stepped(fourCleared, 10, PLAYFIELD_COLUMNS)

    expect(fifth.clearedCount).toBe(5)
    expect(fifth.lastEvent).toEqual({
      kind: 'combo',
      count: 5,
      bonus: 50,
      atMilliseconds: 10,
    })
    expect(fifth.score - fourCleared.score).toBeGreaterThan(50)
  })

  test('a combo is worth at most 250, however long the streak', () => {
    expect([5, 10, 25, 50, 100, 1_000].map(comboBonusOf)).toEqual([
      50, 100, 250, 250, 250, 250,
    ])
  })

  test('clearing an easter egg is worth its bonus', () => {
    const productionFriday = EASTER_EGG_KINDS.find(
      kind => kind.name === 'Production Friday',
    )!

    const beforeIt: GameState = {
      ...running(),
      columnsToNextSpawn: Number.POSITIVE_INFINITY,
      obstacles: [
        { kind: productionFriday, column: RUNNER_COLUMN - 2.4, isCleared: false },
      ],
    }

    const cleared = stepped(beforeIt, 10, PLAYFIELD_COLUMNS)

    expect(cleared.lastEvent).toMatchObject({
      kind: 'easter-egg',
      name: 'Production Friday',
      bonus: 250,
    })
    expect(cleared.score - beforeIt.score).toBeGreaterThan(250)
  })

  test('easter eggs turn up, rarely, on a long run', () => {
    let spawnedKinds: string[] = []
    let state: GameState = { ...running(3), columnsToNextSpawn: 0 }

    for (let spawnIndex = 0; spawnIndex < 2_000; spawnIndex += 1) {
      const spawned = spawnedObstacle(state.seed, PLAYFIELD_COLUMNS, 14, 0)

      spawnedKinds = [...spawnedKinds, spawned.obstacle.kind.name]
      state = { ...state, seed: spawned.seed }
    }

    const eggCount = spawnedKinds.filter(name =>
      EASTER_EGG_KINDS.some(kind => kind.name === name),
    ).length

    expect(eggCount).toBeGreaterThan(20)
    expect(eggCount).toBeLessThan(110)
  })

  test('landing kicks up dust for a moment', () => {
    const jumping = pressedJump({
      ...running(),
      columnsToNextSpawn: Number.POSITIVE_INFINITY,
    })

    const justLanded = stepped(jumping, 700, PLAYFIELD_COLUMNS)

    expect(justLanded.landedAtMilliseconds).not.toBeNull()

    const groundRowText = (state: GameState) =>
      frameOf(
        {
          game: state,
          phase: 'WORKING',
          turnNumber: 1,
          turnMilliseconds: 0,
          crashMilliseconds: 0,
          bestScore: 0,
          isLastRunBest: false,
          areMilestonesEnabled: true,
        },
        PLAYFIELD_COLUMNS,
      )[6]!
        .map(run => run.text)
        .join('')

    const dustOf = (text: string) =>
      `${text[RUNNER_COLUMN - 1]}${text[RUNNER_COLUMN + RUNNER_WIDTH]}`

    expect(dustOf(groundRowText(justLanded))).toBe('..')
    expect(dustOf(groundRowText(stepped(justLanded, 300, PLAYFIELD_COLUMNS)))).toBe(
      '  ',
    )
  })

  test('P pauses and resumes; a paused run does not move', () => {
    const paused = pressedPause(running())

    expect(paused.status).toBe('paused')
    expect(stepped(paused, 1_000, PLAYFIELD_COLUMNS)).toBe(paused)
    expect(pressedPause(paused).status).toBe('running')
  })

  test('after a hit, a jump restarts from zero', () => {
    const over: GameState = { ...running(), status: 'over', score: 500 }
    const restarted = pressedJump(over)

    expect(restarted.status).toBe('running')
    expect(restarted.score).toBe(0)
  })

  test('every frame row is exactly the playfield wide', () => {
    const played = playedByBot(running(), 8_000)

    const rows = frameOf(
      {
        game: played,
        phase: 'WORKING',
        turnNumber: 1,
        turnMilliseconds: 8_000,
        crashMilliseconds: 0,
        bestScore: 6_210,
        isLastRunBest: false,
        areMilestonesEnabled: true,
      },
      PLAYFIELD_COLUMNS,
    )

    expect(rows).toHaveLength(FRAME_ROWS)

    for (const runs of rows) {
      const width = runs.reduce((sum, run) => sum + [...run.text].length, 0)

      expect(width).toBe(PLAYFIELD_COLUMNS)
    }
  })
})
