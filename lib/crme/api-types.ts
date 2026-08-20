import type {
  CampaignOutcome,
  Decision,
  ApprovalStatus,
  DecisionRecord,
  HitlInterrupt,
  RefusalReason,
  ReasoningMode,
  TraceEntry,
} from './types'
import type { StreamEvent } from './store/decision-store'
import type { EngineMetrics } from './engine'

/** Wire shapes shared between the route handlers and the console client. */

export interface DecisionSummary {
  record_id: string
  signal_id: string
  brand_id: string
  decision: Decision
  approval_status: ApprovalStatus
  headline: string
  category: string
  market: string
  budget_usd: number
  cycle_ms: number
  scores: DecisionRecord['scores']
  refusal_reasons: RefusalReason[]
  reasoning_mode: ReasoningMode
  created_at: string
  outcome: CampaignOutcome | null
}

export interface StatePayload {
  cursor: number
  booted_at: string
  events: StreamEvent[]
  metrics: EngineMetrics
  pending: HitlInterrupt[]
  decisions: DecisionSummary[]
  weights: { w1: number; w2: number; w3: number }
  weight_history: Array<{
    at: string
    weights: { w1: number; w2: number; w3: number }
    samples: number
  }>
  constants: {
    autoAbortMs: number
    slaTargetMs: number
    benchmarkMs: number
    minRlooSamples: number
  }
}

export interface IngestResultSummary {
  signal_id: string
  brand_id: string
  decision: Decision | null
  cycle_ms: number
  trace: TraceEntry[]
  scores: {
    c_fit: number
    cosine_similarity: number
    s_resonance: number
    r_cringe: number
    p_toxic: number
    p_ip: number
    p_risk: number
    i_stock: number
  }
  refusal_reasons: RefusalReason[]
  reasoning_mode: ReasoningMode
}

export interface DecisionDetail {
  ok: boolean
  record: DecisionRecord
  interrupt: HitlInterrupt | null
  brand: {
    brand_id: string
    name: string
    colour: string
    pillars: string[]
    business_group: string
  }
}

export type { EngineMetrics, StreamEvent, HitlInterrupt, TraceEntry }
