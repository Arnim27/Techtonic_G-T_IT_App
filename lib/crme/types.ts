/**
 * Project NEXT — CRME (Cultural Response & Moment Engine)
 * Canonical state + payload contracts.
 *
 * These mirror the payload schema defined in the Project NEXT enterprise
 * technical architecture specification (Section 3: Multi-Agent System Topology).
 *
 *   Cultural Radar   -> SignalContext        (E_sig)
 *   Brand DNAi       -> BrandFitVector       (E_brand)
 *   Compliance       -> ComplianceClearance  (E_comp)
 *   Commerce Gate    -> CommercialPayload    (E_ops)
 *   Orchestration    -> DispatchPayload
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type SignalSource =
  | 'BROADCAST_OCR'
  | 'SOCIAL_FIREHOSE'
  | 'SEARCH_TRENDS'
  | 'CREATOR_NETWORK'
  | 'COMMERCE_TELEMETRY'

export type Decision = 'REFUSE' | 'HITL_INTERRUPT' | 'AUTO_DISPATCH'

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'ABORTED'
  | 'NOT_REQUIRED'

export type DispatchTarget = 'SKETCH_PRO' | 'CREATOR_NETWORK'

export type AgentId =
  | 'Agent_Sensing'
  | 'Agent_BrandDNA'
  | 'Agent_Compliance'
  | 'Agent_OpsInventory'
  | 'Agent_Orchestrator'

/**
 * Machine-readable refusal codes. Each maps 1:1 to a clause of the
 * deterministic refusal gate G_Refusal.
 */
export type RefusalCode =
  | 'BRAND_FIT_BELOW_FLOOR'
  | 'CRINGE_HAZARD_EXCEEDED'
  | 'INVENTORY_BELOW_FLOOR'
  | 'TOXICITY_EXCEEDED'
  | 'IP_RISK_EXCEEDED'
  | 'SIGNAL_DECAYED'

export interface RefusalReason {
  code: RefusalCode
  /** Human-readable clause, e.g. "C_fit 0.41 < 0.65". */
  clause: string
  observed: number
  threshold: number
  agent: AgentId
}

// ---------------------------------------------------------------------------
// 1. Cultural Radar Agent  ->  SignalContext (E_sig)
// ---------------------------------------------------------------------------

export interface SignalContext {
  signal_id: string
  /** ISO-8601 detection timestamp. */
  timestamp: string
  source: SignalSource
  /** Short human headline for the moment. */
  headline: string
  /** Raw multimodal text: captions, transcripts, post bodies. */
  raw_text: string
  /** Cultural category, e.g. "Athletic Exertion". */
  category: string
  geo: {
    market: string
    country: string
    postal_codes: string[]
  }
  /** V_t — engagement velocity in shares/minute. */
  engagement_velocity: number
  /** dE/dt — acceleration of engagement, the pre-peak detector. */
  velocity_delta: number
  /** Multimodal OCR context frames extracted from broadcast/video. */
  ocr_frames: string[]
  modalities: string[]
  /** Entities detected in-frame (teams, kit logos, personalities, IP). */
  detected_entities: string[]
  /** Δt_signal — hours elapsed since the cultural moment occurred. */
  signal_age_hours: number
  /** Flags moments requiring mandatory human review regardless of budget. */
  sensitivity_flag: boolean
  /** Candidate brand this signal was routed to. */
  candidate_brand_id: string
  /** Planned activation spend in USD. */
  proposed_budget_usd: number
}

// ---------------------------------------------------------------------------
// 2. Brand DNAi Alignment Agent  ->  BrandFitVector (E_brand)
// ---------------------------------------------------------------------------

export interface BrandFitVector {
  brand_id: string
  /** C_fit ∈ [0,1] — composite Brand Fit Index. */
  c_fit: number
  /** cos(E_sig, e_brand) — raw semantic similarity term. */
  cosine_similarity: number
  /** S_resonance — cultural resonance term. */
  s_resonance: number
  /** R_cringe — Cringe Hazard Index. */
  r_cringe: number
  /** Approved positioning statements the moment actually satisfied. */
  matched_brand_pillars: string[]
  /** Brand-lexicon terms found in the signal — evidence, not positioning. */
  matched_lexicon: string[]
  positioning_guidance: string
  /** Weight vector actually applied (RLOO-tunable). */
  weights_applied: { w1: number; w2: number; w3: number }
}

// ---------------------------------------------------------------------------
// 3. Compliance & Safety Agent  ->  ComplianceClearance (E_comp)
// ---------------------------------------------------------------------------

export interface ComplianceClearance {
  /** P_toxic — toxicity / brand-safety risk. */
  p_toxic: number
  /** P_IP — intellectual property & sponsor-rights risk. */
  p_ip: number
  /** Composite operational risk used for routing (P_risk). */
  p_risk: number
  brand_safety_flag: boolean
  masking_directives: string[]
  disclaimers: string[]
  /** Regulatory frameworks evaluated, e.g. ASA / FTC / ASCI. */
  rules_evaluated: string[]
  flagged_entities: string[]
}

// ---------------------------------------------------------------------------
// 4. Supply & Commerce Gate Agent  ->  CommercialPayload (E_ops)
// ---------------------------------------------------------------------------

export interface FulfilmentHub {
  hub_id: string
  city: string
  postal_code: string
  units: number
}

export interface CommercialPayload {
  /** I_stock — total available units across queried hubs. */
  i_stock: number
  sku_ids: string[]
  in_stock_postal_codes: string[]
  fulfilment_hubs: FulfilmentHub[]
  direct_to_cart_links: string[]
  /** True when I_stock clears the inventory floor. */
  inventory_cleared: boolean
}

