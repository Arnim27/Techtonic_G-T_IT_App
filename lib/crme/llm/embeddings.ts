import { EMBEDDING_DIMS } from '../config'

/**
 * Deterministic embedding + vector math.
 *
 * This is the always-available reasoning substrate. When a hosted model is
 * configured (Claude / Gemini) the agents layer richer judgement on top, but
 * every score in the system can be produced without any network call — which
 * is what makes the refusal gate auditable and reproducible.
 *
 * The representation is a signed hashing vectoriser (the "hashing trick"):
 * each token is hashed to a dimension and a sign, then accumulated with
 * sub-linear term weighting and L2-normalised. Shared vocabulary between a
 * signal and a brand's DNAi boundary produces aligned components, so cosine
 * similarity is a genuine measure of lexical-semantic overlap.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'she', 'that', 'the', 'their', 'them', 'they',
  'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your', 'we', 'our',
  'us', 'not', 'no', 'so', 'if', 'then', 'than', 'there', 'here', 'what',
  'when', 'who', 'how', 'all', 'any', 'can', 'just', 'now', 'get', 'got',
])

/** Lightweight suffix stripper — enough to collapse obvious inflections. */
function stem(token: string): string {
  if (token.length <= 4) return token
  for (const suffix of ['ing', 'edly', 'ed', 'ly', 'es', 's']) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
}

/** FNV-1a — fast, stable across runs and processes. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Signed hashing vectoriser with bigrams, sub-linear term weighting and
 * L2 normalisation.
 */
export function embed(text: string, dims: number = EMBEDDING_DIMS): number[] {
  const vector = new Array<number>(dims).fill(0)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vector

  const counts = new Map<string, number>()
  const add = (term: string, weight: number) => {
    counts.set(term, (counts.get(term) ?? 0) + weight)
  }

  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i], 1)
    // Bigrams capture short phrases such as "sweat protection".
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`, 0.6)
  }

  for (const [term, count] of counts) {
    const hash = fnv1a(term)
    const index = hash % dims
    const sign = (hash >>> 31) & 1 ? -1 : 1
    // Sub-linear scaling stops a repeated term from dominating the vector.
    vector[index] += sign * (1 + Math.log(count))
  }

  return l2Normalise(vector)
}

export function l2Normalise(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

/** Cosine similarity of two L2-normalised vectors. */
export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < length; i++) dot += a[i] * b[i]
  return dot
}

/**
 * Maps a raw hashed-vector cosine into the calibrated [0,1] operating range
 * that the refusal thresholds were tuned against.
 *
 * A signed hashing vectoriser over short documents produces raw cosines in a
 * compressed band (roughly 0.02–0.45), so the thresholds in the specification
 * (C_fit ≥ 0.65, ≥ 0.85) are expressed against this calibrated scale. The
 * curve is a logistic and therefore strictly monotonic: calibration never
 * changes the ordering of two signals, only the scale they are read on.
 */
export function calibrate(rawCosine: number, midpoint = 0.2, steepness = 14): number {
  return 1 / (1 + Math.exp(-steepness * (rawCosine - midpoint)))
}

/**
 * Fraction of a reference vocabulary that appears in the text. Used as a
 * transparent, explainable companion to the cosine term — it is what lets an
 * agent say *which* brand pillars matched.
 */
export function lexicalCoverage(
  text: string,
  vocabulary: string[],
): { coverage: number; matched: string[] } {
  const tokens = new Set(tokenize(text))
  const matched: string[] = []
  for (const term of vocabulary) {
    const termTokens = tokenize(term)
    if (termTokens.length === 0) continue
    const hit = termTokens.every((t) => tokens.has(t))
    if (hit) matched.push(term)
  }
  const coverage = vocabulary.length === 0 ? 0 : matched.length / vocabulary.length
  return { coverage, matched }
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function round(value: number, dp = 4): number {
  const factor = 10 ** dp
  return Math.round(value * factor) / factor
}
