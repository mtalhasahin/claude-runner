import { describe, expect, test } from 'claude-code/testing'

import { pressedJump, pressedPause } from '../hooks/game/game'
import type { ClientState, LinkProps } from '../hooks/game/session-link'
import {
  initialClientState,
  isRedrawNeeded,
  linkedToSession,
  notedRunChange,
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

function hit(state: ClientState): ClientState {
  return { ...state, game: { ...state.game, status: 'over' } }
}

describe('session-link', () => {
  test('idle, the game waits; a turn starts a run', () => {
    const idle = initialClientState(IDLE)

    expect(idle.game.status).toBe('waiting')
    expect(runFor(idle, 1_000).game).toBe(idle.game)
    expect(linkedToSession(idle, WORKING).game.status).toBe('running')
  })

  test('the person can start a run with Space, Claude or not', () => {
    const idle = initialClientState(IDLE)

    expect(pressedJump(idle.game).status).toBe('running')
  })

  test('a pane opened mid-turn starts running at once', () => {
    expect(initialClientState(WORKING).game.status).toBe('running')
  })

  test('the same props again change nothing', () => {
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

  test("Claude's answer does not stop the run; the person does", () => {
    const played = runFor(initialClientState(WORKING), 2_000)
    const answered = linkedToSession(played, {
      ...WORKING,
      phase: 'COMPLETED',
      turnElapsedMilliseconds: 2_000,
    })

    expect(answered.game).toBe(played.game)

    const keptPlaying = runFor(answered, 3_000)

    expect(keptPlaying.game.score, 'still scoring').toBeGreaterThan(played.game.score)
    expect(keptPlaying.turnMilliseconds, 'the turn clock stopped').toBe(2_000)
  })

  test("Claude's failure does not stop the run either", () => {
    const played = runFor(initialClientState(WORKING), 1_000)
    const failed = linkedToSession(played, { ...WORKING, phase: 'ERROR' })

    expect(failed.game).toBe(played.game)
    expect(failed.game.status).toBe('running')
  })

  test('a new turn keeps a run that is going, paused or not', () => {
    const played = runFor(initialClientState(WORKING), 2_000)
    const answered = linkedToSession(played, { ...WORKING, phase: 'COMPLETED' })
    const nextTurn = linkedToSession(answered, { ...WORKING, turnNumber: 2 })

    expect(nextTurn.game).toBe(played.game)

    const paused = { ...answered, game: pressedPause(answered.game) }

    expect(linkedToSession(paused, { ...WORKING, turnNumber: 2 }).game.status).toBe(
      'paused',
    )
  })

  test('a new turn starts a fresh run after a hit', () => {
    const played = runFor(initialClientState(WORKING), 2_000)
    const answered = linkedToSession(hit(played), { ...WORKING, phase: 'COMPLETED' })
    const nextTurn = linkedToSession(answered, { ...WORKING, turnNumber: 2 })

    expect(nextTurn.game.status).toBe('running')
    expect(nextTurn.game.score).toBe(0)
    expect(nextTurn.turnMilliseconds).toBe(0)
  })

  test('the turn clock keeps going after a hit, stops at the answer', () => {
    const afterHit = runFor(hit(initialClientState(WORKING)), 3_000)

    expect(afterHit.turnMilliseconds).toBeGreaterThanOrEqual(3_000)

    const answered = linkedToSession(afterHit, {
      ...WORKING,
      phase: 'COMPLETED',
      turnElapsedMilliseconds: 3_250,
    })

    expect(answered.turnMilliseconds, "the engine's duration").toBe(3_250)
    expect(runFor(answered, 3_000).turnMilliseconds).toBe(3_250)
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

  test('a hit posts the score once, and a best beats the old one', () => {
    const played = runFor(initialClientState({ ...WORKING, bestScore: 5 }), 2_000)
    const noted = notedRunChange(played, hit(played))
    const score = Math.floor(played.game.score)

    expect(noted.post).toEqual({ kind: 'run-ended', score })
    expect(noted.state.isLastRunBest).toBe(true)
    expect(noted.state.bestScore).toBe(score)

    const answered = linkedToSession(noted.state, { ...WORKING, phase: 'COMPLETED' })

    expect(notedRunChange(noted.state, answered).post, 'counted once').toBeNull()
  })

  test('a score under the best is not a new best', () => {
    const played = runFor(initialClientState({ ...WORKING, bestScore: 9_999 }), 2_000)
    const noted = notedRunChange(played, hit(played))

    expect(noted.state.isLastRunBest).toBe(false)
    expect(noted.state.bestScore).toBe(9_999)
  })

  test('a run starting posts it; a pause neither starts nor ends one', () => {
    const idle = initialClientState(IDLE)
    const started = { ...idle, game: pressedJump(idle.game) }

    expect(notedRunChange(idle, started).post).toEqual({ kind: 'run-started' })

    const paused = { ...started, game: pressedPause(started.game) }

    expect(notedRunChange(started, paused).post).toBeNull()
    expect(notedRunChange(paused, started).post).toBeNull()

    const over = hit(runFor(started, 500))
    const retried = { ...over, game: pressedJump(over.game) }

    expect(notedRunChange(over, retried).post).toEqual({ kind: 'run-started' })
  })

  test('a frame that changes nothing on screen asks for no redraw', () => {
    const down = linkedToSession(hit(initialClientState(WORKING)), {
      ...WORKING,
      phase: 'COMPLETED',
    })

    expect(isRedrawNeeded(down, ticked(down, 60, COLUMNS))).toBe(false)
  })
})
