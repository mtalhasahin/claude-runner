/**
 * The runner's vertical motion, in rows above the ground and rows per second.
 *
 * Tuned so a jump clears the widest obstacle at the starting speed: about
 * 0.67 s in the air, a little over three rows high.
 */
export const GRAVITY_ROWS_PER_SECOND_SQUARED = 60

export const JUMP_VELOCITY_ROWS_PER_SECOND = 20

/**
 * How long a jump pressed just before landing is kept, so it fires on touch
 * down instead of being lost.
 */
export const JUMP_BUFFER_MILLISECONDS = 120

export type Body = {
  /**
   * Rows above the ground; 0 standing.
   */
  height: number
  /**
   * Rows per second, upward positive.
   */
  velocity: number
}

export const STANDING: Body = { height: 0, velocity: 0 }

export function isOnGround(body: Body): boolean {
  return body.height <= 0 && body.velocity <= 0
}

export function jumped(body: Body): Body {
  return isOnGround(body)
    ? { height: 0, velocity: JUMP_VELOCITY_ROWS_PER_SECOND }
    : body
}

/**
 * The body after `milliseconds` of flight; it lands, and stays, at 0.
 */
export function fallen(body: Body, milliseconds: number): Body {
  if (isOnGround(body)) {
    return STANDING
  }

  const seconds = milliseconds / 1000
  const velocity = body.velocity - GRAVITY_ROWS_PER_SECOND_SQUARED * seconds
  const height =
    body.height +
    body.velocity * seconds -
    (GRAVITY_ROWS_PER_SECOND_SQUARED * seconds * seconds) / 2

  return height <= 0 ? STANDING : { height, velocity }
}
