import type { CampaignOutcome, DecisionRecord } from '../types'
import type { Weights } from '../config'
import { RLOO } from '../config'
import { clamp01, round } from '../llm/embeddings'
import { createRng } from '../rng'

/**
 * RLOO policy optimisation + refusal-pattern mining.
 *
 * Post-campaign sales lift from SAP POS and conversion metrics from the DSP
 * APIs are piped back to update the dynamic weight vector (w1, w2, w3), so
 * automated decision accuracy improves quarter on quarter. Human rejection
 * logs are mined separately to detect implicit cultural cringe patterns.
 */

// ---------------------------------------------------------------------------
// Outcome simulation (stands in for the SAP POS / DSP feedback loop)
// ---------------------------------------------------------------------------

/**
 * Synthesises a post-campaign outcome for a dispatched decision.
 *
 * The generative assumption is the one the whole system rests on: campaigns
 * that scored high on brand fit and low on cringe hazard perform better. That
 * is what makes the reward signal informative rather than noise.
 */
export function simulateOutcome(record: DecisionRecord): CampaignOutcome {
  const rng = createRng(`outcome:${record.record_id}`)
  const { brand_fit, cringe_risk } = record.scores

  const quality = clamp01(brand_fit - cringe_risk * 0.6)
  const noise = (rng() - 0.5) * 0.22

  const reward = clamp01(quality + noise)
  const salesLift = round(reward * 18 - 2, 2)
  const ctr = round(0.004 + reward * 0.028, 4)
  const conversion = round(0.008 + reward * 0.052, 4)
  const impressions = Math.round(
    (record.budget_usd / 1000) * (18000 + reward * 26000),
  )

  return {
    sales_lift_pct: salesLift,
    ctr,
    conversion_rate: conversion,
    impressions,
    reward: round(reward),
    recorded_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Weight optimisation
// ---------------------------------------------------------------------------

export interface OptimisationResult {
  updated: boolean
  weights: Weights
  previous: Weights
  samples: number
  /** Per-term correlation between the term's value and realised reward. */
  correlations: { w1: number; w2: number; w3: number }
  note: string
}

/**
 * REINFORCE Leave-One-Out: for each outcome-bearing record, the advantage is
 * its reward minus the mean reward of every *other* record. That leave-one-out
 * baseline removes the sample from its own comparison, which is what keeps the
 * gradient estimate unbiased on small batches.
 *
 * The advantage is then correlated with each term of the Brand Fit Index. A
 * term that is high precisely when campaigns over-perform earns weight.
 */
export function optimiseWeights(
  records: DecisionRecord[],
  current: Weights,
): OptimisationResult {
  const scored = records.filter((r) => r.outcome !== null)

  if (scored.length < RLOO.MIN_SAMPLES) {
    return {
      updated: false,
      weights: current,
      previous: current,
      samples: scored.length,
      correlations: { w1: 0, w2: 0, w3: 0 },
      note: `Holding weights — ${scored.length}/${RLOO.MIN_SAMPLES} outcome-bearing records.`,
    }
  }

  const rewards = scored.map((r) => r.outcome!.reward)
  const total = rewards.reduce((a, b) => a + b, 0)
  const n = scored.length

  // Leave-one-out advantage for sample i.
  const advantages = rewards.map((reward) => reward - (total - reward) / (n - 1))

  const terms = {
    w1: scored.map((r) => r.scores.cosine_similarity),
    w2: scored.map((r) => r.scores.resonance),
    // R_cringe enters the index negatively, so its gradient is inverted.
    w3: scored.map((r) => -r.scores.cringe_risk),
  }

  const gradient = {
    w1: covariance(terms.w1, advantages),
    w2: covariance(terms.w2, advantages),
    w3: covariance(terms.w3, advantages),
  }

  const proposed: Weights = {
    w1: current.w1 + RLOO.LEARNING_RATE * gradient.w1,
    w2: current.w2 + RLOO.LEARNING_RATE * gradient.w2,
    // A positive covariance here means cringe hurt performance, which should
    // *increase* the penalty weight.
    w3: current.w3 - RLOO.LEARNING_RATE * gradient.w3,
  }

  const bounded: Weights = {
    w1: bound(proposed.w1, RLOO.BOUNDS.w1),
    w2: bound(proposed.w2, RLOO.BOUNDS.w2),
    w3: bound(proposed.w3, RLOO.BOUNDS.w3),
  }

  // Renormalise the positive terms so C_fit keeps a stable scale as the
  // relative balance between similarity and resonance shifts.
  const positiveSum = bounded.w1 + bounded.w2
  const targetSum = current.w1 + current.w2
  const scale = positiveSum === 0 ? 1 : targetSum / positiveSum

  const next: Weights = {
    w1: round(bounded.w1 * scale, 4),
    w2: round(bounded.w2 * scale, 4),
    w3: round(bounded.w3, 4),
  }

  return {
    updated: true,
    weights: next,
    previous: current,
    samples: n,
    correlations: {
      w1: round(gradient.w1),
      w2: round(gradient.w2),
      w3: round(gradient.w3),
    },
    note: `Weights updated from ${n} outcome-bearing decisions.`,
  }
}

function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let sum = 0
  for (let i = 0; i < n; i++) sum += (xs[i] - meanX) * (ys[i] - meanY)
  return sum / (n - 1)
}

function bound(value: number, [min, max]: [number, number]): number {
  if (Number.isNaN(value)) return min
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// Refusal-pattern mining
// ---------------------------------------------------------------------------

export interface RefusalPattern {
  key: string
  label: string
  count: number
  share: number
  example: string
}

export interface RefusalMining {
  total_refusals: number
  by_code: RefusalPattern[]
  by_category: RefusalPattern[]
  by_brand: RefusalPattern[]
  /** Human rejections at the HITL gate — the highest-signal training data. */
  human_rejections: number
  /** Categories where humans overturned an automated pass. */
  implicit_cringe_signals: RefusalPattern[]
}

export function mineRefusals(records: DecisionRecord[]): RefusalMining {
  const refused = records.filter((r) => r.decision === 'REFUSE')
  const humanRejected = records.filter((r) => r.approval_status === 'REJECTED')

  const codeCounts = new Map<string, { count: number; example: string }>()
  for (const record of refused) {
    for (const reason of record.refusal_reasons) {
      const entry = codeCounts.get(reason.code) ?? {
        count: 0,
        example: reason.clause,
      }
      entry.count++
      codeCounts.set(reason.code, entry)
    }
  }

  return {
    total_refusals: refused.length,
    by_code: toPatterns(codeCounts, refused.length, humanise),
    by_category: countBy(refused, (r) => r.category),
    by_brand: countBy(refused, (r) => r.brand_id),
    human_rejections: humanRejected.length,
    // A human rejecting something the gate passed is the system learning a
    // cringe pattern the rules did not yet encode.
    implicit_cringe_signals: countBy(humanRejected, (r) => r.category),
  }
}

function toPatterns(
  counts: Map<string, { count: number; example: string }>,
  total: number,
  label: (key: string) => string,
): RefusalPattern[] {
  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: label(key),
      count: value.count,
      share: total === 0 ? 0 : round(value.count / total, 3),
      example: value.example,
    }))
    .sort((a, b) => b.count - a.count)
}

function countBy(
  records: DecisionRecord[],
  selector: (record: DecisionRecord) => string,
): RefusalPattern[] {
  const counts = new Map<string, { count: number; example: string }>()
  for (const record of records) {
    const key = selector(record)
    const entry = counts.get(key) ?? { count: 0, example: record.headline }
    entry.count++
    counts.set(key, entry)
  }
  return toPatterns(counts, records.length, (key) => key)
}

function humanise(code: string): string {
  const map: Record<string, string> = {
    BRAND_FIT_BELOW_FLOOR: 'Brand fit below floor',
    CRINGE_HAZARD_EXCEEDED: 'Cringe hazard exceeded',
    INVENTORY_BELOW_FLOOR: 'Inventory below floor',
    TOXICITY_EXCEEDED: 'Toxicity exceeded',
    IP_RISK_EXCEEDED: 'IP risk exceeded',
    SIGNAL_DECAYED: 'Cultural window closed',
  }
  return map[code] ?? code
}
