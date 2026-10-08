import type { EngineInterface, On, PluginOptions, Timer } from 'claude-code'

import {
  CLOSE_AFTER_ANSWER_MILLISECONDS,
  COMMAND_DESCRIPTION,
  COMMAND_NAME,
  HOW_TO_PLAY_TEXT,
  NO_SURFACE_TEXT,
  OPENED_TEXT,
  PANE_COLUMNS,
  PANE_ID,
  PANE_ROWS,
  PANE_TITLE,
  STORE_KEYS,
} from './names'
import type { SessionEvent, SessionState } from './session-state'
import { INITIAL_SESSION_STATE, nextSessionState } from './session-state'
import type { Statistics } from './storage/statistics'
import {
  STATISTICS_STORE_KEY,
  isRunStartedPost,
  runEndedOf,
  statisticsOf,
  statisticsTextOf,
  withRunEnded,
  withTurnCompleted,
} from './storage/statistics'
import { GAME_KEY, paneView } from './views/pane-view'

/**
 * What the module keeps between events for one load: the session state the
 * pane draws and whether the pane is up.
 */
type Runner = {
  readonly isAutoOpenEnabled: boolean
  readonly areMilestonesEnabled: boolean
  readonly isCloseOnCompleteEnabled: boolean
  sessionState: SessionState
  isPaneOpen: boolean
  /**
   * True while the pane up is one the mod opened at a turn's start: the one
   * it may close again after the answer. A pane the person opened is theirs.
   */
  isPaneOpenedByTurn: boolean
  /**
   * True while the person has a run going or paused: the pane does not close
   * under it, whatever Claude does.
   */
  isRunActive: boolean
  closeTimer: Timer | null
  /**
   * Seeds the game's obstacle sequence; taken from the clock at the session's
   * start so each session plays a different course.
   */
  gameSeed: number
  /**
   * The stored statistics, read once on first use and kept here after: the
   * module's copy is the one every change applies to, so two changes in
   * flight cannot overwrite each other.
   */
  statistics: Statistics | null
  statisticsLoading: Promise<Statistics> | null
}

function apply($: EngineInterface, runner: Runner, event: SessionEvent): void {
  runner.sessionState = nextSessionState(runner.sessionState, event)

  // Unconditional: a pane the person opened and the module has not heard of
  // (a reload) still follows the session. Nothing is drawn when none is open.
  $.ui.invalidate('ui.render')
}

/**
 * Opens the pane, or closes it again when the surface would leave it waiting
 * undrawn (a terminal too narrow for an unasked pane, or a surface that draws
 * no panes): it would otherwise appear later, at a moment nobody asked for.
 *
 * A session with no surface at all (a `-p` run; seemingly the desktop app's
 * sessions too, where "opened" drew nothing) gets nothing opened: the engine
 * calls the pane placed there, with nothing to draw it.
 *
 * @returns null once it is drawn, else the reason it is not
 */
async function openPane(
  $: EngineInterface,
  runner: Runner,
): Promise<string | null> {
  const surfaces = await $.session.surfaces()

  if (surfaces.length === 0) {
    return NO_SURFACE_TEXT
  }

  const opened = await $.ui.open({
    id: PANE_ID,
    title: PANE_TITLE,
    rows: PANE_ROWS,
    columns: PANE_COLUMNS,
  })

  if (!opened.isPlaced) {
    await $.ui.close({ id: PANE_ID })

    return opened.reason
  }

  runner.isPaneOpen = true

  return null
}

async function loadedStatistics(
  $: EngineInterface,
  runner: Runner,
): Promise<Statistics> {
  runner.statisticsLoading ??= $.store
    .get(STATISTICS_STORE_KEY)
    .then(stored => statisticsOf(stored))
    .catch(() => statisticsOf(undefined))

  const loaded = await runner.statisticsLoading

  runner.statistics ??= loaded

  return runner.statistics
}

/**
 * Applies a change to the statistics and stores them. The change runs on the
 * module's copy right after loading, with no await between reading and
 * writing it.
 */