// ---------------------------------------------------------------------------
// 5. Orchestration & Dispatch Agent  ->  DispatchPayload
// ---------------------------------------------------------------------------

export interface CreativeVariant {
  variant_id: string
  locale: string
  headline: string
  body: string
  /** Digital Product Twin referenced from Adobe DAM. */
  dam_asset_twin_id: string
  aspect_ratio: string
  masked_elements: string[]
}

export interface DispatchPayload {
  headline: string
  creative_brief: string
  variants: CreativeVariant[]
  dam_asset_twin_id: string
  dispatch_target: DispatchTarget
  dsp_ad_feeds: string[]
  estimated_budget_usd: number
  geo_fenced_postal_codes: string[]
}

// ---------------------------------------------------------------------------
// Graph state — mirrors ProjectNextState(TypedDict) from the specification
// ---------------------------------------------------------------------------

export interface TraceEntry {
  node: string
  agent: AgentId | 'router' | 'graph'
  label: string
  detail: string
  /** Milliseconds of simulated/actual wall-clock at this node. */
  t_offset_ms: number
  status: 'OK' | 'REFUSED' | 'SUSPENDED' | 'SKIPPED'
  metrics?: Record<string, number>
}

export interface ProjectNextState {
  // --- fields declared verbatim in the specification snippet ---
  signal_id: string
  signal_data: SignalContext
  brand_fit_score: number
  risk_score: number
  geo_inventory_cleared: boolean
  budget: number
  brief_payload: DispatchPayload | null
  approval_status: ApprovalStatus

  // --- extended production state ---
  brand_id: string
  brand_fit: BrandFitVector | null
  compliance: ComplianceClearance | null
  commercial: CommercialPayload | null
  decision: Decision | null
  refusal_reasons: RefusalReason[]
  trace: TraceEntry[]
  /** True when the deterministic refusal gate fired (G_Refusal == 1). */
  g_refusal: boolean
  /** Set when execution suspends at the HITL interrupt node. */
  interrupt: HitlInterrupt | null
  /** Which reasoning path produced the scores. */
  reasoning_mode: ReasoningMode
  started_at: string
  completed_at: string | null
  /** Total wall-clock of the decision cycle. */
  cycle_ms: number
}

export type ReasoningMode = 'DETERMINISTIC' | 'CLAUDE' | 'GEMINI'

// ---------------------------------------------------------------------------
// Human-in-the-Loop interrupt (Vertex AI `interrupt()` equivalent)
// ---------------------------------------------------------------------------

export interface HitlInterrupt {
  interrupt_id: string
  signal_id: string
  brand_id: string
  reason: string
  brief: DispatchPayload
  fit: number
  risk: number
  budget: number
  inventory_units: number
  created_at: string
  /** Auto-abort deadline — 15 minutes per specification. */
  expires_at: string
  status: ApprovalStatus
  resolved_at: string | null
  resolved_by: string | null
  /** Free-text edit captured for refusal-pattern mining. */
  reviewer_note: string | null
}

// ---------------------------------------------------------------------------
// Decision Record Store — the enterprise data moat
// ---------------------------------------------------------------------------

export interface DecisionRecord {
  record_id: string
  signal_id: string
  brand_id: string
  decision: Decision
  approval_status: ApprovalStatus
  scores: {
    brand_fit: number
    cringe_risk: number
    toxicity_risk: number
    ip_risk: number
    inventory_units: number
    cosine_similarity: number
    resonance: number
  }
  refusal_reasons: RefusalReason[]
  headline: string
  category: string
  market: string
  budget_usd: number
  cycle_ms: number
  reasoning_mode: ReasoningMode
  weights_applied: { w1: number; w2: number; w3: number }
  trace: TraceEntry[]
  created_at: string
  /** Post-campaign outcome piped back from SAP POS / DSP APIs. */
  outcome: CampaignOutcome | null
}

export interface CampaignOutcome {
  sales_lift_pct: number
  ctr: number
  conversion_rate: number
  impressions: number
  /** Reward signal in [0,1] used by the RLOO policy optimiser. */
  reward: number
  recorded_at: string
}

// ---------------------------------------------------------------------------
// Mandatory output schema (Section 6 of the specification)
// ---------------------------------------------------------------------------

export interface OrchestrationOutput {
  signal_id: string
  decision: Decision
  scores: {
    brand_fit: number
    cringe_risk: number
    toxicity_risk: number
    inventory_units: number
  }
  brand_assigned: string
  target_postal_codes: string[]
  refusal_reasoning: string | null
  orchestration_payload: {
    headline: string
    dam_asset_twin_id: string
    dispatch_target: DispatchTarget
  } | null
}

// ---------------------------------------------------------------------------
// Brand registry
// ---------------------------------------------------------------------------

export interface BrandProfile {
  brand_id: string
  name: string
  business_group:
    | 'Beauty & Wellbeing'
    | 'Personal Care'
    | 'Home Care'
    | 'Nutrition'
  /** Approved positioning statements — the Brand DNAi boundary. */
  pillars: string[]
  /** Lexicon that defines the brand's semantic centre. */
  lexicon: string[]
  /** Categories the brand has cultural permission to enter. */
  permitted_categories: string[]
  /** Territory the brand must never claim — drives R_cringe. */
  forbidden_territory: string[]
  primary_sku: string
  colour: string
  lifecycle_stage: string
  market: string
}
