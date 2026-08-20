import type { SignalContext, TraceEntry } from '../types'
import { REFUSAL_THRESHOLDS } from '../config'
import { clamp01, round, tokenize } from '../llm/embeddings'

/**
 * Agent 1 — Cultural Radar (Agent_Sensing).
 *
 * Ingests multimodal streams (video OCR, audio transcripts, engagement
 * velocity) and detects acceleration shifts (dE/dt) *before* peak cultural
 * decay. The output is the SignalContext (E_sig) every downstream agent
 * reasons over.
 *
 * The important property is not detection — it is timing. A moment found
 * after the 24–48h cultural window has closed is worth nothing, so the radar
 * reports decay explicitly rather than leaving it implicit in a timestamp.
 */

export interface RadarAssessment {
  signal: SignalContext
  /** Normalised engagement velocity in [0,1]. */
  velocity_score: number
  /** True while the moment is still accelerating — the window to act. */
  pre_peak: boolean
  /** Proportion of the cultural window already consumed. */
  decay_ratio: number
  /** Composite urgency used to prioritise the operations queue. */
  urgency: number
  /** True when Δt_signal has already breached the 48h ceiling. */
  decayed: boolean
  trace: TraceEntry
}

/**
 * Category inference from the multimodal payload.
 *
 * Unsafe categories are listed first and deliberately: ties resolve to the
 * earlier entry, so a flood is classified as a Disaster rather than as a
 * Monsoon. Letting a severe event be reclassified into a benign,
 * brand-friendly category is the single most dangerous failure this agent
 * could have — it would hand a marketing moment to a catastrophe.
 */
const CATEGORY_SIGNATURES: Array<{ category: string; terms: string[] }> = [
  { category: 'Disaster', terms: ['disaster', 'evacuation', 'casualty', 'cyclone', 'earthquake', 'famine', 'relief', 'flood'] },
  { category: 'Civil Unrest', terms: ['protest', 'strike', 'unrest', 'agitation', 'boycott', 'riot'] },
  { category: 'Athletic Exertion', terms: ['goal', 'match', 'sprint', 'stoppage', 'stadium', 'penalty', 'athlete', 'sweat', 'overtime', 'knee-slide'] },
  { category: 'Music Festival', terms: ['festival', 'stage', 'headline', 'crowd', 'set', 'drop', 'concert', 'lineup'] },
  { category: 'Beauty Ritual', terms: ['makeup', 'skincare', 'routine', 'glow', 'shade', 'tutorial', 'hair'] },
  { category: 'Monsoon', terms: ['rain', 'monsoon', 'humidity', 'downpour', 'frizz'] },
  { category: 'Exam Season', terms: ['exam', 'board', 'result', 'study', 'revision', 'syllabus'] },
  { category: 'Wedding Season', terms: ['wedding', 'bride', 'shaadi', 'mehendi', 'sangeet', 'baraat'] },
  { category: 'Creator Culture', terms: ['creator', 'reel', 'trend', 'viral', 'duet', 'influencer'] },
  { category: 'Family Life', terms: ['family', 'children', 'school', 'home', 'parent', 'play'] },
]

export function inferCategory(text: string, fallback: string): string {
  const tokens = new Set(tokenize(text))
  let best = { category: fallback, hits: 0 }
  for (const signature of CATEGORY_SIGNATURES) {
    let hits = 0
    for (const term of signature.terms) {
      const termTokens = tokenize(term)
      if (termTokens.length && termTokens.every((t) => tokens.has(t))) hits++
    }
    if (hits > best.hits) best = { category: signature.category, hits }
  }
  return best.hits > 0 ? best.category : fallback
}

/**
 * Normalises raw shares/minute onto [0,1]. Cultural velocity is heavy-tailed,
 * so this is logarithmic: the difference between 500 and 5,000 shares/min
 * matters far more than between 80,000 and 100,000.
 */
export function velocityScore(sharesPerMinute: number): number {
  if (sharesPerMinute <= 0) return 0
  return clamp01(Math.log10(1 + sharesPerMinute) / 5)
}

export function runCulturalRadar(raw: SignalContext): RadarAssessment {
  const started = Date.now()

  const corpus = [
    raw.headline,
    raw.raw_text,
    raw.ocr_frames.join(' '),
    raw.detected_entities.join(' '),
  ].join(' ')

  const category = inferCategory(corpus, raw.category)
  const vScore = velocityScore(raw.engagement_velocity)

  // dE/dt > 0 means the moment is still climbing — this is the window.
  const prePeak = raw.velocity_delta > 0
  const decayRatio = clamp01(
    raw.signal_age_hours / REFUSAL_THRESHOLDS.MAX_SIGNAL_AGE_HOURS,
  )
  const decayed = raw.signal_age_hours > REFUSAL_THRESHOLDS.MAX_SIGNAL_AGE_HOURS

  // Urgency rewards velocity and acceleration, and punishes elapsed time.
  const accelerationBoost = clamp01(raw.velocity_delta / 5000) * 0.25
  const urgency = clamp01(vScore * 0.6 + accelerationBoost + (1 - decayRatio) * 0.3)

  const signal: SignalContext = { ...raw, category }

  const trace: TraceEntry = {
    node: 'cultural_radar',
    agent: 'Agent_Sensing',
    label: 'Signal ingestion',
    detail: decayed
      ? `Signal detected at ${Math.round(raw.signal_age_hours)}h — cultural window already closed.`
      : `${category} detected across ${signal.modalities.length} modalities. Engagement velocity ${Math.round(raw.engagement_velocity).toLocaleString()} shares/min, ${prePeak ? 'still accelerating' : 'past peak'}.`,
    t_offset_ms: Date.now() - started,
    status: 'OK',
    metrics: {
      engagement_velocity: round(raw.engagement_velocity, 0),
      velocity_delta: round(raw.velocity_delta, 0),
      velocity_score: round(vScore),
      decay_ratio: round(decayRatio),
      urgency: round(urgency),
      signal_age_hours: round(raw.signal_age_hours, 2),
    },
  }

  return {
    signal,
    velocity_score: vScore,
    pre_peak: prePeak,
    decay_ratio: decayRatio,
    urgency,
    decayed,
    trace,
  }
}
