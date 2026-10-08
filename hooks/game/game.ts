import type { Obstacle } from './obstacle'
import { spawnedObstacle } from './obstacle'
import type { Body } from './physics'
import {
  JUMP_BUFFER_MILLISECONDS,
  STANDING,
  fallen,
  isOnGround,
  jumped,
} from './physics'
import { difficultyOf, pointsFor, speedOf } from './score'

/**
 * `waiting` for a run to start, `running`, `paused` by the person, `over`
 * after a hit.
 *
 * Claude's turn or the person's Space starts a run; only the person ends
 * one (session-link.ts).
 */
export type GameStatus = 'waiting' | 'running' | 'paused' | 'over'

/**
 * One run, as plain data: what the surface module keeps as its local state
 * and steps on every frame.
 */
export type GameState = {
  status: GameStatus
  /**
   * Time spent running (pauses and the ready screen excluded).
   */
  runningMilliseconds: number
  /**
   * Fractional while it accrues; drawn floored.
   */
  score: number
  body: Body
  obstacles: readonly Obstacle[]
  /**
   * Columns still to scroll before the next obstacle appears.
   */
  columnsToNextSpawn: number
  /**
   * What is left of a jump pressed in the air, fired on landing.
   */
  jumpBufferMilliseconds: number
  /**
   * Obstacles passed this run.
   */
  clearedCount: number
  /**
   * Columns scrolled this run: what moves the ground's texture.
   */
  distance: number
  /**
   * The latest combo or easter egg, shown for a moment after it happens.
   */
  lastEvent: GameEvent | null
  /**
   * When the runner last touched down, for the dust it kicks up.
   */
  landedAtMilliseconds: number | null
  seed: number
}

/**
 * A moment worth a message: a streak of obstacles cleared without a hit, or
 * a rare obstacle cleared. Both add points.
 */
export type GameEvent =
  | { kind: 'combo'; count: number; bonus: number; atMilliseconds: number }
  | { kind: 'easter-egg'; name: string; bonus: number; atMilliseconds: number }

/**
 * Points a combo adds per obstacle in the streak, and the most one combo
 * adds: from x25 on every combo is worth the same, so a long turn's streak
 * cannot outscore the run itself.
 */
export const COMBO_POINTS_PER_OBSTACLE = 10

export const LARGEST_COMBO_BONUS = 250

export function comboBonusOf(count: number): number {
  return Math.min(LARGEST_COMBO_BONUS, count * COMBO_POINTS_PER_OBSTACLE)
}

/**
 * The streaks that count as combos: 5, 10, then every 25.
 */
export function isComboCount(count: number): boolean {
  return count === 5 || count === 10 || (count >= 25 && count % 25 === 0)
}

/**
 * The runner's left edge, in playfield columns, and its size: three cells
 * across, two rows tall.
 */
export const RUNNER_COLUMN = 3

export const RUNNER_WIDTH = 3

export const RUNNER_HEIGHT = 2

/**
 * The part of the runner that collides: the middle two of its three columns,
 * so a graze on the edge glyph is forgiven.
 */
const HITBOX_LEFT = RUNNER_COLUMN + 0.5

const HITBOX_RIGHT = RUNNER_COLUMN + RUNNER_WIDTH - 0.5

/**
 * A frame longer than this is stepped in pieces, so a stalled frame clock
 * cannot carry an obstacle through the runner unseen.
 */
const LONGEST_STEP_MILLISECONDS = 50

const FIRST_SPAWN_COLUMNS = 6

export function newGame(seed: number): GameState {
  return {
    status: 'waiting',
    runningMilliseconds: 0,
    score: 0,
    body: STANDING,
    obstacles: [],
    columnsToNextSpawn: FIRST_SPAWN_COLUMNS,
    jumpBufferMilliseconds: 0,
    clearedCount: 0,
    distance: 0,
    lastEvent: null,
    landedAtMilliseconds: null,
    seed,
  }
}

/**
 * A fresh run, already moving: what a turn's start hands the game.
 */
export function startedRun(seed: number): GameState {
  return { ...newGame(seed), status: 'running' }
}

/**
 * Space or Up: starts a run, jumps while running (or keeps the press for the
 * landing), resumes a pause, restarts after a hit.
 */
export function pressedJump(state: GameState): GameState {
  switch (state.status) {
    case 'waiting':
      return startedRun(state.seed)
    case 'paused':
      return { ...state, status: 'running' }
    case 'over':
      return startedRun(state.seed)
    case 'running':
      return isOnGround(state.body)
        ? { ...state, body: jumped(state.body), jumpBufferMilliseconds: 0 }
        : { ...state, jumpBufferMilliseconds: JUMP_BUFFER_MILLISECONDS }
  }
}

