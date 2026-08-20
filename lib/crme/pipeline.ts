import { END, StateGraph, interrupt } from './graph'
import type { CompiledGraph, RunResult } from './graph'
import {
  AUTO_DISPATCH,
  DEFAULT_WEIGHTS,
  HITL,
  REFUSAL_THRESHOLDS,
} from './config'
import type { Weights } from './config'
import type {
  BrandProfile,
  Decision,
  HitlInterrupt,
  OrchestrationOutput,
  ProjectNextState,
  RefusalReason,
  SignalContext,
  TraceEntry,
} from './types'
import { getBrand } from './seed/brands'
import { runCulturalRadar } from './agents/cultural-radar'
import { runBrandDnai } from './agents/brand-dnai'
import { runCompliance } from './agents/compliance'
import { runCommerceGate } from './agents/commerce-gate'
import { runOrchestrator } from './agents/orchestrator'
import { resolveProvider } from './llm/provider'

/**
 * The Project NEXT orchestration graph.
 *
 * Node order is not cosmetic — it is the cost model. Brand fit is evaluated
 * before compliance, compliance before inventory, and inventory before any
 * creative is rendered, so the cheapest refusal always fires first and no
 * asset is ever produced for a moment that was going to be declined anyway.
 *
 *   cultural_radar
 *        ↓
 *   evaluate_brand_dna ──(C_fit < 0.65 ∨ R_cringe > 0.40)──► terminate_refusal
 *        ↓
 *   compliance_audit ───(P_toxic > 0.05 ∨ P_IP > 0.10)─────► terminate_refusal
 *        ↓
 *   commerce_gate ──────(I_stock < 2,000)───────────────────► terminate_refusal
 *        ↓
 *   orchestrate
 *        ↓
 *   route_decision ──► auto_dispatch | hitl_gate (interrupt)
 */

// ---------------------------------------------------------------------------
// Refusal gate — G_Refusal
// ---------------------------------------------------------------------------

export interface GateInputs {
  c_fit?: number
  r_cringe?: number
  i_stock?: number
  p_toxic?: number
  p_ip?: number
  signal_age_hours?: number
}

/**
 * Evaluates every clause of the deterministic refusal gate for which an input
 * is available:
 *
 *   G_Refusal = (C_fit < 0.65) ∨ (R_cringe > 0.40) ∨ (I_stock < 2,000)
 *             ∨ (P_toxic > 0.05) ∨ (P_IP > 0.10) ∨ (Δt_signal > 48 hrs)
 */
export function evaluateRefusalGate(inputs: GateInputs): RefusalReason[] {
  const reasons: RefusalReason[] = []
  const t = REFUSAL_THRESHOLDS

  if (inputs.signal_age_hours !== undefined && inputs.signal_age_hours > t.MAX_SIGNAL_AGE_HOURS) {
    reasons.push({
      code: 'SIGNAL_DECAYED',
      clause: `Δt_signal ${inputs.signal_age_hours.toFixed(1)}h > ${t.MAX_SIGNAL_AGE_HOURS}h`,
      observed: inputs.signal_age_hours,
      threshold: t.MAX_SIGNAL_AGE_HOURS,
      agent: 'Agent_Sensing',
    })
  }
  if (inputs.c_fit !== undefined && inputs.c_fit < t.MIN_BRAND_FIT) {
    reasons.push({
      code: 'BRAND_FIT_BELOW_FLOOR',
      clause: `C_fit ${inputs.c_fit.toFixed(2)} < ${t.MIN_BRAND_FIT}`,
      observed: inputs.c_fit,
      threshold: t.MIN_BRAND_FIT,
      agent: 'Agent_BrandDNA',
    })
  }
  if (inputs.r_cringe !== undefined && inputs.r_cringe > t.MAX_CRINGE) {
    reasons.push({
      code: 'CRINGE_HAZARD_EXCEEDED',
      clause: `R_cringe ${inputs.r_cringe.toFixed(2)} > ${t.MAX_CRINGE}`,
      observed: inputs.r_cringe,
      threshold: t.MAX_CRINGE,
      agent: 'Agent_BrandDNA',
    })
  }
  if (inputs.p_toxic !== undefined && inputs.p_toxic > t.MAX_TOXICITY) {
    reasons.push({
      code: 'TOXICITY_EXCEEDED',
      clause: `P_toxic ${inputs.p_toxic.toFixed(3)} > ${t.MAX_TOXICITY}`,
      observed: inputs.p_toxic,
      threshold: t.MAX_TOXICITY,
      agent: 'Agent_Compliance',
    })
  }
  if (inputs.p_ip !== undefined && inputs.p_ip > t.MAX_IP_RISK) {
    reasons.push({
      code: 'IP_RISK_EXCEEDED',
      clause: `P_IP ${inputs.p_ip.toFixed(3)} > ${t.MAX_IP_RISK}`,
      observed: inputs.p_ip,
      threshold: t.MAX_IP_RISK,
      agent: 'Agent_Compliance',
    })
  }
  if (inputs.i_stock !== undefined && inputs.i_stock < t.MIN_INVENTORY_UNITS) {
    reasons.push({
      code: 'INVENTORY_BELOW_FLOOR',
      clause: `I_stock ${inputs.i_stock.toLocaleString()} < ${t.MIN_INVENTORY_UNITS.toLocaleString()}`,
      observed: inputs.i_stock,
      threshold: t.MIN_INVENTORY_UNITS,
      agent: 'Agent_OpsInventory',
    })
  }

  return reasons
}

