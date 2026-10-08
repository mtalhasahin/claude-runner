export const PLUGIN_NAME = 'runner'

export const PANE_ID = 'runner'

export const PANE_TITLE = 'Claude Runner'

export const COMMAND_NAME = 'runner'

export const COMMAND_DESCRIPTION =
  'Open or close the Claude Runner pane, a small game to play while Claude works (stats, help)'

/**
 * Body columns the pane asks for while docked beside the transcript (about
 * 280-360 px at a usual terminal font), and rows while seated inline.
 */
export const PANE_COLUMNS = 40

export const PANE_ROWS = 15

/**
 * What `/runner help` prints; the first lines also follow "opened".
 */
export const HOW_TO_PLAY_TEXT = [
  'How to play Claude Runner',
  '',
  '1. Click the game in the pane: keys reach it only then.',
  '2. SPACE or ↑ jumps over Bug, TODO, Error, Timeout and friends.',
  '3. P pauses. Esc gives the keyboard back to the prompt.',
  '',
  'A run starts when Claude starts working (or with SPACE) and goes on',
  'until you hit something; Claude answering does not stop it.',
  'Clear 5, 10, then every 25 obstacles in a row for a combo; gold',
  'obstacles are rare easter eggs worth a bonus.',
  '',
  '/runner opens or closes the pane, /runner stats shows your numbers.',
].join('\n')

export const NO_SURFACE_TEXT =
  'this session has no screen that draws panes (the Claude desktop app does not draw plugin panes yet). Run claude in a terminal to play; the stats still count here.'

export const OPENED_TEXT =
  'Claude Runner opened. Click the game, then SPACE or ↑ to jump, P to pause. /runner help for more.'

/**
 * How long the pane stays after Claude answers, when it closes on its own:
 * long enough to read the final score.
 */
export const CLOSE_AFTER_ANSWER_MILLISECONDS = 5_000

export const STORE_KEYS = {
  /**
   * True once the person closed the pane themselves: no more opening on its
   * own until they open it again with /runner.
   */
  isClosedByPerson: 'isClosedByPerson',
} as const