async function changeStatistics(
  $: EngineInterface,
  runner: Runner,
  change: (statistics: Statistics) => Statistics,
): Promise<void> {
  await loadedStatistics($, runner)

  const changed = change(runner.statistics ?? statisticsOf(undefined))

  runner.statistics = changed
  $.ui.invalidate('ui.render')
  await $.store.set(STATISTICS_STORE_KEY, changed)
}

/**
 * The turn's time for the game's clock: running while Claude works, the
 * engine's final duration once it is done.
 */
async function turnElapsedOf(
  $: EngineInterface,
  runner: Runner,
): Promise<number> {
  const { turnStartedAtMs, lastTurnDurationMs } = runner.sessionState

  if (turnStartedAtMs !== null) {
    return Math.max(0, (await $.clock.now()) - turnStartedAtMs)
  }

  return lastTurnDurationMs ?? 0
}

async function openOnTurnStart(
  $: EngineInterface,
  runner: Runner,
): Promise<void> {
  if (!runner.isAutoOpenEnabled || runner.isPaneOpen) {
    return
  }

  const isClosedByPerson =
    (await $.store.get(STORE_KEYS.isClosedByPerson)) === true

  if (!isClosedByPerson) {
    runner.isPaneOpenedByTurn = (await openPane($, runner)) === null
  }
}

function cancelClose(runner: Runner): void {
  runner.closeTimer?.cancel()
  runner.closeTimer = null
}

/**
 * Once Claude has answered and no run is being played, closes the pane the
 * turn opened, a few seconds on so the final score shows; the next turn
 * opens it again. Asked again when either of the two happens. An error
 * leaves it up.
 */
function scheduleCloseAfterAnswer($: EngineInterface, runner: Runner): void {
  cancelClose(runner)

  const isClosing =
    runner.isCloseOnCompleteEnabled &&
    runner.isPaneOpen &&
    runner.isPaneOpenedByTurn &&
    !runner.isRunActive &&
    runner.sessionState.phase === 'COMPLETED'

  if (isClosing) {
    runner.closeTimer = $.clock.after(CLOSE_AFTER_ANSWER_MILLISECONDS, () => {
      void closeAfterAnswer($, runner).catch(() => undefined)
    })
  }
}

async function closeAfterAnswer(
  $: EngineInterface,
  runner: Runner,
): Promise<void> {
  runner.closeTimer = null

  const isStillDone =
    runner.isPaneOpen &&
    runner.isPaneOpenedByTurn &&
    !runner.isRunActive &&
    runner.sessionState.phase === 'COMPLETED'

  if (isStillDone) {
    await $.ui.close({ id: PANE_ID })
    // Set here as well as in the ui.close hook: the hook may not hear a close
    // this module raised itself.
    runner.isPaneOpen = false
    runner.isPaneOpenedByTurn = false
    runner.isRunActive = false
  }
}

/**
 * Registers Claude Runner: the /runner command, the pane's drawing, and the
 * main loop's turn and tool events that move the session state the pane
 * shows.
 *
 * @param on the engine's registrar
 * @param options `autoOpen`: open the pane on its own when a turn starts;
 *   `closeOnComplete`: close that pane again a few seconds after the
 *   answer; `milestones`: the game's messages as a turn runs long
 */
