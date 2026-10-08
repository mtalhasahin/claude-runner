/**
 * A seeded pseudo-random generator (mulberry32): the same seed gives the same
 * run, so a test can replay one, and the state is one number kept in the
 * game's plain-data state.
 *
 * @returns the next value in [0, 1) and the seed to continue from
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  const nextSeed = (seed + 0x6d2b79f5) | 0
  let mixed = nextSeed

  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)

  const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296

  return { value, seed: nextSeed }
}
