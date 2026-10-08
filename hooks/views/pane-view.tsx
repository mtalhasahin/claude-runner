import type { Elements, RenderElement } from 'claude-code'

import { FRAME_ROWS } from '../game/renderer'
import type { RunnerClientProps } from '../game/runner-client'
import type { SessionState } from '../session-state'
import { clockTextOf, statusTextOf } from '../session-state'
import type { Statistics } from '../storage/statistics'

/**
 * The elements the pane draws with; `Client` only where the surface has one
 * (the terminal and the desktop), the game left out elsewhere.
 */
type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text'> &
  Partial<Pick<Elements['terminal'], 'Client'>>

/**
 * The `Client` element's key: its address in the drawing and in tests.
 */
export const GAME_KEY = 'game'

/**
 * The controls, always under the title: keys reach the game only once it is
 * clicked, so that comes first until the pane holds the keyboard; then how
 * to hand the keys back. Both carry the keys themselves.
 */
export function controlsTextOf(isPaneFocused: boolean): string {
  return isPaneFocused
    ? 'SPACE/↑ jump · P pause · Esc back'
    : 'Click game · SPACE/↑ jump · P pause'
}

/**
 * The pane's body: the title and the controls, the game where the surface
 * can run it, the session's status line and, once a turn has finished, how
 * long it took.
 */
export function paneView(
  elements: PaneElements,
  state: SessionState,
  statistics: Statistics,
  game: RunnerClientProps,
  isPaneFocused: boolean,
): RenderElement {
  const { Box, Text, Client } = elements

  const statusColor =
    state.phase === 'ERROR'
      ? 'red'
      : state.phase === 'COMPLETED'
        ? 'green'
        : undefined

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="#d97757">
        CLAUDE RUNNER
      </Text>
      {Client === undefined ? null : (
        <Text color="#539bf5">{controlsTextOf(isPaneFocused)}</Text>
      )}
      {Client === undefined ? null : (
        <Client
          key={GAME_KEY}
          module="../game/runner-client.tsx"
          props={game}
          width="100%"
          height={FRAME_ROWS}
        />
      )}
      <Text
        {...(statusColor === undefined ? {} : { color: statusColor })}
        dimColor={state.phase === 'IDLE'}
      >
        {statusTextOf(state)}
      </Text>
      {state.lastTurnDurationMs === null ? null : (
        <Text dimColor>
          {`Session time: ${clockTextOf(state.lastTurnDurationMs)}`}
        </Text>
      )}
      {state.phase === 'IDLE' && statistics.gamesPlayed > 0 ? (
        <Text dimColor>
          {`Best ${statistics.bestScore} · ${statistics.gamesPlayed} games · /runner stats`}
        </Text>
      ) : null}
    </Box>
  )
}
