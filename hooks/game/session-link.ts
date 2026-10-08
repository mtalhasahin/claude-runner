import type { SessionPhase } from '../session-state'
import { isRunningPhase } from '../session-state'
import type { GameState, GameStatus } from './game'
import { newGame, startedRun, stepped } from './game'

/**
 * How fast the course runs while Claude waits on a tool.
 */
export const TOOL_WAIT_SPEED_FACTOR = 0.7

/**
 * How long the game-over flash runs when Claude's turn fails.
 */
export const CRASH_ANIMATION_MILLISECONDS = 1_500

/**
 * How often the flash blinks.
 */
export const CRASH_BLINK_MILLISECONDS = 250

/**
 * What the hooks module hands the game, as plain data: where Claude's main
 * loop stands, which turn it is and how long it has run, the best score so
 * far, and a seed for the course.
 */
export type LinkProps = {
  seed: number
  phase: SessionPhase
  /**
   * Counts the turns started this session; a new value is a new run.
   */
  turnNumber: number
  /**
   * The turn's time by the engine's clock at the redraw: the running time
   * while Claude works, the final one once it is done.
   */
  turnElapsedMilliseconds: number
  bestScore: number
  /**
   * Whether long turns get their milestone messages (the `milestones` option).
   */
  areMilestonesEnabled: boolean
}

/**
 * The surface module's state: the run, and the session as the game last
 * heard of it.
 */
export type ClientState = {
  game: GameState
  phase: SessionPhase
  turnNumber: number
  /**
   * Claude's turn time: set from the engine's clock at each redraw and
   * counted on the frame clock between them. The HUD's clock, which keeps
   * going while the runner is down.
   */
  turnMilliseconds: number
  /**
   * Time since Claude's turn failed: how far the game-over flash is.
   */
  crashMilliseconds: number
  bestScore: number
  /**
   * True when the run that just ended beat the best score it started with.
   */
  isLastRunBest: boolean
  areMilestonesEnabled: boolean
}

/**
 * A finished run, as the game reports it to the hooks module: its score
 * alone.
 */
export type RunEndedPost = {
  kind: 'run-ended'
  score: number
}

function runSeedOf(props: LinkProps): number {
  return (props.seed + props.turnNumber * 7_919) | 0
}

/**
 * The first state of an instance: a run already going when the pane opens
 * during a turn, else waiting for one.
 */
export function initialClientState(props: LinkProps): ClientState {
  return {
    game: isRunningPhase(props.phase)
      ? startedRun(runSeedOf(props))
      : newGame(runSeedOf(props)),
    phase: props.phase,
    turnNumber: props.turnNumber,
    turnMilliseconds: props.turnElapsedMilliseconds,
    crashMilliseconds: 0,
    bestScore: props.bestScore,
    isLastRunBest: false,
    areMilestonesEnabled: props.areMilestonesEnabled,
  }
}

/**
 * The state after the hooks module redraws: a new turn starts a fresh run, an
 * answer halts it, a failure crashes it; the turn clock and the best score
 * take the hooks module's word.
 *
 * @returns the same object when nothing changed
 */
export function linkedToSession(
  state: ClientState,
  props: LinkProps,
): ClientState {
  const isNewTurn = props.turnNumber !== state.turnNumber
  const bestScore = Math.max(state.bestScore, props.bestScore)

  if (isNewTurn && isRunningPhase(props.phase)) {
    return {
      game: startedRun(runSeedOf(props)),
      phase: props.phase,
      turnNumber: props.turnNumber,
      turnMilliseconds: props.turnElapsedMilliseconds,
      crashMilliseconds: 0,
      bestScore,
      isLastRunBest: false,
      areMilestonesEnabled: props.areMilestonesEnabled,
    }
  }

  // While Claude works the frame clock may run ahead of the last redraw;
  // once the turn is over the engine's duration is the final word.
  const turnMilliseconds = isRunningPhase(props.phase)
    ? Math.max(state.turnMilliseconds, props.turnElapsedMilliseconds)
    : props.turnElapsedMilliseconds

  const isUnchanged =
    !isNewTurn &&
    props.phase === state.phase &&
    turnMilliseconds === state.turnMilliseconds &&
    bestScore === state.bestScore &&
    props.areMilestonesEnabled === state.areMilestonesEnabled

  if (isUnchanged) {
    return state
  }

  const moved = {
    ...state,
    phase: props.phase,
    turnNumber: props.turnNumber,
    turnMilliseconds,
    bestScore,
    areMilestonesEnabled: props.areMilestonesEnabled,
  }

  if (props.phase === state.phase) {
    return moved
  }

  switch (props.phase) {
    case 'IDLE':
      return { ...moved, game: { ...state.game, status: 'waiting' } }
    case 'WORKING':
    case 'WAITING_FOR_TOOL':
    case 'WAITING_FOR_RESPONSE':
      return moved
    case 'COMPLETED':
      return { ...moved, game: { ...state.game, status: 'halted' } }
    case 'ERROR':
      return {
        ...moved,
        game: { ...state.game, status: 'crashed' },
        crashMilliseconds: 0,
      }
  }
}