/**
 * Routing decision once every gate has cleared.
 *
 *   PATH A (auto):  C_fit ≥ 0.85 ∧ P_risk ≤ 0.02 ∧ Budget < $10,000
 *   PATH B (HITL):  Budget ≥ $10,000 ∨ Sensitivity_Flag ∨ anything short of PATH A
 *
 * Anything that clears refusal but does not fully satisfy PATH A goes to a
 * human. The system's default posture is to ask, not to assume.
 */
export function routeDecision(
  state: ProjectNextState,
): 'terminate_refusal' | 'hitl_gate' | 'auto_dispatch' {
  if (state.g_refusal) return 'terminate_refusal'

  const qualifiesForAuto =
    state.brand_fit_score >= AUTO_DISPATCH.MIN_BRAND_FIT &&
    state.risk_score <= AUTO_DISPATCH.MAX_RISK &&
    state.budget < AUTO_DISPATCH.MAX_BUDGET_USD &&
    !state.signal_data.sensitivity_flag

  return qualifiesForAuto ? 'auto_dispatch' : 'hitl_gate'
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  weights?: Weights
  useModel?: boolean
  /** Forces the SAP connector to report a stock-out (demo / test path). */
  forceStockOut?: boolean
}

function initialState(
  signal: SignalContext,
  brand: BrandProfile,
): ProjectNextState {
  return {
    signal_id: signal.signal_id,
    signal_data: signal,
    brand_fit_score: 0,
    risk_score: 0,
    geo_inventory_cleared: false,
    budget: signal.proposed_budget_usd,
    brief_payload: null,
    approval_status: 'NOT_REQUIRED',
    brand_id: brand.brand_id,
    brand_fit: null,
    compliance: null,
    commercial: null,
    decision: null,
    refusal_reasons: [],
    trace: [],
    g_refusal: false,
    interrupt: null,
    reasoning_mode: 'DETERMINISTIC',
    started_at: new Date().toISOString(),
    completed_at: null,
    cycle_ms: 0,
  }
}

function withTrace(
  state: ProjectNextState,
  entry: TraceEntry,
): Pick<ProjectNextState, 'trace'> {
  return { trace: [...state.trace, entry] }
}

function refusalTrace(reasons: RefusalReason[], offset: number): TraceEntry {
  return {
    node: 'terminate_refusal',
    agent: 'graph',
    label: 'Refusal',
    detail: `G_Refusal = 1. ${reasons.map((r) => r.clause).join(' ∨ ')}. Terminal drop — no spend committed, decision logged.`,
    t_offset_ms: offset,
    status: 'REFUSED',
    metrics: { clauses_fired: reasons.length },
  }
}

