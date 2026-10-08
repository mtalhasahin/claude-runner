import { describe, expect, test } from 'claude-code/testing'

import type { GameState } from '../hooks/game/game'
import { startedRun } from '../hooks/game/game'
import { milestoneTextOf } from '../hooks/game/milestones'
import { FRAME_ROWS, frameOf } from '../hooks/game/renderer'
import type { ClientState } from '../hooks/game/session-link'

function clientStateOf(
  game: GameState,
  overrides: Partial<ClientState> = {},
): ClientState {
  return {
    game,
    phase: 'WORKING',
    turnNumber: 1,
    turnMilliseconds: 0,
    bestScore: 6_210,
    isLastRunBest: false,
    areMilestonesEnabled: true,
    hasPressedKey: true,
    ...overrides,
  }
}

function rowTextsOf(state: ClientState, columns: number): string[] {
  return frameOf(state, columns).map(runs => runs.map(run => run.text).join(''))
}

const RUNNING: GameState = {
  ...startedRun(1),
  runningMilliseconds: 20_000,
  clearedCount: 7,
}

describe('renderer', () => {
  test('milestones show for four seconds after 30 s, 1, 2 and 5 minutes', () => {
    expect(milestoneTextOf(29_999)).toBeNull()
    expect(milestoneTextOf(30_000)).toBe('Claude is warming up...')
    expect(milestoneTextOf(33_999)).toBe('Claude is warming up...')
    expect(milestoneTextOf(34_000)).toBeNull()
    expect(milestoneTextOf(61_000)).toBe('Deep thinking...')
    expect(milestoneTextOf(121_000)).toBe('This is getting serious...')
    expect(milestoneTextOf(301_000)).toBe('Are we building an operating system?')
    expect(milestoneTextOf(400_000)).toBeNull()
  })

  test('a milestone takes the message line while running, unless turned off', () => {
    const atOneMinute = clientStateOf(RUNNING, { turnMilliseconds: 61_000 })

    expect(rowTextsOf(atOneMinute, 38).at(-1)).toContain('Deep thinking...')
    expect(
      rowTextsOf({ ...atOneMinute, areMilestonesEnabled: false }, 38).at(-1),
    ).toContain('Cleared 7')
  })

  test('a combo just now outranks a milestone', () => {
    const comboAndMilestone = clientStateOf(
      {
        ...RUNNING,
        lastEvent: {
          kind: 'combo',
          count: 10,
          bonus: 100,
          atMilliseconds: 19_500,
        },
      },
      { turnMilliseconds: 61_000 },
    )

    expect(rowTextsOf(comboAndMilestone, 38).at(-1)).toContain('COMBO x10  +100')
  })

  test('an easter egg shows its name and bonus, then gives way', () => {
    const egg = {
      kind: 'easter-egg' as const,
      name: 'Production Friday',
      bonus: 250,
      atMilliseconds: 19_000,
    }

    expect(
      rowTextsOf(clientStateOf({ ...RUNNING, lastEvent: egg }), 38).at(-1),
    ).toContain('Production Friday!  +250')
    expect(
      rowTextsOf(
        clientStateOf({ ...RUNNING, lastEvent: egg, runningMilliseconds: 21_000 }),
        38,
      ).at(-1),
    ).toContain('Cleared 7')
  })

  test('the frame fits a narrow and a wide pane, the HUD shortening', () => {
    for (const columns of [24, 30, 38, 60]) {
      const rows = rowTextsOf(clientStateOf(RUNNING), columns)

      expect(rows, `${columns} columns`).toHaveLength(FRAME_ROWS)

      for (const row of rows) {
        expect([...row].length, `${columns} columns`).toBe(columns)
      }
    }

    expect(rowTextsOf(clientStateOf(RUNNING), 38)[0]).toContain('Session')
    expect(rowTextsOf(clientStateOf(RUNNING), 30)[0]).not.toContain('Session')
    expect(rowTextsOf(clientStateOf(RUNNING), 24)[0]).toMatch(/^S \d{5}/)
  })
})
