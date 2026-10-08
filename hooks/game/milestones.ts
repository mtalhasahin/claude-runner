/**
 * What the game says as Claude's turn runs long.
 */
export const MILESTONES: readonly { atMilliseconds: number; text: string }[] = [
  { atMilliseconds: 30_000, text: 'Claude is warming up...' },
  { atMilliseconds: 60_000, text: 'Deep thinking...' },
  { atMilliseconds: 120_000, text: 'This is getting serious...' },
  { atMilliseconds: 300_000, text: 'Are we building an operating system?' },
]

/**
 * How long a milestone stays on the message line.
 */
export const MILESTONE_SHOWN_MILLISECONDS = 4_000

/**
 * The milestone to show at this point of the turn, or null outside the few
 * seconds after one is reached.
 */
export function milestoneTextOf(turnMilliseconds: number): string | null {
  const reached = MILESTONES.filter(
    milestone => milestone.atMilliseconds <= turnMilliseconds,
  ).at(-1)

  const isShowing =
    reached !== undefined &&
    turnMilliseconds < reached.atMilliseconds + MILESTONE_SHOWN_MILLISECONDS

  return isShowing ? reached.text : null
}
