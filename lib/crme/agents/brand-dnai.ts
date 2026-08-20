import type {
  BrandFitVector,
  BrandProfile,
  SignalContext,
  TraceEntry,
} from '../types'
import type { Weights } from '../config'
import { DEFAULT_WEIGHTS, REFUSAL_THRESHOLDS } from '../config'
import {
  calibrate,
  clamp01,
  cosine,
  embed,
  lexicalCoverage,
  round,
} from '../llm/embeddings'
import { judge } from '../llm/provider'
import { velocityScore } from './cultural-radar'

/**
 * Agent 2 — Brand DNAi Alignment (Agent_BrandDNA).
 *
 * Calculates semantic vector similarity against the brand's approved DNAi
 * boundary and enforces anti-cringe refusal on forced-trend moments.
 *
 * ── The Brand Fit Index ────────────────────────────────────────────────────
 *
 *   C_fit = w1·cos(E_sig, e_brand) + w2·S_resonance − w3·R_cringe
 *
 * with calibrated operational weights w1 = 0.50, w2 = 0.30, w3 = 0.20.
 *
 * NOTE ON NORMALISATION. Taken literally the positive terms sum to 0.80, so
 * the expression can never exceed 0.80 — which would make the specification's
 * own auto-dispatch threshold (C_fit ≥ 0.85) and its worked Rexona example
 * (C_fit = 0.94) unreachable. The weighted sum is therefore normalised by
 * (w1 + w2) so C_fit spans the full [0,1] interval the thresholds are written
 * against. This preserves the formula's shape and the relative influence of
 * every term; it only fixes the scale.
 */

export interface BrandFitInput {
  signal: SignalContext
  brand: BrandProfile
  weights?: Weights
  /** Set false to skip the hosted-model enhancement (used by tests/replay). */
  useModel?: boolean
}

export interface BrandFitResult {
  vector: BrandFitVector
  trace: TraceEntry
  /** True when a hosted model contributed to the cringe judgement. */
  model_assisted: boolean
}

interface CringeJudgement {
  cringe_score: number
  reasoning: string
  positioning_guidance: string
}

const CRINGE_SCHEMA = {
  type: 'object',
  properties: {
    cringe_score: {
      type: 'number',
      description:
        'Risk in [0,1] that this brand attaching itself to this cultural moment reads as forced trend-jumping to consumers.',
    },
    reasoning: { type: 'string' },
    positioning_guidance: {
      type: 'string',
      description: 'One sentence on how the brand should enter the moment, or why it must not.',
    },
  },
  required: ['cringe_score', 'reasoning', 'positioning_guidance'],
  additionalProperties: false,
} as const

/** Concatenated text that represents the brand's approved semantic centre. */
function brandCorpus(brand: BrandProfile): string {
  return [
    brand.name,
    brand.pillars.join(' '),
    brand.lexicon.join(' '),
    brand.permitted_categories.join(' '),
  ].join(' ')
}

/** Concatenated text that represents the live cultural moment. */
function signalCorpus(signal: SignalContext): string {
  return [
    signal.headline,
    signal.raw_text,
    signal.category,
    signal.ocr_frames.join(' '),
    signal.detected_entities.join(' '),
  ].join(' ')
}

