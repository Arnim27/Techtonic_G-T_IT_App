import type {
  BrandFitVector,
  BrandProfile,
  CommercialPayload,
  ComplianceClearance,
  DispatchPayload,
  DispatchTarget,
  SignalContext,
  TraceEntry,
} from '../types'
import { AUTO_DISPATCH } from '../config'
import { buildDispatchPayload } from '../connectors/creative'
import { judge } from '../llm/provider'

/**
 * Agent 5 — Orchestration & Dispatch (Agent_Orchestrator).
 *
 * Synthesises the cleared payload, renders dynamic variants via Sketch Pro,
 * evaluates spend limits and triggers either automated execution or the HITL
 * gate. This is the only agent permitted to author copy, and it may only do
 * so once every preceding gate has cleared.
 */

export interface OrchestrationInput {
  signal: SignalContext
  brand: BrandProfile
  brandFit: BrandFitVector
  compliance: ComplianceClearance
  commercial: CommercialPayload
  useModel?: boolean
}

export interface OrchestrationResult {
  payload: DispatchPayload
  trace: TraceEntry
  model_assisted: boolean
}

interface HeadlineDraft {
  headline: string
  rationale: string
}

const HEADLINE_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description:
        'Under 90 characters. Must connect the brand truth to the live moment without naming any rights-protected entity.',
    },
    rationale: { type: 'string' },
  },
  required: ['headline', 'rationale'],
  additionalProperties: false,
} as const

/**
 * Deterministic copy assembly — always available, always on-pillar.
 *
 * The line is built from an approved positioning statement, never from a
 * matched lexicon term: "…lipstick. Lakmé." is a keyword, not a claim the
 * brand has signed off.
 */
function deterministicHeadline(
  signal: SignalContext,
  brand: BrandProfile,
  brandFit: BrandFitVector,
): string {
  const pillar =
    brandFit.matched_brand_pillars.find((entry) => brand.pillars.includes(entry)) ??
    brand.pillars[0]
  const hook = signal.headline.replace(/[.\s]+$/, '')
  return `${hook} — ${pillar}. ${brand.name}.`
}

/** PATH A vs PATH B — spend and sensitivity decide who signs off. */
export function resolveDispatchTarget(signal: SignalContext): DispatchTarget {
  return signal.proposed_budget_usd >= AUTO_DISPATCH.MAX_BUDGET_USD
    ? 'CREATOR_NETWORK'
    : 'SKETCH_PRO'
}

export async function runOrchestrator({
  signal,
  brand,
  brandFit,
  compliance,
  commercial,
  useModel = true,
}: OrchestrationInput): Promise<OrchestrationResult> {
  const started = Date.now()

  let headline = deterministicHeadline(signal, brand, brandFit)
  let modelAssisted = false

  if (useModel) {
    const draft = await judge<HeadlineDraft>({
      system:
        'You are the Orchestration Agent inside Unilever\'s Cultural Response & Moment Engine. Every compliance and brand gate has already cleared. Write one short activation line that earns the brand\'s place in the moment. Never name a tournament, team, league, broadcaster or celebrity. Never make a medical claim. Stay inside the brand\'s approved positioning.',
      prompt: [
        `BRAND: ${brand.name}`,
        `APPROVED POSITIONING: ${brand.pillars.join(' | ')}`,
        `MATCHED PILLAR: ${brandFit.matched_brand_pillars[0] ?? brand.pillars[0]}`,
        `POSITIONING GUIDANCE: ${brandFit.positioning_guidance}`,
        `MOMENT: ${signal.headline}`,
        `CONTEXT: ${signal.raw_text}`,
        compliance.masking_directives.length
          ? `MASKING IN FORCE: ${compliance.masking_directives.join('; ')}`
          : 'No masking directives.',
        '',
        'Write the activation headline.',
      ].join('\n'),
      schema: HEADLINE_SCHEMA as unknown as Record<string, unknown>,
    })

    if (draft?.headline && draft.headline.trim().length > 0) {
      headline = draft.headline.trim()
      modelAssisted = true
    }
  }

  const target = resolveDispatchTarget(signal)
  const payload = buildDispatchPayload({
    signal,
    brand,
    compliance,
    commercial,
    headline,
    target,
  })

  const trace: TraceEntry = {
    node: 'orchestrate',
    agent: 'Agent_Orchestrator',
    label: 'Asset assembly',
    detail: `Sketch Pro rendered ${payload.variants.length} localised variants against twin ${payload.dam_asset_twin_id}. Geo-fenced to ${payload.geo_fenced_postal_codes.length} serviceable postal areas at $${signal.proposed_budget_usd.toLocaleString()}.`,
    t_offset_ms: Date.now() - started,
    status: 'OK',
    metrics: {
      variants: payload.variants.length,
      budget_usd: signal.proposed_budget_usd,
      postal_codes: payload.geo_fenced_postal_codes.length,
      dsp_feeds: payload.dsp_ad_feeds.length,
    },
  }

  return { payload, trace, model_assisted: modelAssisted }
}
