import type {
  DecisionRecord,
  HitlInterrupt,
  OrchestrationOutput,
  ProjectNextState,
  SignalContext,
} from './types'
import { runPipeline } from './pipeline'
import type { PipelineOptions } from './pipeline'
import { getStore } from './store/decision-store'
import { mineRefusals, optimiseWeights, simulateOutcome } from './store/rloo'
import type { RefusalMining } from './store/rloo'
import { generateSignal, rexonaBenchmarkSignal } from './seed/signals'
import { getBrand } from './seed/brands'
import { resolveProvider } from './llm/provider'
import { HITL, RLOO, SLA } from './config'
import { round } from './llm/embeddings'

/**
 * Engine service — the layer the HTTP routes talk to.
 *
 * Responsibilities: pull signals off the firehose, run them through the
 * orchestration graph, commit the outcome to the Decision Record Store, raise
 * HITL cards, and keep the live event stream current.
 */

export interface IngestResult {
  state: ProjectNextState
  record: DecisionRecord
  output: OrchestrationOutput
  interrupt: HitlInterrupt | null
}

function pipelineOptions(overrides: PipelineOptions = {}): PipelineOptions {
  const store = getStore()
  return {
    weights: store.weights,
    useModel: process.env.CRME_DISABLE_MODEL !== '1',
    ...overrides,
  }
}

/** Runs one signal end-to-end and commits everything it produced. */
export async function ingestSignal(
  signal: SignalContext,
  overrides: PipelineOptions = {},
): Promise<IngestResult> {
  const store = getStore()
  const brand = getBrand(signal.candidate_brand_id)

  store.emit({
    type: 'SIGNAL_DETECTED',
    signal_id: signal.signal_id,
    brand_id: brand.brand_id,
    summary: `${signal.headline} — ${signal.geo.market}, ${Math.round(signal.engagement_velocity).toLocaleString()} shares/min`,
    payload: {
      category: signal.category,
      source: signal.source,
      velocity: signal.engagement_velocity,
      budget: signal.proposed_budget_usd,
    },
  })

  const { state, output } = await runPipeline(signal, pipelineOptions(overrides))
  const record = store.record(state)

  store.emit({
    type: 'DECISION',
    signal_id: signal.signal_id,
    brand_id: brand.brand_id,
    summary: decisionSummary(state, brand.name),
    payload: {
      decision: state.decision,
      c_fit: state.brand_fit_score,
      r_cringe: state.brand_fit?.r_cringe ?? null,
      p_risk: state.risk_score,
      cycle_ms: state.cycle_ms,
      refusal_reasons: state.refusal_reasons.map((r) => r.clause),
    },
  })

  let interrupt: HitlInterrupt | null = null
  if (state.interrupt) {
    interrupt = store.raiseInterrupt(state.interrupt)
    store.emit({
      type: 'HITL_RAISED',
      signal_id: signal.signal_id,
      brand_id: brand.brand_id,
      summary: `Awaiting ${brand.name} brand manager — ${state.interrupt.reason}`,
      payload: {
        budget: state.budget,
        expires_at: state.interrupt.expires_at,
      },
    })
  }

  return { state, record, output, interrupt }
}

function decisionSummary(state: ProjectNextState, brandName: string): string {
  switch (state.decision) {
    case 'REFUSE':
      return `Refused for ${brandName} — ${state.refusal_reasons.map((r) => r.clause).join(' ∨ ') || 'gate fired'}`
    case 'AUTO_DISPATCH':
      return `Auto-dispatched for ${brandName} — C_fit ${state.brand_fit_score.toFixed(2)}, cleared in ${(state.cycle_ms / 1000).toFixed(1)}s`
    case 'HITL_INTERRUPT':
      return `Escalated to a human for ${brandName} — $${state.budget.toLocaleString()} activation`
    default:
      return `Processed for ${brandName}`
  }
}

/** Pulls the next signal off the firehose. */
export async function ingestNext(
  overrides: PipelineOptions = {},
): Promise<IngestResult> {
  const store = getStore()
  const signal = generateSignal(store.signalCursor++)
  return ingestSignal(signal, overrides)
}

