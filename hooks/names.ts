export const PLUGIN_NAME = 'runner'

export const PANE_ID = 'runner'

export const PANE_TITLE = 'Claude Runner'

export const COMMAND_NAME = 'runner'

export const COMMAND_DESCRIPTION =
  'Open or close the Claude Runner pane, a small game to play while Claude works'

/**
 * Body columns the pane asks for while docked beside the transcript (about
 * 280-360 px at a usual terminal font), and rows while seated inline.
 */
export const PANE_COLUMNS = 40

export const PANE_ROWS = 14

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