export function buildGraph(
  options: PipelineOptions = {},
): CompiledGraph<ProjectNextState> {
  const { weights = DEFAULT_WEIGHTS, useModel = true, forceStockOut } = options
  const builder = new StateGraph<ProjectNextState>()

  // --- Node 1: Cultural Radar ----------------------------------------------
  builder.addNode('cultural_radar', (state) => {
    const assessment = runCulturalRadar(state.signal_data)
    const reasons = evaluateRefusalGate({
      signal_age_hours: assessment.signal.signal_age_hours,
    })
    return {
      signal_data: assessment.signal,
      refusal_reasons: [...state.refusal_reasons, ...reasons],
      g_refusal: state.g_refusal || reasons.length > 0,
      ...withTrace(state, assessment.trace),
    }
  })

  // --- Node 2: Brand DNAi Alignment ----------------------------------------
  builder.addNode('evaluate_brand_dna', async (state) => {
    const brand = getBrand(state.brand_id)
    const { vector, trace, model_assisted } = await runBrandDnai({
      signal: state.signal_data,
      brand,
      weights,
      useModel,
    })
    const reasons = evaluateRefusalGate({
      c_fit: vector.c_fit,
      r_cringe: vector.r_cringe,
    })
    return {
      brand_fit: vector,
      brand_fit_score: vector.c_fit,
      refusal_reasons: [...state.refusal_reasons, ...reasons],
      g_refusal: state.g_refusal || reasons.length > 0,
      reasoning_mode: model_assisted ? resolveProvider().mode : state.reasoning_mode,
      ...withTrace(state, trace),
    }
  })

  // --- Node 3: Compliance & Safety -----------------------------------------
  builder.addNode('compliance_audit', async (state) => {
    const brand = getBrand(state.brand_id)
    const { clearance, trace, model_assisted } = await runCompliance({
      signal: state.signal_data,
      brand,
      useModel,
    })
    const reasons = evaluateRefusalGate({
      p_toxic: clearance.p_toxic,
      p_ip: clearance.p_ip,
    })
    return {
      compliance: clearance,
      risk_score: clearance.p_risk,
      refusal_reasons: [...state.refusal_reasons, ...reasons],
      g_refusal: state.g_refusal || reasons.length > 0,
      reasoning_mode: model_assisted ? resolveProvider().mode : state.reasoning_mode,
      ...withTrace(state, trace),
    }
  })

  // --- Node 4: Supply & Commerce Gate --------------------------------------
  builder.addNode('commerce_gate', (state) => {
    const brand = getBrand(state.brand_id)
    const { payload, trace } = runCommerceGate({
      signal: state.signal_data,
      brand,
      forceStockOut,
    })
    const reasons = evaluateRefusalGate({ i_stock: payload.i_stock })
    return {
      commercial: payload,
      geo_inventory_cleared: payload.inventory_cleared,
      refusal_reasons: [...state.refusal_reasons, ...reasons],
      g_refusal: state.g_refusal || reasons.length > 0,
      ...withTrace(state, trace),
    }
  })

  // --- Node 5: Orchestration & Dispatch ------------------------------------
  builder.addNode('orchestrate', async (state) => {
    const brand = getBrand(state.brand_id)
    const { payload, trace, model_assisted } = await runOrchestrator({
      signal: state.signal_data,
      brand,
      brandFit: state.brand_fit!,
      compliance: state.compliance!,
      commercial: state.commercial!,
      useModel,
    })
    return {
      brief_payload: payload,
      reasoning_mode: model_assisted ? resolveProvider().mode : state.reasoning_mode,
      ...withTrace(state, trace),
    }
  })

  // --- Terminal: refusal ----------------------------------------------------
  builder.addNode('terminate_refusal', (state) => ({
    decision: 'REFUSE' as Decision,
    approval_status: 'NOT_REQUIRED' as const,
    completed_at: new Date().toISOString(),
    ...withTrace(
      state,
      refusalTrace(state.refusal_reasons, elapsed(state)),
    ),
  }))

  // --- Terminal: automated studio routing (PATH A) --------------------------
  builder.addNode('auto_dispatch', (state) => ({
    decision: 'AUTO_DISPATCH' as Decision,
    approval_status: 'NOT_REQUIRED' as const,
    completed_at: new Date().toISOString(),
    ...withTrace(state, {
      node: 'auto_dispatch',
      agent: 'Agent_Orchestrator',
      label: 'Programmatic buy',
      detail: `Dispatched to Sketch Pro and DSP APIs. Geo-fenced ad buy live across ${state.brief_payload?.geo_fenced_postal_codes.length ?? 0} postal areas with direct-to-cart fulfilment links.`,
      t_offset_ms: elapsed(state),
      status: 'OK',
      metrics: {
        budget_usd: state.budget,
        c_fit: state.brand_fit_score,
        p_risk: state.risk_score,
      },
    }),
  }))

  // --- HITL interrupt (PATH B) ---------------------------------------------
  builder.addNode('hitl_gate', (state) => {
    const now = Date.now()
    const payload: HitlInterrupt = {
      interrupt_id: `INT-${state.signal_id}`,
      signal_id: state.signal_id,
      brand_id: state.brand_id,
      reason: state.signal_data.sensitivity_flag
        ? 'Sensitivity flag raised — mandatory human review.'
        : state.budget >= HITL.BUDGET_TRIGGER_USD
          ? `Campaign budget $${state.budget.toLocaleString()} exceeds the $${HITL.BUDGET_TRIGGER_USD.toLocaleString()} automation ceiling.`
          : `Brand fit ${state.brand_fit_score.toFixed(2)} is below the ${AUTO_DISPATCH.MIN_BRAND_FIT} automation floor.`,
      brief: state.brief_payload!,
      fit: state.brand_fit_score,
      risk: state.risk_score,
      budget: state.budget,
      inventory_units: state.commercial?.i_stock ?? 0,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + HITL.AUTO_ABORT_MS).toISOString(),
      status: 'PENDING',
      resolved_at: null,
      resolved_by: null,
      reviewer_note: null,
    }

    // Freeze graph state and push an interactive card to the Brand Manager.
    // Execution does not continue past this line — `interrupt` returns never.
    return interrupt(payload)
  })

  // --- Edges ----------------------------------------------------------------
  builder.setEntryPoint('cultural_radar')

  builder.addConditionalEdges(
    'cultural_radar',
    (state) => (state.g_refusal ? 'refuse' : 'continue'),
    { refuse: 'terminate_refusal', continue: 'evaluate_brand_dna' },
  )
  builder.addConditionalEdges(
    'evaluate_brand_dna',
    (state) => (state.g_refusal ? 'refuse' : 'continue'),
    { refuse: 'terminate_refusal', continue: 'compliance_audit' },
  )
  builder.addConditionalEdges(
    'compliance_audit',
    (state) => (state.g_refusal ? 'refuse' : 'continue'),
    { refuse: 'terminate_refusal', continue: 'commerce_gate' },
  )
  builder.addConditionalEdges(
    'commerce_gate',
    (state) => (state.g_refusal ? 'refuse' : 'continue'),
    { refuse: 'terminate_refusal', continue: 'orchestrate' },
  )
  builder.addConditionalEdges('orchestrate', routeDecision, {
    terminate_refusal: 'terminate_refusal',
    hitl_gate: 'hitl_gate',
    auto_dispatch: 'auto_dispatch',
  })

  builder.addEdge('terminate_refusal', END)
  builder.addEdge('auto_dispatch', END)

  return builder.compile()
}