/** Replays the Section 5 worked example: the 94th-minute Rexona dilemma. */
export async function runBenchmark(
  overrides: PipelineOptions = {},
): Promise<IngestResult> {
  const signal = rexonaBenchmarkSignal()
  // Give the replay a distinct id each time so it never collides with an
  // earlier run still sitting in the pending queue.
  const stamped: SignalContext = {
    ...signal,
    signal_id: `${signal.signal_id}-${Date.now().toString(36).toUpperCase()}`,
  }
  return ingestSignal(stamped, overrides)
}

/**
 * Bootstraps the store so a cold dashboard has history to show. Runs with the
 * hosted model disabled — this is warm-up data, not billable inference.
 *
 * The in-flight promise is memoised because the console's first poll and the
 * case page's first poll routinely land together on a cold server; without
 * it both would see an empty store and seed it twice.
 */
let seeding: Promise<void> | null = null

export function seedIfEmpty(count = 14): Promise<void> {
  const store = getStore()
  if (store.decisions.length > 0) return Promise.resolve()
  if (seeding) return seeding

  seeding = (async () => {
    try {
      for (let i = 0; i < count; i++) {
        await ingestNext({ useModel: false })
      }
      // Attribute outcomes to dispatched campaigns so RLOO has data to read.
      for (const record of store.decisions) {
        const dispatched =
          record.decision === 'AUTO_DISPATCH' || record.approval_status === 'APPROVED'
        if (dispatched) {
          store.recordOutcome(record.signal_id, simulateOutcome(record))
        }
      }
    } finally {
      seeding = null
    }
  })()

  return seeding
}

// ---------------------------------------------------------------------------
// HITL resolution
// ---------------------------------------------------------------------------

export interface ResolveResult {
  interrupt: HitlInterrupt | null
  outcome: DecisionRecord | null
}

export function resolveHitl(
  signalId: string,
  approve: boolean,
  reviewer: string,
  note?: string,
): ResolveResult {
  const store = getStore()
  const interrupt = store.resolveInterrupt(
    signalId,
    approve ? 'APPROVED' : 'REJECTED',
    reviewer,
    note,
  )
  if (!interrupt) return { interrupt: null, outcome: null }

  const record = store.findRecord(signalId) ?? null

  store.emit({
    type: 'HITL_RESOLVED',
    signal_id: signalId,
    brand_id: interrupt.brand_id,
    summary: approve
      ? `Approved by ${reviewer} — graph execution resumes, programmatic buy dispatched.`
      : `Rejected by ${reviewer} — logged to the refusal corpus for pattern mining.`,
    payload: { status: interrupt.status, note: note ?? null },
  })

  // An approved brief resumes the graph and eventually returns an outcome.
  if (approve && record) {
    const outcome = simulateOutcome(record)
    store.recordOutcome(signalId, outcome)
    store.emit({
      type: 'OUTCOME_RECORDED',
      signal_id: signalId,
      brand_id: interrupt.brand_id,
      summary: `Campaign outcome logged — ${outcome.sales_lift_pct > 0 ? '+' : ''}${outcome.sales_lift_pct}% sales lift, ${(outcome.ctr * 100).toFixed(2)}% CTR.`,
      payload: { ...outcome },
    })
  }

  return { interrupt, outcome: record }
}

// ---------------------------------------------------------------------------
// RLOO
// ---------------------------------------------------------------------------

