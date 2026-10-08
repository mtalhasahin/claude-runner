import type { SessionPhase } from '../session-state'
import { isRunningPhase } from '../session-state'
import type { GameState, GameStatus } from './game'
import { newGame, startedRun, stepped } from './game'

/**
 * How fast the course runs while Claude waits on a tool.
 */
export const TOOL_WAIT_SPEED_FACTOR = 0.7

/**
 * What the hooks module hands the game, as plain data: where Claude's main
 * loop stands, which turn it is and how long it has run, the best score so
 * far, and a seed for the course.
 */
export type LinkProps = {
  seed: number
  phase: SessionPhase
  /**
   * Counts the turns started this session; a new value starts a run when
   * none is going.
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
   * going while the runner is down and stops when Claude is done.
   */
  turnMilliseconds: number
  bestScore: number
  /**
   * True when the run that just ended beat the best score it started with.
   */
  isLastRunBest: boolean
  areMilestonesEnabled: boolean
  /**
   * False until the person's first key reaches the game: until then the
   * message line says how to play.
   */
  hasPressedKey: boolean
}

/**
 * What the game reports to the hooks module: a run started, or a run ended
 * with its score. Nothing else crosses.
 */
export type RunPost = { kind: 'run-started' } | { kind: 'run-ended'; score: number }

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
    bestScore: props.bestScore,
    isLastRunBest: false,
    areMilestonesEnabled: props.areMilestonesEnabled,
    hasPressedKey: false,
  }
}

/**
 * Whether a run is being played: going, or paused by the person.
 */
export function isRunActive(game: GameState): boolean {
  return game.status === 'running' || game.status === 'paused'
}

/**
 * The state after the hooks module redraws. Claude starts a run: a new turn
 * starts one when none is going, and leaves one that is going alone. Only
 * the person ends a run (a hit, which they may retry): Claude's answer or
 * failure moves the clock and the status line, not the game.
 *
 * @returns the same object when nothing changed
 */
export function linkedToSession(
  state: ClientState,
  props: LinkProps,
): ClientState {
  const isNewTurn = props.turnNumber !== state.turnNumber
  const bestScore = Math.max(state.bestScore, props.bestScore)

  // While Claude works the frame clock may run ahead of the last redraw;
  // once the turn is over the engine's duration is the final word.
  const turnMilliseconds = isNewTurn
    ? props.turnElapsedMilliseconds
    : isRunningPhase(props.phase)
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

  const isStartingRun =
    isNewTurn && isRunningPhase(props.phase) && !isRunActive(state.game)

  return {
    ...state,
    game: isStartingRun ? startedRun(runSeedOf(props)) : state.game,
    phase: props.phase,
    turnNumber: props.turnNumber,
    turnMilliseconds,
    bestScore,
    areMilestonesEnabled: props.areMilestonesEnabled,
  }
}

/**
 * The state after one frame: the run steps (slower while Claude waits on a
 * tool) and Claude's turn clock moves on while Claude works.
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
  }
}

const IDLE_STATUSES: readonly GameStatus[] = ['waiting', 'over']

/**
 * Notes a run starting or ending between two states.
 *
 * A run starts when the game goes from waiting or a hit to running (Claude's
 * turn, or the person's Space); it ends on a hit. Pausing neither starts nor
 * ends one.
 *
 * @returns the next state, its best score and flag updated on an end, and the
 *   post to send the hooks module, or null when neither happened
 */
export function notedRunChange(
  previous: ClientState,
  next: ClientState,
): { state: ClientState; post: RunPost | null } {
  const isEnding = isRunActive(previous.game) && next.game.status === 'over'

  if (isEnding) {
    const score = Math.floor(next.game.score)

    return {
      state: {
        ...next,
        bestScore: Math.max(next.bestScore, score),
        isLastRunBest: score > next.bestScore,
      },
      post: { kind: 'run-ended', score },
    }
  }

  const isStarting =
    IDLE_STATUSES.includes(previous.game.status) && isRunActive(next.game)

  if (isStarting) {
    return { state: { ...next, isLastRunBest: false }, post: { kind: 'run-started' } }
  }

  return { state: next, post: null }
}

/**
 * Whether a frame changed what is drawn. A frame that only advanced the turn
 * clock within the same second needs no redraw: the game idles at no cost
 * while the runner is down.
 */
export function isRedrawNeeded(
  previous: ClientState,
  next: ClientState,
): boolean {
  const secondOf = (milliseconds: number) => Math.floor(milliseconds / 1000)

  return (
    previous.game !== next.game ||
    previous.phase !== next.phase ||
    previous.bestScore !== next.bestScore ||
    previous.isLastRunBest !== next.isLastRunBest ||
    previous.hasPressedKey !== next.hasPressedKey ||
    secondOf(previous.turnMilliseconds) !== secondOf(next.turnMilliseconds)
  )
}