function elapsed(state: ProjectNextState): number {
  return Date.now() - new Date(state.started_at).getTime()
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface PipelineRun {
  state: ProjectNextState
  result: RunResult<ProjectNextState, HitlInterrupt>
  output: OrchestrationOutput
}

export async function runPipeline(
  signal: SignalContext,
  options: PipelineOptions = {},
): Promise<PipelineRun> {
  const brand = getBrand(signal.candidate_brand_id)
  const graph = buildGraph(options)
  const start = Date.now()

  const result = await graph.invoke<HitlInterrupt>(initialState(signal, brand))

  const state: ProjectNextState = {
    ...result.state,
    cycle_ms: Date.now() - start,
  }

  if (result.status === 'SUSPENDED' && result.interrupt) {
    state.decision = 'HITL_INTERRUPT'
    state.approval_status = 'PENDING'
    state.interrupt = result.interrupt
    state.trace = [
      ...state.trace,
      {
        node: 'hitl_gate',
        agent: 'Agent_Orchestrator',
        label: 'HITL interrupt',
        detail: `${result.interrupt.reason} Graph state frozen; interactive card pushed to the ${brand.name} brand manager. 15-minute auto-abort timer running.`,
        t_offset_ms: state.cycle_ms,
        status: 'SUSPENDED',
        metrics: {
          budget_usd: state.budget,
          c_fit: state.brand_fit_score,
          auto_abort_ms: HITL.AUTO_ABORT_MS,
        },
      },
    ]
  }

  if (result.status === 'ERROR') {
    // A graph fault is treated as a refusal. Failing open would let an
    // unvetted brief reach the market, which is the one outcome the system
    // exists to prevent.
    state.decision = 'REFUSE'
    state.g_refusal = true
    state.refusal_reasons = [
      ...state.refusal_reasons,
      {
        code: 'BRAND_FIT_BELOW_FLOOR',
        clause: `Graph fault: ${result.error ?? 'unknown'}`,
        observed: 0,
        threshold: REFUSAL_THRESHOLDS.MIN_BRAND_FIT,
        agent: 'Agent_BrandDNA',
      },
    ]
  }

  return { state, result, output: toOutput(state) }
}

/** Projects final state onto the mandatory output schema (Section 6). */
export function toOutput(state: ProjectNextState): OrchestrationOutput {
  const refusalReasoning = state.refusal_reasons.length
    ? state.refusal_reasons.map((r) => r.clause).join(' ∨ ')
    : null

  return {
    signal_id: state.signal_id,
    decision: state.decision ?? 'REFUSE',
    scores: {
      brand_fit: state.brand_fit?.c_fit ?? 0,
      cringe_risk: state.brand_fit?.r_cringe ?? 1,
      toxicity_risk: state.compliance?.p_toxic ?? 1,
      inventory_units: state.commercial?.i_stock ?? 0,
    },
    brand_assigned: state.brand_id,
    target_postal_codes: state.commercial?.in_stock_postal_codes ?? [],
    refusal_reasoning: refusalReasoning,
    orchestration_payload: state.brief_payload
      ? {
          headline: state.brief_payload.headline,
          dam_asset_twin_id: state.brief_payload.dam_asset_twin_id,
          dispatch_target: state.brief_payload.dispatch_target,
        }
      : null,
  }
}
