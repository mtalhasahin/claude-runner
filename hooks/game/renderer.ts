import { clockTextOf } from '../session-state'
import type { GameState } from './game'
import { RUNNER_COLUMN, RUNNER_HEIGHT, RUNNER_WIDTH } from './game'
import { milestoneTextOf } from './milestones'
import type { ClientState } from './session-link'

/**
 * Rows of open air above the ground: room for a jump's peak (a little over
 * three rows) plus the runner's two rows.
 */
export const PLAYFIELD_ROWS = 6

/**
 * Every row the frame takes: the score line, the playfield, the ground and
 * its texture, and the message line.
 */
export const FRAME_ROWS = 1 + PLAYFIELD_ROWS + 2 + 1

const RUNNER_COLOR = '#d97757'

const GROUND_COLOR = '#6e7681'

/**
 * Which way the legs are, swapped every this many columns run.
 */
const STRIDE_COLUMNS = 1.5

/**
 * A stretch of one row drawn in one style.
 */
export type Run = {
  text: string
  color?: string
  isBold?: boolean
  isDim?: boolean
}

type Cell = {
  character: string
  color?: string
  isBold?: boolean
  isDim?: boolean
}

/**
 * How long a combo or an easter egg stays on the message line.
 */
const EVENT_SHOWN_MILLISECONDS = 1_800

/**
 * How long the dust of a landing stays.
 */
const DUST_MILLISECONDS = 180

/**
 * The frame as rows of styled runs, `columns` cells wide: the score and
 * Claude's turn time, the playfield, the ground, and the message line.
 */
export function frameOf(state: ClientState, columns: number): Run[][] {
  const width = Math.max(1, columns)
  const { game } = state

  return [
    [{ text: hudTextOf(state, width), isBold: true }],
    ...playfieldOf(game, width).map(runsOf),
    [{ text: '─'.repeat(width), color: GROUND_COLOR }],
    [{ text: groundTextureOf(game.distance, width), color: GROUND_COLOR, isDim: true }],
    [messageRunOf(state, width)],
  ]
}

/**
 * `Score 01840  Best 06210  Session 01:24`, spread across the width; the
 * labels shorten when the row is too narrow for them.
 */
function hudTextOf(state: ClientState, width: number): string {
  const score = Math.floor(state.game.score)
  const best = Math.max(state.bestScore, score)
  const fiveDigits = (value: number) => String(value).padStart(5, '0')
  const clock = clockTextOf(state.turnMilliseconds)

  const layouts = [
    [`Score ${fiveDigits(score)}`, `Best ${fiveDigits(best)}`, `Session ${clock}`],
    [`Score ${fiveDigits(score)}`, `Best ${fiveDigits(best)}`, clock],
    [`S ${fiveDigits(score)}`, `B ${fiveDigits(best)}`, clock],
  ]

  const fitting =
    layouts.find(parts => parts.join('  ').length <= width) ??
    layouts[layouts.length - 1]!

  const textLength = fitting.join('').length
  const gapTotal = Math.max(fitting.length - 1, width - textLength)
  const leftGap = Math.floor(gapTotal / 2)
  const rightGap = gapTotal - leftGap

  return `${fitting[0]}${' '.repeat(leftGap)}${fitting[1]}${' '.repeat(rightGap)}${fitting[2]}`.slice(
    0,
    width,
  )
}

function messageRunOf(state: ClientState, width: number): Run {
  const centered = (text: string) => {
    const padding = Math.max(0, Math.floor((width - text.length) / 2))

    return `${' '.repeat(padding)}${text}`.padEnd(width).slice(0, width)
  }

  const { game } = state

  switch (game.status) {
    case 'waiting':
      return { text: centered('Waiting for Claude · SPACE to play'), isDim: true }
    case 'paused':
      return { text: centered('PAUSED  ·  P to resume'), color: '#d4a72c' }
    case 'over':
      return state.isLastRunBest
        ? {
            text: centered(`NEW BEST ${Math.floor(game.score)}  ·  SPACE to retry`),
            color: '#d4a72c',
            isBold: true,
          }
        : { text: centered('GAME OVER  ·  SPACE to retry'), color: '#e5534b', isBold: true }
    case 'running':
      return runningMessageOf(state, centered)
  }
}

/**
 * The running message, most notable first: a combo or easter egg just now,
 * a turn milestone, how to play until the first key, else the count.
 */
