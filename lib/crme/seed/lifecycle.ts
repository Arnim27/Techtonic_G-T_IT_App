/**
 * Section 2 — Horizontal Lifecycle & Portfolio Ranking.
 *
 * The end-to-end brand management lifecycle deconstructed across 6 stages.
 * Candidate agentic products are scored on a 5-variable weighted matrix:
 *   Business Impact 25% | Tech Feasibility 20% | Strategic Fit 20%
 *   Prototype Viability 20% | Governance Manageability 15%
 */

export interface ScoringVariable {
  key: keyof LifecycleStage['scores']
  label: string
  weight: number
}

export const SCORING_MATRIX: ScoringVariable[] = [
  { key: 'business_impact', label: 'Business Impact', weight: 0.25 },
  { key: 'tech_feasibility', label: 'Tech Feasibility', weight: 0.2 },
  { key: 'strategic_fit', label: 'Strategic Fit', weight: 0.2 },
  { key: 'prototype_viability', label: 'Prototype Viability', weight: 0.2 },
  { key: 'governance', label: 'Governance Manageability', weight: 0.15 },
]

export interface LifecycleStage {
  stage: number
  stage_label: string
  concept: string
  acronym: string
  qual_split: number
  quant_split: number
  qual_sources: string[]
  quant_sources: string[]
  legacy_friction: string
  weighted_score: number
  rank: number
  prioritised: boolean
  scores: {
    business_impact: number
    tech_feasibility: number
    strategic_fit: number
    prototype_viability: number
    governance: number
  }
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    stage: 1,
    stage_label: 'Stage 1',
    concept: 'Cognitive Whitespace Synthesizer',
    acronym: 'CWS',
    qual_split: 70,
    quant_split: 30,
    qual_sources: ['Ethnography', 'TikTok'],
    quant_sources: ['Search', 'Nielsen POS'],
    legacy_friction:
      '3–6 month manual consumer meta-analyses and static trend deck lag.',
    weighted_score: 79.25,
    rank: 5,
    prioritised: false,
    scores: {
      business_impact: 78,
      tech_feasibility: 82,
      strategic_fit: 80,
      prototype_viability: 82,
      governance: 73,
    },
  },
  {
    stage: 2,
    stage_label: 'Stage 2',
    concept: 'Synthetic Cohort & Claims Tester',
    acronym: 'SCCTE',
    qual_split: 50,
    quant_split: 50,
    qual_sources: ['Focus Transcripts'],
    quant_sources: ['BASES', 'Price Elasticity'],
    legacy_friction:
      '4–8 week physical focus panel recruiting and sensory survey delays.',
    weighted_score: 80.75,
    rank: 4,
    prioritised: false,
    scores: {
      business_impact: 82,
      tech_feasibility: 84,
      strategic_fit: 78,
      prototype_viability: 83,
      governance: 75,
    },
  },
  {
    stage: 3,
    stage_label: 'Stage 3',
    concept: 'Autonomous GTM Orchestrator',
    acronym: 'AAL-GTM',
    qual_split: 30,
    quant_split: 70,
    qual_sources: ['Cultural Dialects'],
    quant_sources: ['DAM Specs', 'SKU Master'],
    legacy_friction:
      '6-week agency transcreation pipelines and manual packaging review.',
    weighted_score: 87.5,
    rank: 3,
    prioritised: false,
    scores: {
      business_impact: 90,
      tech_feasibility: 88,
      strategic_fit: 89,
      prototype_viability: 85,
      governance: 84,
    },
  },
  {
    stage: 4,
    stage_label: 'Stage 4',
    concept: 'Real-Time Cultural Response Engine',
    acronym: 'CRME',
    qual_split: 60,
    quant_split: 40,
    qual_sources: ['Live Video', 'Subtext'],
    quant_sources: ['Real-Time Stock', 'CPC'],
    legacy_friction:
      '4–8 week cross-functional handoffs; missing the 24–48h cultural window.',
    weighted_score: 94.25,
    rank: 1,
    prioritised: true,
    scores: {
      business_impact: 97,
      tech_feasibility: 92,
      strategic_fit: 96,
      prototype_viability: 96,
      governance: 88,
    },
  },
  {
    stage: 5,
    stage_label: 'Stage 5',
    concept: 'Omnichannel Trade Synchronizer',
    acronym: 'OTDCS',
    qual_split: 20,
    quant_split: 80,
    qual_sources: ['Shopper Sentiment'],
    quant_sources: ['POS Scans', 'Dark-Store Stock'],
    legacy_friction:
      'Ad spend wasted on out-of-stock retail SKUs; manual bidding silos.',
    weighted_score: 90.0,
    rank: 2,
    prioritised: false,
    scores: {
      business_impact: 93,
      tech_feasibility: 90,
      strategic_fit: 90,
      prototype_viability: 87,
      governance: 89,
    },
  },
  {
    stage: 6,
    stage_label: 'Stage 6',
    concept: 'Equity Defense & Reform Sentinel',
    acronym: 'PEDRS',
    qual_split: 50,
    quant_split: 50,
    qual_sources: ['E-comm Reviews'],
    quant_sources: ['CDP Churn', 'Margin Drift'],
    legacy_friction:
      'Delayed quality defect detection; disconnected R&D formulation loops.',
    weighted_score: 76.75,
    rank: 6,
    prioritised: false,
    scores: {
      business_impact: 76,
      tech_feasibility: 78,
      strategic_fit: 76,
      prototype_viability: 80,
      governance: 73,
    },
  },
]

/**
 * Recomputes the weighted score from the 5-variable matrix so the table is
 * derived rather than asserted. Returned on a 0–100 scale.
 */
export function computeWeightedScore(stage: LifecycleStage): number {
  const total = SCORING_MATRIX.reduce(
    (acc, v) => acc + stage.scores[v.key] * v.weight,
    0,
  )
  return Math.round(total * 100) / 100
}