export async function runBrandDnai({
  signal,
  brand,
  weights = DEFAULT_WEIGHTS,
  useModel = true,
}: BrandFitInput): Promise<BrandFitResult> {
  const started = Date.now()

  const signalText = signalCorpus(signal)
  const brandText = brandCorpus(brand)

  // --- Term 1: semantic similarity -----------------------------------------
  const rawCosine = cosine(embed(signalText), embed(brandText))
  const calibrated = calibrate(rawCosine)

  const lexicon = lexicalCoverage(signalText, brand.lexicon)
  const pillars = lexicalCoverage(signalText, brand.pillars)
  // Short documents compress the hashed cosine, so an explainable lexical
  // term is blended in. It is also what lets the agent name the pillars hit.
  const lexicalScore = clamp01(lexicon.coverage * 3.5)
  const cosineSimilarity = clamp01(0.5 * calibrated + 0.5 * lexicalScore)

  // --- Term 2: cultural resonance ------------------------------------------
  const categoryPermitted = brand.permitted_categories.includes(signal.category)
  const vScore = velocityScore(signal.engagement_velocity)
  const sResonance = clamp01(
    0.45 * (categoryPermitted ? 1 : 0.15) +
      0.3 * lexicalScore +
      0.25 * vScore,
  )

  // --- Term 3: cringe hazard -----------------------------------------------
  const forbidden = lexicalCoverage(signalText, brand.forbidden_territory)
  const forbiddenPenalty = Math.min(1, forbidden.matched.length * 0.45)
  const categoryMismatch = categoryPermitted ? 0 : 0.35
  // Trend-jumping signature: the moment is loud but the brand has no claim on
  // it. High velocity minus low relevance is exactly what reads as cringe.
  //
  // The penalty is conditioned on category permission. A brand speaking inside
  // its own territory is not trend-jumping just because the moment is large —
  // Sunsilk on a monsoon is doing its job. An interloper on the same moment
  // carries the full penalty, because volume is the only reason it is there.
  const chasingFactor = categoryPermitted ? 0.15 : 0.5
  const chasing = clamp01(vScore - cosineSimilarity) * chasingFactor
  let rCringe = clamp01(forbiddenPenalty + categoryMismatch + chasing)

  // --- Optional hosted-model judgement -------------------------------------
  let modelAssisted = false
  let guidance =
    forbidden.matched.length > 0
      ? `Refuse: the moment touches ${forbidden.matched.join(', ')}, which sits outside ${brand.name}'s permission.`
      : categoryPermitted
        ? `Enter through ${pillars.matched[0] ?? brand.pillars[0]}.`
        : `${brand.name} has no established permission in ${signal.category}; enter only with a category-native truth.`

  if (useModel) {
    const verdict = await judge<CringeJudgement>({
      system:
        'You are the Brand DNAi Alignment Agent inside Unilever\'s Cultural Response & Moment Engine. Your job is refusal, not creativity. You protect brand equity by identifying when attaching a brand to a live cultural moment would read as forced, opportunistic or tone-deaf. Be conservative: when in doubt, score higher risk.',
      prompt: [
        `BRAND: ${brand.name} (${brand.business_group})`,
        `APPROVED POSITIONING: ${brand.pillars.join(' | ')}`,
        `FORBIDDEN TERRITORY: ${brand.forbidden_territory.join(', ')}`,
        `PERMITTED CATEGORIES: ${brand.permitted_categories.join(', ')}`,
        '',
        `LIVE MOMENT: ${signal.headline}`,
        `CONTEXT: ${signal.raw_text}`,
        `CATEGORY: ${signal.category}`,
        `MARKET: ${signal.geo.market}`,
        `ENGAGEMENT VELOCITY: ${Math.round(signal.engagement_velocity).toLocaleString()} shares/min`,
        `ON-SCREEN ENTITIES: ${signal.detected_entities.join(', ') || 'none'}`,
        '',
        'Score the cringe hazard of this brand entering this moment.',
      ].join('\n'),
      schema: CRINGE_SCHEMA as unknown as Record<string, unknown>,
    })

    if (verdict && Number.isFinite(verdict.cringe_score)) {
      // Blend rather than replace: the deterministic term stays accountable,
      // and a model cannot unilaterally lower a hazard the rules detected.
      const modelScore = clamp01(verdict.cringe_score)
      rCringe = clamp01(Math.max(rCringe * 0.5 + modelScore * 0.5, forbiddenPenalty))
      if (verdict.positioning_guidance) guidance = verdict.positioning_guidance
      modelAssisted = true
    }
  }

  // --- Composite Brand Fit Index -------------------------------------------
  const normaliser = weights.w1 + weights.w2
  const cFit = clamp01(
    (weights.w1 * cosineSimilarity +
      weights.w2 * sResonance -
      weights.w3 * rCringe) /
      normaliser,
  )

  const vector: BrandFitVector = {
    brand_id: brand.brand_id,
    c_fit: round(cFit),
    cosine_similarity: round(cosineSimilarity),
    s_resonance: round(sResonance),
    r_cringe: round(rCringe),
    // Pillars and lexicon hits are kept apart deliberately. A matched lexicon
    // term is evidence that the moment is in the brand's world; it is not a
    // positioning statement, and copy must never be built from one.
    matched_brand_pillars: pillars.matched,
    matched_lexicon: lexicon.matched.slice(0, 6),
    positioning_guidance: guidance,
    weights_applied: { ...weights },
  }

  const passes =
    cFit >= REFUSAL_THRESHOLDS.MIN_BRAND_FIT &&
    rCringe <= REFUSAL_THRESHOLDS.MAX_CRINGE

  const trace: TraceEntry = {
    node: 'evaluate_brand_dna',
    agent: 'Agent_BrandDNA',
    label: 'Brand DNAi check',
    detail: passes
      ? `Semantic match against ${brand.name} DNAi. C_fit = ${cFit.toFixed(2)}, cringe hazard ${rCringe.toFixed(2)}. ${guidance}`
      : `${brand.name} lacks permission in this moment. C_fit = ${cFit.toFixed(2)}, cringe hazard ${rCringe.toFixed(2)}. ${guidance}`,
    t_offset_ms: Date.now() - started,
    status: passes ? 'OK' : 'REFUSED',
    metrics: {
      c_fit: round(cFit),
      cosine_similarity: round(cosineSimilarity),
      raw_cosine: round(rawCosine),
      s_resonance: round(sResonance),
      r_cringe: round(rCringe),
      lexicon_coverage: round(lexicon.coverage),
    },
  }

  return { vector, trace, model_assisted: modelAssisted }
}