function runningMessageOf(
  state: ClientState,
  centered: (text: string) => string,
): Run {
  const { game } = state
  const event = game.lastEvent

  const isEventShowing =
    event !== null &&
    game.runningMilliseconds - event.atMilliseconds < EVENT_SHOWN_MILLISECONDS

  if (isEventShowing && event.kind === 'combo') {
    return {
      text: centered(`COMBO x${event.count}  +${event.bonus}`),
      color: '#d4a72c',
      isBold: true,
    }
  }

  if (isEventShowing && event.kind === 'easter-egg') {
    return {
      text: centered(`${event.name}!  +${event.bonus}`),
      color: '#f2cc60',
      isBold: true,
    }
  }

  const milestone = state.areMilestonesEnabled
    ? milestoneTextOf(state.turnMilliseconds)
    : null

  if (milestone !== null) {
    return { text: centered(milestone), color: '#539bf5' }
  }

  if (!state.hasPressedKey) {
    return {
      text: centered('Click here, then SPACE to jump'),
      color: '#539bf5',
      isBold: true,
    }
  }

  return { text: centered(`Cleared ${game.clearedCount}`), isDim: true }
}

function groundTextureOf(distance: number, width: number): string {
  const offset = Math.floor(distance)
  let texture = ''

  for (let column = 0; column < width; column += 1) {
    const worldColumn = column + offset

    texture += worldColumn % 7 === 0 ? '.' : worldColumn % 11 === 0 ? '`' : ' '
  }

  return texture
}

function playfieldOf(state: GameState, width: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: PLAYFIELD_ROWS }, () =>
    Array.from({ length: width }, () => ({ character: ' ' })),
  )

  const put = (row: number, column: number, cell: Cell) => {
    const isInside =
      row >= 0 && row < PLAYFIELD_ROWS && column >= 0 && column < width

    if (isInside) {
      grid[row]![column] = cell
    }
  }

  const groundRow = PLAYFIELD_ROWS - 1

  for (const obstacle of state.obstacles) {
    const left = Math.round(obstacle.column)
    const labelRow = groundRow - obstacle.kind.height

    for (const [index, character] of [...obstacle.kind.name].entries()) {
      const isEasterEgg = obstacle.kind.bonus > 0

      put(labelRow, left + index, {
        character,
        color: obstacle.kind.color,
        ...(isEasterEgg ? { isBold: true } : { isDim: true }),
      })
    }
  }

  for (const obstacle of state.obstacles) {
    const left = Math.round(obstacle.column)

    for (let level = 0; level < obstacle.kind.height; level += 1) {
      for (let offset = 0; offset < obstacle.kind.width; offset += 1) {
        put(groundRow - level, left + offset, {
          character: '█',
          color: obstacle.kind.color,
        })
      }
    }
  }

  const isDusty =
    state.landedAtMilliseconds !== null &&
    state.runningMilliseconds - state.landedAtMilliseconds < DUST_MILLISECONDS

  if (isDusty) {
    const dust: Cell = { character: '.', color: GROUND_COLOR }

    put(groundRow, RUNNER_COLUMN - 1, dust)
    put(groundRow, RUNNER_COLUMN + RUNNER_WIDTH, dust)
  }

  const bottomRow = groundRow - Math.round(state.body.height)
  const [head, legs] = runnerSpriteOf(state)

  for (let offset = 0; offset < RUNNER_WIDTH; offset += 1) {
    const headCharacter = head[offset] ?? ' '
    const legsCharacter = legs[offset] ?? ' '

    put(bottomRow - (RUNNER_HEIGHT - 1), RUNNER_COLUMN + offset, {
      character: headCharacter,
      color: RUNNER_COLOR,
      isBold: true,
    })

    if (legsCharacter !== ' ') {
      put(bottomRow, RUNNER_COLUMN + offset, {
        character: legsCharacter,
        color: RUNNER_COLOR,
      })
    }
  }

  return grid
}

/**
 * The runner's two rows: a head with one eye, and legs that stride while it
 * runs, tuck in the air and splay on a hit.
 */
function runnerSpriteOf(state: GameState): [string, string] {
  if (state.status === 'over') {
    return ['[x]', '/ \\']
  }

  if (state.body.height > 0) {
    return ['[o]', '/"\\']
  }

  const isStrideA =
    state.status !== 'running' ||
    Math.floor(state.distance / STRIDE_COLUMNS) % 2 === 0

  return ['[o]', isStrideA ? '/ \\' : '| |']
}

/**
 * A row of cells joined into runs of one style.
 */
function runsOf(cells: Cell[]): Run[] {
  const runs: Run[] = []

  for (const cell of cells) {
    const last = runs[runs.length - 1]

    const isSameStyle =
      last !== undefined &&
      last.color === cell.color &&
      last.isBold === cell.isBold &&
      last.isDim === cell.isDim

    if (isSameStyle) {
      last.text += cell.character
    } else {
      runs.push({
        text: cell.character,
        color: cell.color,
        isBold: cell.isBold,
        isDim: cell.isDim,
      })
    }
  }

  return runs
}