/**
 * P: pauses a run, or resumes it.
 */
export function pressedPause(state: GameState): GameState {
  switch (state.status) {
    case 'running':
      return { ...state, status: 'paused' }
    case 'paused':
      return { ...state, status: 'running' }
    case 'waiting':
    case 'over':
      return state
  }
}

/**
 * The run after `milliseconds` of frame time on a playfield `columns` wide.
 * Anything but a running game is returned as it was.
 *
 * @param speedFactor scales how fast the course scrolls and scores (below 1
 *   while Claude waits on a tool); jumps keep their timing
 */
export function stepped(
  state: GameState,
  milliseconds: number,
  playfieldColumns: number,
  speedFactor = 1,
): GameState {
  let current = state
  let remaining = milliseconds

  while (remaining > 0 && current.status === 'running') {
    const piece = Math.min(remaining, LONGEST_STEP_MILLISECONDS)

    current = steppedOnce(current, piece, playfieldColumns, speedFactor)
    remaining -= piece
  }

  return current
}

function steppedOnce(
  state: GameState,
  milliseconds: number,
  playfieldColumns: number,
  speedFactor: number,
): GameState {
  const runningMilliseconds = state.runningMilliseconds + milliseconds
  const courseSpeed = speedOf(runningMilliseconds)
  const speed = courseSpeed * speedFactor
  const scrolledColumns = (speed * milliseconds) / 1000

  const isBufferedJump =
    state.jumpBufferMilliseconds > 0 && isOnGround(state.body)

  const body = fallen(
    isBufferedJump ? jumped(state.body) : state.body,
    milliseconds,
  )

  const jumpBufferMilliseconds = isBufferedJump
    ? 0
    : Math.max(0, state.jumpBufferMilliseconds - milliseconds)

  let clearedCount = state.clearedCount
  let bonus = 0
  let lastEvent = state.lastEvent

  const moved = state.obstacles
    .map(obstacle => ({ ...obstacle, column: obstacle.column - scrolledColumns }))
    .filter(obstacle => obstacle.column + obstacle.kind.width > 0)
    .map(obstacle => {
      const isNowCleared =
        !obstacle.isCleared &&
        obstacle.column + obstacle.kind.width <= HITBOX_LEFT

      if (!isNowCleared) {
        return obstacle
      }

      clearedCount += 1

      if (isComboCount(clearedCount)) {
        const comboBonus = comboBonusOf(clearedCount)

        bonus += comboBonus
        lastEvent = {
          kind: 'combo',
          count: clearedCount,
          bonus: comboBonus,
          atMilliseconds: runningMilliseconds,
        }
      }

      if (obstacle.kind.bonus > 0) {
        bonus += obstacle.kind.bonus
        lastEvent = {
          kind: 'easter-egg',
          name: obstacle.kind.name,
          bonus: obstacle.kind.bonus,
          atMilliseconds: runningMilliseconds,
        }
      }

      return { ...obstacle, isCleared: true }
    })

  const hasLanded = state.body.height > 0 && body.height === 0

  let columnsToNextSpawn = state.columnsToNextSpawn - scrolledColumns
  let seed = state.seed
  const obstacles = [...moved]

  if (columnsToNextSpawn <= 0) {
    const spawned = spawnedObstacle(
      seed,
      playfieldColumns,
      courseSpeed,
      difficultyOf(runningMilliseconds),
    )

    obstacles.push({
      ...spawned.obstacle,
      column: spawned.obstacle.column + columnsToNextSpawn,
    })
    columnsToNextSpawn += spawned.obstacle.kind.width + spawned.gapAfter
    seed = spawned.seed
  }

  const isHit = obstacles.some(obstacle => isHitting(obstacle, body))

  return {
    status: isHit ? 'over' : 'running',
    runningMilliseconds,
    score: state.score + pointsFor(milliseconds, speed) + bonus,
    body,
    obstacles,
    columnsToNextSpawn,
    jumpBufferMilliseconds,
    clearedCount,
    distance: state.distance + scrolledColumns,
    lastEvent,
    landedAtMilliseconds: hasLanded
      ? runningMilliseconds
      : state.landedAtMilliseconds,
    seed,
  }
}

function isHitting(obstacle: Obstacle, body: Body): boolean {
  const left = obstacle.column
  const right = obstacle.column + obstacle.kind.width
  const isOverlapping = left < HITBOX_RIGHT && right > HITBOX_LEFT

  // Judged on the row the runner is drawn in, so a runner that looks clear of
  // a block is clear of it.
  return isOverlapping && Math.round(body.height) < obstacle.kind.height
}
