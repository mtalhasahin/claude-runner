import type { On, RenderPropsOf } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { FRAME_ROWS } from '../hooks/game/renderer'

tier('user')

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Claude Runner',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 14 },
  view: {},
}

const GAME_COLUMNS = 38

/**
 * Answers the engine beneath the plugin: turns, commands and panes, a wide
 * terminal that places every pane.
 *
 * @returns the ids of the panes closed, in order, and the engine's clock
 */
function seatsEngine(on: On): { closed: string[]; clock: MockClock } {
  const openPaneIds = new Set<string>()
  const closed: string[] = []

  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', ($, event) => ({ cwd: event.cwd }))
  on('turn.start', ($, event) => ({ turnId: event.turnId }))
  on('turn.complete', ($, event) => ({ text: event.answer }))
  on('command.register', ($, event) => ({ value: { command: event.name } }))
  on('ui.open', ($, event) => {
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

  return { closed, clock }
}

async function mountedPane($: Engine, surface: 'terminal' | 'desktop') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({
    plugin: 'runner',
    surface,
    component: 'Pane',
    requestId: 'runner',
    props: PANE_PROPS,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
  })

  await ui.resize({ columns: GAME_COLUMNS, rows: FRAME_ROWS, in: 'game' })

  return ui
}

function completion(
  reason: 'answer' | 'error',
  turnId: string,
): Parameters<Engine['turn']['complete']>[0] {
  return {
    reason,
    answer: '',
    durationMs: 1_000,
    isAborted: false,
    turnId,
  }
}

describe('runner-client', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: waits, runs with the turn, keeps running after the answer`, async (
      $,
      on,
    ) => {
      seatsEngine(on)

      const ui = await mountedPane($, surface)
      const game = (text: RegExp) => ui.find({ type: 'Text', text, in: 'game' })

      expect(await game(/Waiting for Claude/), 'idle').toBeDefined()

      await ui.advance(1_000)

      expect(
        await game(/Score 00000  Best 00000  Session 00:00/),
        'idle: no time',
      ).toBeDefined()

      await $.turn.start({ text: 'Analyze this project', turnId: 'turn-1' })

      expect(await game(/Click here/), 'running at once').toBeDefined()

      await ui.advance(1_500)

      expect(await game(/Score 0001\d .* Session 00:01/), 'scoring').toBeDefined()

      await $.turn.complete(completion('answer', 'turn-1'))
      await ui.advance(600)

      expect(
        await game(/Score 00(01[6-9]|02\d) .* Session 00:01/),
        "still scoring; the clock at the engine's duration",
      ).toBeDefined()

      await $.turn.start({ text: 'And again', turnId: 'turn-2' })

      expect(
        await game(/Score 00(01[6-9]|02\d) .* Session 00:00/),
        'the next turn keeps the run going, its clock from zero',
      ).toBeDefined()

      await ui.unmount()
    })
  }

  test('a failed turn leaves the run going', async ($, on) => {
    seatsEngine(on)

    const ui = await mountedPane($, 'terminal')
    const game = (text: RegExp) => ui.find({ type: 'Text', text, in: 'game' })

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await ui.advance(600)
    await $.turn.complete(completion('error', 'turn-1'))
    await ui.advance(600)

    expect(await game(/GAME OVER/)).toBeUndefined()
    expect(await game(/Score 0001\d/), 'still scoring').toBeDefined()

    await ui.unmount()
  })

  test('how to play stays on screen until the first key', async ($, on) => {
    seatsEngine(on)

    const ui = await mountedPane($, 'terminal')
    const game = (text: RegExp) => ui.find({ type: 'Text', text, in: 'game' })

    expect(
      await ui.find({ type: 'Text', text: 'Click game · SPACE/↑ jump · P pause' }),
      'the controls under the title',
    ).toBeDefined()

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await ui.advance(2_000)

    expect(await game(/Click here, then SPACE to jump/), 'still there at 2 s').toBeDefined()

    await ui.key({ key: 'up', in: 'game' })
    await ui.advance(60)

    expect(await game(/Click here/), 'gone after a key').toBeUndefined()

    await ui.redraw({ ...PANE_PROPS, isFocused: true })

    expect(
      await ui.find({ type: 'Text', text: 'SPACE/↑ jump · P pause · Esc back' }),
      'once the pane holds the keys, how to hand them back',
    ).toBeDefined()

    await ui.unmount()
  })

  test('idle, Space starts a run without Claude', async ($, on) => {
    seatsEngine(on)

    const ui = await mountedPane($, 'terminal')
    const game = (text: RegExp) => ui.find({ type: 'Text', text, in: 'game' })

    expect(await game(/SPACE to play/)).toBeDefined()

    await ui.key({ key: ' ', in: 'game' })
    await ui.advance(1_200)

    expect(await game(/Score 0001\d .* Session 00:00/), 'no Claude clock').toBeDefined()

    await ui.unmount()
  })

  test('after the answer the pane stays while the person plays, closes 5 s after the run ends', async (
    $,
    on,
  ) => {
    const { closed, clock } = seatsEngine(on)

    const ui = await mountedPane($, 'terminal')

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await clock.advance(10)
    await ui.advance(1_000)
    await $.turn.complete(completion('answer', 'turn-1'))
    await clock.advance(30_000)

    expect(closed, 'the run is going').toEqual([])

    await ui.post({ kind: 'run-ended', score: 300 }, { in: 'game' })
    await clock.advance(4_999)

    expect(closed, 'the last score still shows').toEqual([])

    await clock.advance(1)

    expect(closed).toEqual(['runner'])
  })

  test('keys: Space and Up jump, P pauses, Space retries a hit', async (
    $,
    on,
  ) => {
    seatsEngine(on)

    const ui = await mountedPane($, 'terminal')
    const game = (text: RegExp) => ui.find({ type: 'Text', text, in: 'game' })

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await ui.key({ key: 'p', in: 'game' })

    expect(await game(/PAUSED/)).toBeDefined()

    await ui.key({ key: ' ', in: 'game' })
    await ui.advance(6_000)

    expect(
      await game(/NEW BEST \d+  ·  SPACE to retry/),
      'nobody jumped; with no best yet, the first run is one',
    ).toBeDefined()

    await ui.key({ key: 'up', in: 'game' })
    await ui.advance(120)

    expect(await game(/SPACE to retry/), 'retried').toBeUndefined()

    await ui.unmount()
  })

  test('scores and turns land in the stored statistics and /runner stats', async (
    $,
    on,
  ) => {
    seatsEngine(on)

    const ui = await mountedPane($, 'terminal')

    await $.turn.start({ text: 'hi', turnId: 'turn-1' })
    await ui.post({ kind: 'run-ended', score: 1_840 }, { in: 'game' })
    await ui.post({ kind: 'run-ended', score: 920 }, { in: 'game' })
    await ui.post({ kind: 'not-a-run', score: 99_999 }, { in: 'game' })
    await $.turn.complete({ ...completion('answer', 'turn-1'), durationMs: 84_000 })

    const { text } = await $.command.run({
      command: 'runner',
      args: 'stats',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

    expect(text).toContain('Games:           2')
    expect(text).toContain('Best Score:      1840')
    expect(text).toContain('Claude Sessions: 1')
    expect(text).toContain('Waiting Time:    01m 24s')

    expect(
      await ui.find({ type: 'Text', text: /Best 01840/, in: 'game' }),
      'the best reaches the game as a prop',
    ).toBeDefined()

    await ui.unmount()
  })

  test('without Client (mobile), the pane still shows its status', async (
    $,
    on,
  ) => {
    seatsEngine(on)
    await $.session.start({ surface: 'mobile', isInteractive: true, cwd: '/work' })

    const ui = await $.ui.mount({
      plugin: 'runner',
      surface: 'mobile',
      component: 'Pane',
      requestId: 'runner',
      props: PANE_PROPS,
    })

    expect(
      await ui.find({ type: 'Text', text: /Waiting for Claude/ }),
    ).toBeDefined()

    await ui.unmount()
  })
})