export function register(on: On, options: PluginOptions): void {
  const runner: Runner = {
    isAutoOpenEnabled: options.autoOpen !== false,
    areMilestonesEnabled: options.milestones !== false,
    isCloseOnCompleteEnabled: options.closeOnComplete !== false,
    sessionState: INITIAL_SESSION_STATE,
    isPaneOpen: false,
    isPaneOpenedByTurn: false,
    isRunActive: false,
    closeTimer: null,
    gameSeed: 1,
    statistics: null,
    statisticsLoading: null,
  }

  on('session.start', async ($, event, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description: COMMAND_DESCRIPTION,
      argumentHint: '[stats|help]',
      immediate: true,
    })

    runner.isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
    runner.gameSeed = Math.floor(await $.clock.now()) | 0

    return next(event)
  })

  on('turn.start', async ($, event, next) => {
    cancelClose(runner)
    apply($, runner, { kind: 'turn-started', atMs: await $.clock.now() })
    void openOnTurnStart($, runner).catch(() => undefined)

    return next(event)
  })

  on('tool.call', async ($, event, next) => {
    const isMainLoop = event.agentId === undefined

    if (!isMainLoop) {
      return next(event)
    }

    apply($, runner, { kind: 'tool-started' })

    try {
      return await next(event)
    } finally {
      apply($, runner, { kind: 'tool-finished' })
    }
  })

  on('turn.complete', async ($, event, next) => {
    if (event.agentId === undefined) {
      apply($, runner, {
        kind: 'turn-completed',
        reason: event.reason,
        durationMs: event.durationMs,
      })
      scheduleCloseAfterAnswer($, runner)

      const { durationMs } = event

      void changeStatistics($, runner, statistics =>
        withTurnCompleted(statistics, durationMs),
      ).catch(() => undefined)
    }

    return next(event)
  })

  on('ui.message', async ($, event, next) => {
    const isOwnGame = event.requestId === PANE_ID && event.element === GAME_KEY

    if (!isOwnGame) {
      return next(event)
    }

    if (isRunStartedPost(event.data)) {
      runner.isRunActive = true
      cancelClose(runner)
    }

    const runEnded = runEndedOf(event.data)

    if (runEnded !== null) {
      runner.isRunActive = false
      scheduleCloseAfterAnswer($, runner)
      await changeStatistics($, runner, statistics =>
        withRunEnded(statistics, runEnded.score),
      ).catch(() => undefined)
    }

    return next(event)
  })

  on('ui.render', { component: 'Pane' }, async ($, event, next) => {
    if (event.requestId !== PANE_ID) {
      return next(event)
    }

    const elements = await $.ui.resolve(event)
    const { Box, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined

    const statistics = await loadedStatistics($, runner)

    return paneView(
      { Box, Text, Client },
      runner.sessionState,
      statistics,
      {
        seed: runner.gameSeed,
        phase: runner.sessionState.phase,
        turnNumber: runner.sessionState.turnNumber,
        turnElapsedMilliseconds: await turnElapsedOf($, runner),
        bestScore: statistics.bestScore,
        areMilestonesEnabled: runner.areMilestonesEnabled,
      },
      event.props.isFocused,
    )
  })

  on('command.run', { command: COMMAND_NAME }, async ($, event, next) => {
    const argument = event.args.trim().toLowerCase()

    if (argument === 'stats') {
      return { text: statisticsTextOf(await loadedStatistics($, runner)) }
    }

    if (argument === 'help') {
      return { text: HOW_TO_PLAY_TEXT }
    }

    if (runner.isPaneOpen) {
      await $.ui.close({ id: PANE_ID })
      runner.isPaneOpen = false
      runner.isPaneOpenedByTurn = false
      runner.isRunActive = false
      cancelClose(runner)
      await $.store.set(STORE_KEYS.isClosedByPerson, true)

      return { text: 'Claude Runner closed. /runner opens it again.' }
    }

    await $.store.set(STORE_KEYS.isClosedByPerson, false)

    const notPlacedReason = await openPane($, runner)

    runner.isPaneOpenedByTurn = false

    return {
      text:
        notPlacedReason === null
          ? OPENED_TEXT
          : `Claude Runner cannot be shown here: ${notPlacedReason}`,
    }
  })

  on('ui.close', { id: PANE_ID }, async ($, event, next) => {
    const result = await next(event)

    runner.isPaneOpen = false
    runner.isPaneOpenedByTurn = false
    runner.isRunActive = false
    cancelClose(runner)

    if (event.origin.kind === 'person') {
      await $.store.set(STORE_KEYS.isClosedByPerson, true)
    }

    return result
  })
}
