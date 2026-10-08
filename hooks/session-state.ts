/**
 * Where Claude's main loop stands, as the runner reads it off the engine's
 * turn and tool events.
 */
export type SessionPhase =
  | 'IDLE'
  | 'WORKING'
  | 'WAITING_FOR_TOOL'
  | 'WAITING_FOR_RESPONSE'
  | 'COMPLETED'
  | 'ERROR'

/**
 * How the last turn ended, when it has: answered, interrupted, or failed.
 */
export type TurnEnding = 'answered' | 'interrupted' | 'failed'

export type SessionState = {
  phase: SessionPhase
  /**
   * Turns of the main loop started this load; the game starts a fresh run
   * on each.
   */
  turnNumber: number
  /**
   * Tool calls of the main loop running right now; tools run in parallel, so
   * a count and not a flag.
   */
  toolsInFlight: number
  /**
   * The clock reading at the current turn's start, null between turns.
   */
  turnStartedAtMs: number | null
  /**
   * The finished turn's length, null while one runs.
   */
  lastTurnDurationMs: number | null
  lastTurnEnding: TurnEnding | null
}

export type SessionEvent =
  | { kind: 'turn-started'; atMs: number }
  | { kind: 'tool-started' }
  | { kind: 'tool-finished' }
  | {
      kind: 'turn-completed'
      reason: 'answer' | 'aborted' | 'refusal' | 'error'
      durationMs: number
    }

export const INITIAL_SESSION_STATE: SessionState = {
  phase: 'IDLE',
  turnNumber: 0,
  toolsInFlight: 0,
  turnStartedAtMs: null,
  lastTurnDurationMs: null,
  lastTurnEnding: null,
}

/**
 * Whether the game should be moving in this phase.
 */
export function isRunningPhase(phase: SessionPhase): boolean {
  return (
    phase === 'WORKING' ||
    phase === 'WAITING_FOR_TOOL' ||
    phase === 'WAITING_FOR_RESPONSE'
  )
}

/**
 * The next state after one event. A tool event outside a turn (a plugin's
 * own call, a command's) leaves the phase alone.
 */
export function nextSessionState(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  switch (event.kind) {
    case 'turn-started':
      return {
        phase: 'WORKING',
        turnNumber: state.turnNumber + 1,
        toolsInFlight: 0,
        turnStartedAtMs: event.atMs,
        lastTurnDurationMs: null,
        lastTurnEnding: null,
      }
    case 'tool-started': {
      if (!isRunningPhase(state.phase)) {
        return state
      }

      return {
        ...state,
        phase: 'WAITING_FOR_TOOL',
        toolsInFlight: state.toolsInFlight + 1,
      }
    }
    case 'tool-finished': {
      if (!isRunningPhase(state.phase)) {
        return state
      }

      const toolsInFlight = Math.max(0, state.toolsInFlight - 1)

      return {
        ...state,
        toolsInFlight,
        phase: toolsInFlight > 0 ? 'WAITING_FOR_TOOL' : 'WAITING_FOR_RESPONSE',
      }
    }
    case 'turn-completed': {
      const ending = turnEndingOf(event.reason)

      return {
        phase: ending === 'failed' ? 'ERROR' : 'COMPLETED',
        turnNumber: state.turnNumber,
        toolsInFlight: 0,
        turnStartedAtMs: null,
        lastTurnDurationMs: event.durationMs,
        lastTurnEnding: ending,
      }
    }
  }
}

function turnEndingOf(
  reason: 'answer' | 'aborted' | 'refusal' | 'error',
): TurnEnding {
  switch (reason) {
    case 'answer':
      return 'answered'
    case 'aborted':
      return 'interrupted'
    case 'refusal':
    case 'error':
      return 'failed'
  }
}

/**
 * The status line the pane shows for a phase.
 */
export function statusTextOf(state: SessionState): string {
  switch (state.phase) {
    case 'IDLE':
      return 'Waiting for Claude...'
    case 'WORKING':
      return 'Claude is working...'
    case 'WAITING_FOR_TOOL':
      return 'Waiting for tool...'
    case 'WAITING_FOR_RESPONSE':
      return 'Claude is thinking...'
    case 'COMPLETED':
      return state.lastTurnEnding === 'interrupted'
        ? '■ Interrupted'
        : '✓ Response completed'
    case 'ERROR':
      return 'Claude encountered an error'
  }
}

/**
 * `mm:ss`, or `hh:mm:ss` past an hour.
 */
export function clockTextOf(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const twoDigits = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`
}