export function runOptimisation() {
  const store = getStore()
  const result = optimiseWeights(store.decisions, store.weights)
  if (result.updated) {
    store.weights = result.weights
    store.weightHistory.unshift({
      at: new Date().toISOString(),
      weights: result.weights,
      samples: result.samples,
    })
    store.weightHistory = store.weightHistory.slice(0, 20)
    store.emit({
      type: 'WEIGHTS_UPDATED',
      signal_id: null,
      brand_id: null,
      summary: `RLOO update from ${result.samples} outcomes — w1 ${result.weights.w1.toFixed(3)}, w2 ${result.weights.w2.toFixed(3)}, w3 ${result.weights.w3.toFixed(3)}.`,
      payload: { ...result.weights, samples: result.samples },
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface EngineMetrics {
  total_decisions: number
  refused: number
  auto_dispatched: number
  hitl_raised: number
  refusal_rate: number
  automation_rate: number
  avg_cycle_ms: number
  p95_cycle_ms: number
  sla_target_ms: number
  sla_compliance: number
  spend_protected_usd: number
  spend_deployed_usd: number
  pending_interrupts: number
  outcomes_recorded: number
  avg_reward: number
  avg_sales_lift: number
  weights: { w1: number; w2: number; w3: number }
  weight_samples: number
  reasoning_mode: string
  model_configured: boolean
  mining: RefusalMining
  brands: Array<{
    brand_id: string
    name: string
    colour: string
    evaluated: number
    approved: number
    refused: number
    avg_fit: number
  }>
}

export function getMetrics(): EngineMetrics {
  const store = getStore()
  store.sweepExpired()

  const records = store.decisions
  const total = records.length
  const refused = records.filter((r) => r.decision === 'REFUSE')
  const auto = records.filter((r) => r.decision === 'AUTO_DISPATCH')
  const hitl = records.filter((r) => r.decision === 'HITL_INTERRUPT')

  const cycles = records.map((r) => r.cycle_ms).sort((a, b) => a - b)
  const avgCycle = cycles.length
    ? cycles.reduce((a, b) => a + b, 0) / cycles.length
    : 0
  const p95 = cycles.length ? cycles[Math.min(cycles.length - 1, Math.floor(cycles.length * 0.95))] : 0
  const withinSla = records.filter((r) => r.cycle_ms <= SLA.TARGET_MS).length

  const outcomes = records.filter((r) => r.outcome !== null)
  const avgReward = outcomes.length
    ? outcomes.reduce((a, r) => a + r.outcome!.reward, 0) / outcomes.length
    : 0
  const avgLift = outcomes.length
    ? outcomes.reduce((a, r) => a + r.outcome!.sales_lift_pct, 0) / outcomes.length
    : 0

  const deployed = records
    .filter((r) => r.decision === 'AUTO_DISPATCH' || r.approval_status === 'APPROVED')
    .reduce((a, r) => a + r.budget_usd, 0)

  const brandRows = new Map<
    string,
    { evaluated: number; approved: number; refused: number; fitSum: number }
  >()
  for (const record of records) {
    const row = brandRows.get(record.brand_id) ?? {
      evaluated: 0,
      approved: 0,
      refused: 0,
      fitSum: 0,
    }
    row.evaluated++
    row.fitSum += record.scores.brand_fit
    if (record.decision === 'REFUSE') row.refused++
    if (record.decision === 'AUTO_DISPATCH' || record.approval_status === 'APPROVED') {
      row.approved++
    }
    brandRows.set(record.brand_id, row)
  }

  const provider = resolveProvider()

  return {
    total_decisions: total,
    refused: refused.length,
    auto_dispatched: auto.length,
    hitl_raised: hitl.length,
    refusal_rate: total ? round(refused.length / total, 3) : 0,
    automation_rate: total ? round(auto.length / total, 3) : 0,
    avg_cycle_ms: Math.round(avgCycle),
    p95_cycle_ms: Math.round(p95),
    sla_target_ms: SLA.TARGET_MS,
    sla_compliance: total ? round(withinSla / total, 3) : 1,
    spend_protected_usd: refused.reduce((a, r) => a + r.budget_usd, 0),
    spend_deployed_usd: deployed,
    pending_interrupts: store.pendingInterrupts.length,
    outcomes_recorded: outcomes.length,
    avg_reward: round(avgReward, 3),
    avg_sales_lift: round(avgLift, 2),
    weights: store.weights,
    weight_samples: outcomes.length,
    reasoning_mode: provider.mode,
    model_configured: provider.configured,
    mining: mineRefusals(records),
    brands: Array.from(brandRows.entries())
      .map(([brandId, row]) => {
        const brand = getBrand(brandId)
        return {
          brand_id: brandId,
          name: brand.name,
          colour: brand.colour,
          evaluated: row.evaluated,
          approved: row.approved,
          refused: row.refused,
          avg_fit: round(row.fitSum / row.evaluated, 3),
        }
      })
      .sort((a, b) => b.evaluated - a.evaluated),
  }
}

export const ENGINE_CONSTANTS = {
  autoAbortMs: HITL.AUTO_ABORT_MS,
  slaTargetMs: SLA.TARGET_MS,
  benchmarkMs: SLA.BENCHMARK_MS,
  minRlooSamples: RLOO.MIN_SAMPLES,
}
