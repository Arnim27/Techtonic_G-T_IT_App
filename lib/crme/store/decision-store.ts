import type {
  ApprovalStatus,
  CampaignOutcome,
  DecisionRecord,
  HitlInterrupt,
  ProjectNextState,
} from '../types'
import type { Weights } from '../config'
import { DEFAULT_WEIGHTS, HITL } from '../config'

/**
 * The Decision Record Store — Unilever's defensible moat.
 *
 * Competitors can license the same foundation models. What they cannot license
 * is the record of every signal this organisation evaluated, every human edit,
 * and — most valuably — every explicit refusal. That corpus is what the RLOO
 * optimiser learns from and what refusal-pattern mining reads.
 *
 * Storage here is process-local so the system runs with no infrastructure.
 * `DecisionStore` is the seam: swap the array-backed methods for BigQuery
 * inserts and Vertex Feature Store writes and nothing upstream changes.
 */

export interface StreamEvent {
  seq: number
  at: string
  type:
    | 'SIGNAL_DETECTED'
    | 'DECISION'
    | 'HITL_RAISED'
    | 'HITL_RESOLVED'
    | 'OUTCOME_RECORDED'
    | 'WEIGHTS_UPDATED'
  signal_id: string | null
  brand_id: string | null
  summary: string
  payload: Record<string, unknown>
}

const MAX_DECISIONS = 500
const MAX_EVENTS = 400

class DecisionStore {
  decisions: DecisionRecord[] = []
  interrupts: HitlInterrupt[] = []
  events: StreamEvent[] = []
  weights: Weights = { ...DEFAULT_WEIGHTS }
  weightHistory: Array<{ at: string; weights: Weights; samples: number }> = []
  /** Next index the firehose will emit. */
  signalCursor = 0
  private seq = 0
  readonly bootedAt = new Date().toISOString()

  // -- events --------------------------------------------------------------

  emit(event: Omit<StreamEvent, 'seq' | 'at'>): StreamEvent {
    const full: StreamEvent = {
      ...event,
      seq: ++this.seq,
      at: new Date().toISOString(),
    }
    this.events.push(full)
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS)
    }
    return full
  }

  eventsSince(cursor: number): StreamEvent[] {
    return this.events.filter((e) => e.seq > cursor)
  }

  get latestSeq(): number {
    return this.seq
  }

  // -- decisions -----------------------------------------------------------

  record(state: ProjectNextState): DecisionRecord {
    const record: DecisionRecord = {
      record_id: `DR-${state.signal_id}-${Date.now().toString(36)}`,
      signal_id: state.signal_id,
      brand_id: state.brand_id,
      decision: state.decision ?? 'REFUSE',
      approval_status: state.approval_status,
      scores: {
        brand_fit: state.brand_fit?.c_fit ?? 0,
        cringe_risk: state.brand_fit?.r_cringe ?? 1,
        toxicity_risk: state.compliance?.p_toxic ?? 0,
        ip_risk: state.compliance?.p_ip ?? 0,
        inventory_units: state.commercial?.i_stock ?? 0,
        cosine_similarity: state.brand_fit?.cosine_similarity ?? 0,
        resonance: state.brand_fit?.s_resonance ?? 0,
      },
      refusal_reasons: state.refusal_reasons,
      headline: state.signal_data.headline,
      category: state.signal_data.category,
      market: state.signal_data.geo.market,
      budget_usd: state.budget,
      cycle_ms: state.cycle_ms,
      reasoning_mode: state.reasoning_mode,
      weights_applied: state.brand_fit?.weights_applied ?? { ...this.weights },
      trace: state.trace,
      created_at: new Date().toISOString(),
      outcome: null,
    }

    this.decisions.unshift(record)
    if (this.decisions.length > MAX_DECISIONS) {
      this.decisions.length = MAX_DECISIONS
    }
    return record
  }

  findRecord(signalId: string): DecisionRecord | undefined {
    return this.decisions.find((d) => d.signal_id === signalId)
  }

  // -- HITL ----------------------------------------------------------------

  raiseInterrupt(interrupt: HitlInterrupt): HitlInterrupt {
    const existing = this.interrupts.findIndex(
      (i) => i.signal_id === interrupt.signal_id,
    )
    if (existing >= 0) this.interrupts.splice(existing, 1)
    this.interrupts.unshift(interrupt)
    return interrupt
  }

  /**
   * Applies the 15-minute auto-abort timer. Called on every read so an
   * expired card can never appear actionable, with no background timer.
   */
  sweepExpired(now = Date.now()): HitlInterrupt[] {
    const aborted: HitlInterrupt[] = []
    for (const item of this.interrupts) {
      if (item.status !== 'PENDING') continue
      if (now > new Date(item.expires_at).getTime()) {
        item.status = 'ABORTED'
        item.resolved_at = new Date(now).toISOString()
        item.resolved_by = 'system:auto-abort'
        this.syncDecision(item.signal_id, 'ABORTED')
        aborted.push(item)
        this.emit({
          type: 'HITL_RESOLVED',
          signal_id: item.signal_id,
          brand_id: item.brand_id,
          summary: `Auto-abort — ${Math.round(HITL.AUTO_ABORT_MS / 60000)} minute review window elapsed with no decision.`,
          payload: { status: 'ABORTED' },
        })
      }
    }
    return aborted
  }

  resolveInterrupt(
    signalId: string,
    status: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED'>,
    reviewer: string,
    note?: string,
  ): HitlInterrupt | null {
    this.sweepExpired()
    const item = this.interrupts.find((i) => i.signal_id === signalId)
    if (!item) return null
    if (item.status !== 'PENDING') return item

    item.status = status
    item.resolved_at = new Date().toISOString()
    item.resolved_by = reviewer
    item.reviewer_note = note ?? null
    this.syncDecision(signalId, status)
    return item
  }

  private syncDecision(signalId: string, status: ApprovalStatus) {
    const record = this.findRecord(signalId)
    if (record) record.approval_status = status
  }

  get pendingInterrupts(): HitlInterrupt[] {
    this.sweepExpired()
    return this.interrupts.filter((i) => i.status === 'PENDING')
  }

  // -- outcomes ------------------------------------------------------------

  recordOutcome(signalId: string, outcome: CampaignOutcome): boolean {
    const record = this.findRecord(signalId)
    if (!record) return false
    record.outcome = outcome
    return true
  }

  reset() {
    this.decisions = []
    this.interrupts = []
    this.events = []
    this.weights = { ...DEFAULT_WEIGHTS }
    this.weightHistory = []
    this.signalCursor = 0
    this.seq = 0
  }
}

/**
 * Singleton pinned to globalThis so it survives Next.js hot reloads in
 * development (each reload re-evaluates the module, but not the global).
 */
const GLOBAL_KEY = '__crme_decision_store__' as const

type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: DecisionStore
}

export function getStore(): DecisionStore {
  const scope = globalThis as GlobalWithStore
  if (!scope[GLOBAL_KEY]) {
    scope[GLOBAL_KEY] = new DecisionStore()
  }
  return scope[GLOBAL_KEY]
}

export type { DecisionStore }
