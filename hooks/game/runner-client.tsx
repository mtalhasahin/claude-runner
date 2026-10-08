import type { ClientKeyEvent, ClientModule, ClientSurface } from 'claude-code'

import { pressedJump, pressedPause } from './game'
import type { Run } from './renderer'
import { FRAME_ROWS, frameOf } from './renderer'
import type { ClientState, LinkProps } from './session-link'
import {
  initialClientState,
  isRedrawNeeded,
  isRunActive,
  linkedToSession,
  notedRunChange,
  ticked,
} from './session-link'

/**
 * The frame clock: about 16 frames a second, smooth enough for cells that
 * move one column at a time and light on the CPU.
 */
export const FRAME_MILLISECONDS = 60

/**
 * Columns drawn before the surface has laid the region out.
 */
const FALLBACK_COLUMNS = 36

export type RunnerClientProps = LinkProps

/**
 * The instance's state as the frame clock, the key listener and the drawing
 * share it. The surface's own `state` is what triggers a redraw; this holds
 * every frame's state, redrawn or not, so a press between two redraws acts
 * on the latest run. One `Client` per plugin, so one holder.
 */
let holder: { state: ClientState } | null = null

function isJumpKey(keyEvent: ClientKeyEvent): boolean {
  return keyEvent.key === ' ' || keyEvent.key === 'space' || keyEvent.key === 'up'
}

function isPauseKey(keyEvent: ClientKeyEvent): boolean {
  return keyEvent.key === 'p' || keyEvent.key === 'P'
}

function columnsOf(surface: ClientSurface<ClientState>): number {
  return surface.columns > 0 ? surface.columns : FALLBACK_COLUMNS
}

/**
 * The next state with a run's start or end noted, and posted to the hooks
 * module, which keeps the statistics and knows not to close the pane under a
 * run. Nothing but that and a finished run's score crosses.
 */
function advanced(
  surface: ClientSurface<ClientState>,
  previous: ClientState,
  next: ClientState,
): ClientState {
  const noted = notedRunChange(previous, next)

  if (noted.post !== null) {
    surface.post(noted.post)
  }

  return noted.state
}

/**
 * Starts the frame clock and the key listener, once, on the instance's first
 * call.
 */
function started(
  props: RunnerClientProps,
  surface: ClientSurface<ClientState>,
): { state: ClientState } {
  const instance = { state: initialClientState(props) }

  const commit = (next: ClientState) => {
    const previous = instance.state

    instance.state = advanced(surface, previous, next)

    if (isRedrawNeeded(previous, instance.state)) {
      surface.setState(instance.state)
    }
  }

  surface.every(FRAME_MILLISECONDS, () => {
    commit(ticked(instance.state, FRAME_MILLISECONDS, columnsOf(surface)))
  })

  surface.onKey(keyEvent => {
    const { game } = instance.state

    if (isJumpKey(keyEvent)) {
      commit({ ...instance.state, game: pressedJump(game), hasPressedKey: true })
    } else if (isPauseKey(keyEvent)) {
      commit({ ...instance.state, game: pressedPause(game), hasPressedKey: true })
    }
  })

  surface.setState(instance.state)

  if (isRunActive(instance.state.game)) {
    surface.post({ kind: 'run-started' })
  }

  return instance
}

/**
 * Draws the run: the score line, the playfield, the ground and the message
 * line. A call with new props (Claude's phase or turn changed) moves the run
 * along with the session first.
 */
const RunnerClient: ClientModule<RunnerClientProps, ClientState> = (
  props,
  surface,
) => {
  if (surface.state === undefined || holder === null) {
    holder = started(props, surface)
  }

  const linked = linkedToSession(holder.state, props)

  if (linked !== holder.state) {
    holder.state = advanced(surface, holder.state, linked)
    surface.setState(holder.state)
  }

  const { Box, Text } = surface.elements
  const rows = frameOf(holder.state, columnsOf(surface))

  const textOf = (run: Run) => (
    <Text
      {...(run.color === undefined ? {} : { color: run.color })}
      {...(run.isBold === true ? { bold: true } : {})}
      {...(run.isDim === true ? { dimColor: true } : {})}
    >
      {run.text}
    </Text>
  )

  return (
    <Box flexDirection="column" height={FRAME_ROWS}>
      {rows.map(runs => (
        <Box flexDirection="row">{runs.map(textOf)}</Box>
      ))}
    </Box>
  )
}

export default RunnerClient
