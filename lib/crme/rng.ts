/**
 * Seeded pseudo-random number generation.
 *
 * Enterprise connector responses are simulated, but they must be *stable*:
 * querying SAP for the same signal twice has to return the same stock level,
 * or the decision record store would contain contradictory evidence for one
 * decision. Every simulated read is therefore seeded by the signal id.
 */

export function seedFrom(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, good enough distribution for simulation. */
export function createRng(seed: string | number) {
  let state = typeof seed === 'string' ? seedFrom(seed) : seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function rngPick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]
}
