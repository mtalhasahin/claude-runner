import { describe, expect, test } from 'claude-code/testing'

import { pressedJump } from '../hooks/game/game'
import type { ClientState, LinkProps } from '../hooks/game/session-link'
import {
  CRASH_ANIMATION_MILLISECONDS,
  initialClientState,
  isCrashBlinkDark,
  isRedrawNeeded,
  linkedToSession,
  notedRunEnd,
  ticked,
} from '../hooks/game/session-link'

const COLUMNS = 38

const IDLE: LinkProps = {
  seed: 5,
  phase: 'IDLE',
  turnNumber: 0,
  turnElapsedMilliseconds: 0,
  bestScore: 0,
  areMilestonesEnabled: true,
}

const WORKING: LinkProps = {
  seed: 5,
  phase: 'WORKING',
  turnNumber: 1,
  turnElapsedMilliseconds: 0,
  bestScore: 0,
  areMilestonesEnabled: true,
}

function runFor(state: ClientState, milliseconds: number): ClientState {
  let current = state

  for (let elapsed = 0; elapsed < milliseconds; elapsed += 60) {
    current = ticked(current, 60, COLUMNS)
  }

  return current
}

describe('session-link', () => {
  test('idle, the game waits; a turn starts a run', () => {
    const idle = initialClientState(IDLE)

    expect(idle.game.status).toBe('waiting')
    expect(runFor(idle, 1_000).game).toBe(idle.game)

    const working = linkedToSession(idle, WORKING)

    expect(working.game.status).toBe('running')
  })

  test('a pane opened mid-turn starts running at once', () => {
    expect(initialClientState(WORKING).game.status).toBe('running')
  })

  test('the same phase again changes nothing', () => {
    const working = initialClientState(WORKING)

    expect(linkedToSession(working, WORKING)).toBe(working)
  })

  test('waiting on a tool slows the course to 70 %', () => {
    const working = initialClientState(WORKING)
    const onTool = linkedToSession(working, { ...WORKING, phase: 'WAITING_FOR_TOOL' })

    const fullSpeed = runFor(working, 1_200)
    const slowed = runFor(onTool, 1_200)

    expect(
      Math.abs(slowed.game.distance - fullSpeed.game.distance * 0.7),
    ).toBeLessThan(1e-6)
  })

  test('thinking after a tool keeps the same run going', () => {
    const played = runFor(initialClientState(WORKING), 1_000)

    const thinking = linkedToSession(played, {
      ...WORKING,
      phase: 'WAITING_FOR_RESPONSE',
    })

    expect(thinking.game).toBe(played.game)
    expect(thinking.game.status).toBe('running')
  })

  test('an answer halts the run and keeps its score', () => {
    const played = runFor(initialClientState(WORKING), 2_000)
    const completed = linkedToSession(played, { ...WORKING, phase: 'COMPLETED' })

    expect(completed.game.status).toBe('halted')
    expect(completed.game.score).toBe(played.game.score)
    expect(runFor(completed, 1_000).game).toBe(completed.game)
    expect(pressedJump(completed.game)).toBe(completed.game)
  })

  test('the turn clock keeps going after a hit, stops after the answer', () => {
    const working = initialClientState(WORKING)
    const hit = { ...working, game: { ...working.game, status: 'over' as const } }

    const afterHit = runFor(hit, 3_000)

    expect(afterHit.turnMilliseconds).toBeGreaterThanOrEqual(3_000)

    const completed = linkedToSession(afterHit, {
      ...WORKING,
      phase: 'COMPLETED',
      turnElapsedMilliseconds: 3_250,
    })

    expect(completed.turnMilliseconds, "the engine's duration").toBe(3_250)
    expect(runFor(completed, 3_000).turnMilliseconds).toBe(3_250)
  })

  test('a pane opened mid-turn shows the turn time so far, not 00:00', () => {
    const openedLate = initialClientState({
      ...WORKING,
      turnElapsedMilliseconds: 61_000,
    })

    expect(openedLate.turnMilliseconds).toBe(61_000)

    const redrawn = linkedToSession(runFor(openedLate, 600), {
      ...WORKING,
      turnElapsedMilliseconds: 61_500,
    })

    expect(redrawn.turnMilliseconds, 'the frame clock ran ahead').toBe(61_600)
  })

  test('a run ending posts its score once; a halt after a hit posts nothing', () => {
    const played = runFor(initialClientState({ ...WORKING, bestScore: 5 }), 2_000)
    const hit = { ...played, game: { ...played.game, status: 'over' as const } }

    const noted = notedRunEnd(played, hit)

    expect(noted.post).toEqual({ kind: 'run-ended', score: Math.floor(played.game.score) })
    expect(noted.state.isLastRunBest).toBe(true)
    expect(noted.state.bestScore).toBe(Math.floor(played.game.score))

    const halted = linkedToSession(noted.state, { ...WORKING, phase: 'COMPLETED' })

    expect(notedRunEnd(noted.state, halted).post, 'counted once').toBeNull()
  })

  test('a score under the best is not a new best', () => {
    const played = runFor(
      initialClientState({ ...WORKING, bestScore: 9_999 }),
      2_000,
    )

    const halted = linkedToSession(played, { ...WORKING, phase: 'COMPLETED' })
    const noted = notedRunEnd(played, halted)

    expect(noted.post?.score).toBe(Math.floor(played.game.score))
    expect(noted.state.isLastRunBest).toBe(false)
    expect(noted.state.bestScore).toBe(9_999)
  })

  test('a failure crashes the run and blinks GAME OVER for 1.5 s', () => {
    const played = runFor(initialClientState(WORKING), 1_000)
    const crashed = linkedToSession(played, { ...WORKING, phase: 'ERROR' })

    expect(crashed.game.status).toBe('crashed')
    expect(isCrashBlinkDark(crashed)).toBe(false)
    expect(isCrashBlinkDark(ticked(crashed, 300, COLUMNS))).toBe(true)

    const settled = runFor(crashed, CRASH_ANIMATION_MILLISECONDS + 500)

    expect(settled.crashMilliseconds).toBe(CRASH_ANIMATION_MILLISECONDS)
    expect(isCrashBlinkDark(settled)).toBe(false)
    expect(isRedrawNeeded(settled, ticked(settled, 60, COLUMNS))).toBe(false)
  })

  test('the next turn starts a fresh run', () => {
    const played = runFor(initialClientState(WORKING), 2_000)
    const completed = linkedToSession(played, { ...WORKING, phase: 'COMPLETED' })
    const next = linkedToSession(completed, { ...WORKING, turnNumber: 2 })

    expect(next.game.status).toBe('running')
    expect(next.game.score).toBe(0)
    expect(next.turnMilliseconds).toBe(0)
  })

  test('a frame that changes nothing on screen asks for no redraw', () => {
    const completed = linkedToSession(initialClientState(WORKING), {
      ...WORKING,
      phase: 'COMPLETED',
    })

    expect(isRedrawNeeded(completed, ticked(completed, 60, COLUMNS))).toBe(false)
  })
})