/**
 * The state after one frame: the run steps (slower while Claude waits on a
 * tool), Claude's turn clock and the crash flash move on.
 */
export function ticked(
  state: ClientState,
  milliseconds: number,
  playfieldColumns: number,
): ClientState {
  const speedFactor =
    state.phase === 'WAITING_FOR_TOOL' ? TOOL_WAIT_SPEED_FACTOR : 1

  return {
    ...state,
    game: stepped(state.game, milliseconds, playfieldColumns, speedFactor),
    turnMilliseconds: isRunningPhase(state.phase)
      ? state.turnMilliseconds + milliseconds
      : state.turnMilliseconds,
    crashMilliseconds:
      state.game.status === 'crashed'
        ? Math.min(
            CRASH_ANIMATION_MILLISECONDS,
            state.crashMilliseconds + milliseconds,
          )
        : state.crashMilliseconds,
  }
}

const PLAYING_STATUSES: readonly GameStatus[] = ['running', 'paused']

const ENDED_STATUSES: readonly GameStatus[] = ['over', 'halted', 'crashed']

/**
 * Notes a run that ended between two states: a hit, Claude's answer or
 * Claude's failure taking a run that was being played. A run already over
 * that Claude then halts is not counted again.
 *
 * @returns the next state, its best score and flag updated, and the post to
 *   send the hooks module, or null when no run ended
 */
export function notedRunEnd(
  previous: ClientState,
  next: ClientState,
): { state: ClientState; post: RunEndedPost | null } {
  const isEnding =
    PLAYING_STATUSES.includes(previous.game.status) &&
    ENDED_STATUSES.includes(next.game.status)

  if (!isEnding) {
    const isNewRun =
      next.game.status === 'running' && previous.game.status !== 'running' &&
      previous.game.status !== 'paused'

    return {
      state: isNewRun && next.isLastRunBest ? { ...next, isLastRunBest: false } : next,
      post: null,
    }
  }

  const score = Math.floor(next.game.score)
  const isBest = score > next.bestScore

  return {
    state: {
      ...next,
      bestScore: Math.max(next.bestScore, score),
      isLastRunBest: isBest,
    },
    post: { kind: 'run-ended', score },
  }
}

/**
 * Whether a frame changed what is drawn. A frame that only advanced the turn
 * clock within the same second, or a finished flash, needs no redraw: the
 * game idles at no cost while the runner is down or Claude is done.
 */
export function isRedrawNeeded(
  previous: ClientState,
  next: ClientState,
): boolean {
  const secondOf = (milliseconds: number) => Math.floor(milliseconds / 1000)
  const blinkOf = (milliseconds: number) =>
    Math.floor(milliseconds / CRASH_BLINK_MILLISECONDS)

  return (
    previous.game !== next.game ||
    previous.phase !== next.phase ||
    previous.bestScore !== next.bestScore ||
    previous.isLastRunBest !== next.isLastRunBest ||
    secondOf(previous.turnMilliseconds) !== secondOf(next.turnMilliseconds) ||
    blinkOf(previous.crashMilliseconds) !== blinkOf(next.crashMilliseconds)
  )
}

/**
 * Whether the flash is in its dark half: the message hidden.
 */
export function isCrashBlinkDark(state: ClientState): boolean {
  return (
    state.crashMilliseconds < CRASH_ANIMATION_MILLISECONDS &&
    Math.floor(state.crashMilliseconds / CRASH_BLINK_MILLISECONDS) % 2 === 1
  )
}
