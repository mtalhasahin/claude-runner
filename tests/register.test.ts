import type { On, RenderInput } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const SESSION = {
  surface: 'terminal',
  isInteractive: true,
  cwd: '/work',
} as const

const RUNNER_COMMAND = {
  command: 'runner',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'runner',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Claude Runner',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
}

/**
 * Answers the engine beneath the plugin: a wide terminal that places every
 * pane, a store kept in memory, and tools that succeed.
 *
 * @returns the ids of the panes opened and closed, in order, and the clock
 */
function seatsEngine(
  on: On,
  storedEntries: Record<string, unknown> = {},
): { opened: string[]; closed: string[]; clock: MockClock } {
  const opened: string[] = []
  const closed: string[] = []
  const openPaneIds = new Set<string>()

  const clock = mock.clock(on)
  mock.store(on, storedEntries)
  on('session.start', ($, event) => ({ cwd: event.cwd }))
  on('turn.start', ($, event) => ({ turnId: event.turnId }))
  on('turn.complete', ($, event) => ({ text: event.answer }))
  on('command.register', ($, event) => ({ value: { command: event.name } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('ui.open', ($, event) => {
    opened.push(event.id)
    openPaneIds.add(event.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, event) => {
    closed.push(event.id)
    openPaneIds.delete(event.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...openPaneIds].map(id => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'done' }))

  return { opened, closed, clock }
}

function completionOf(
  reason: 'answer' | 'error',
  turnId: string,
): Parameters<Engine['turn']['complete']>[0] {
  return { reason, answer: '', durationMs: 1_000, isAborted: false, turnId }
}

/**
 * A rendered tree's text: its strings in order.
 */
function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') {
    return String(tree)
  }

  if (Array.isArray(tree)) {
    return tree.map(textOf).join('')
  }

  if (typeof tree !== 'object' || tree === null) {
    return ''
  }

  return textOf(Reflect.get(tree, 'children') ?? [])
}

describe('register', () => {
  test('in a session with no screen, /runner says so and opens nothing', async (
    $,
    on,
  ) => {
    const opened: string[] = []

    mock.clock(on)
    mock.store(on)
    on('session.start', ($, event) => ({ cwd: event.cwd }))
    on('command.register', ($, event) => ({ value: { command: event.name } }))
    on('session.surfaces', () => ({ value: [] }))
    on('ui.open', ($, event) => {
      opened.push(event.id)

      return { value: { isPlaced: true as const } }
    })
    on('ui.panes', () => ({ value: [] }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('turn.start', ($, event) => ({ turnId: event.turnId }))

    await $.session.start(SESSION)

    const { text } = await $.command.run(RUNNER_COMMAND)

    expect(text).toContain('Claude Runner cannot be shown here: this session has no screen')
    expect(text).toContain('Run claude in a terminal to play')

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })

    expect(opened, 'neither /runner nor a turn opens a pane').toEqual([])
  })

  test('where the pane would wait undrawn, /runner says why and closes it', async (
    $,
    on,
  ) => {
    const closed: string[] = []

    mock.clock(on)
    mock.store(on)
    on('session.start', ($, event) => ({ cwd: event.cwd }))
    on('command.register', ($, event) => ({ value: { command: event.name } }))
    on('session.surfaces', () => ({ value: ['terminal' as const] }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({
      value: { isPlaced: false, reason: 'the attached surfaces place no panes' },
    }))
    on('ui.close', ($, event) => {
      closed.push(event.id)

      return { value: undefined }
    })

    await $.session.start(SESSION)

    const { text } = await $.command.run(RUNNER_COMMAND)

    expect(text).toBe(
      'Claude Runner cannot be shown here: the attached surfaces place no panes',
    )
    expect(closed).toEqual(['runner'])
  })

  test('statistics already stored show in /runner stats and on the idle pane', async (
    $,
    on,
  ) => {
    seatsEngine(on, {
      statistics: {
        bestScore: 6_210,
        gamesPlayed: 127,
        totalClaudeSessions: 86,
        totalWaitingMilliseconds: 15_660_000,
      },
    })

    await $.session.start(SESSION)

    const { text } = await $.command.run({ ...RUNNER_COMMAND, args: 'stats' })

    expect(text).toContain('Games:           127')
    expect(text).toContain('Waiting Time:    04h 21m')
    expect(textOf(await $.ui.render(PANE))).toContain(
      'Best 6210 · 127 games · /runner stats',
    )
  })

  test('a turn opens the pane and its status follows the turn', async (
    $,
    on,
  ) => {
    const { opened, clock } = seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'Analyze this project', turnId: 'turn-1' })
    await clock.advance(10)

    expect(opened).toEqual(['runner'])
    expect(textOf(await $.ui.render(PANE))).toContain('Claude is working...')

    await $.tool.call({ tool: 'Bash', command: 'ls' })

    expect(textOf(await $.ui.render(PANE))).toContain('Claude is thinking...')

    await $.turn.complete({
      reason: 'answer',
      answer: 'Done.',
      durationMs: 102_000,
      isAborted: false,
      turnId: 'turn-1',
    })

    const drawn = textOf(await $.ui.render(PANE))

    expect(drawn).toContain('✓ Response completed')
    expect(drawn).toContain('Session time: 01:42')
  })

  test('a turn that dies on an API error shows the error state', async (
    $,
    on,
  ) => {
    seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await $.turn.complete({
      reason: 'error',
      answer: '',
      durationMs: 4_000,
      isAborted: false,
      turnId: 'turn-1',
    })

    expect(textOf(await $.ui.render(PANE))).toContain(
      'Claude encountered an error',
    )
  })

  test('a subagent finishing does not end the main turn', async ($, on) => {
    seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await $.turn.complete({
      reason: 'answer',
      answer: 'sub-result',
      durationMs: 1_000,
      isAborted: false,
      turnId: 'turn-1',
      agentId: 'agent-1',
    })

    expect(textOf(await $.ui.render(PANE))).toContain('Claude is working...')
  })

  test('closed with /runner, a new turn does not reopen it', async (
    $,
    on,
  ) => {
    const { opened } = seatsEngine(on)

    await $.session.start(SESSION)

    const openedByCommand = await $.command.run(RUNNER_COMMAND)

    expect(openedByCommand.text).toBe(
      'Claude Runner opened. Click the game, then SPACE or ↑ to jump, P to pause. /runner help for more.',
    )

    const help = await $.command.run({ ...RUNNER_COMMAND, args: 'help' })

    expect(help.text).toContain('1. Click the game in the pane: keys reach it only then.')
    expect(opened, '/runner help opens nothing').toEqual(['runner'])

    const closedByCommand = await $.command.run(RUNNER_COMMAND)

    expect(closedByCommand.text).toContain('Claude Runner closed.')

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })

    expect(opened, 'only the /runner open, none on the turn').toEqual([
      'runner',
    ])
  })

  test('an answer closes the pane the turn opened, five seconds on', async (
    $,
    on,
  ) => {
    const { opened, closed, clock } = seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await clock.advance(3_000)
    await $.turn.complete(completionOf('answer', 'turn-1'))
    await clock.advance(4_999)

    expect(closed, 'the final score still shows').toEqual([])

    await clock.advance(1)

    expect(closed).toEqual(['runner'])

    await $.turn.start({ text: 'again', turnId: 'turn-2' })
    await clock.advance(10)

    expect(opened, 'the next turn opens it again').toEqual(['runner', 'runner'])
  })

  test('a new turn within the five seconds keeps the pane up', async (
    $,
    on,
  ) => {
    const { closed, clock } = seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await clock.advance(3_000)
    await $.turn.complete(completionOf('answer', 'turn-1'))
    await clock.advance(2_000)
    await $.turn.start({ text: 'and then', turnId: 'turn-2' })
    await clock.advance(10_000)

    expect(closed).toEqual([])
  })

  test('a pane opened with /runner stays after the answer', async ($, on) => {
    const { closed, clock } = seatsEngine(on)

    await $.session.start(SESSION)
    await $.command.run(RUNNER_COMMAND)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await clock.advance(3_000)
    await $.turn.complete(completionOf('answer', 'turn-1'))
    await clock.advance(10_000)

    expect(closed).toEqual([])
  })

  test('a pane showing an error stays', async ($, on) => {
    const { closed, clock } = seatsEngine(on)

    await $.session.start(SESSION)
    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await clock.advance(3_000)
    await $.turn.complete(completionOf('error', 'turn-1'))
    await clock.advance(10_000)

    expect(closed).toEqual([])
  })
})
