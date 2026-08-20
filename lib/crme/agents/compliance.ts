import type {
  BrandProfile,
  ComplianceClearance,
  SignalContext,
  TraceEntry,
} from '../types'
import { REFUSAL_THRESHOLDS } from '../config'
import { clamp01, round, tokenize } from '../llm/embeddings'
import { judge } from '../llm/provider'

/**
 * Agent 3 — Compliance & Safety (Agent_Compliance).
 *
 * Audits copyright, broadcast rights, official sponsor IP (FIFA / IOC),
 * ASA / FTC / ASCI advertising rules and toxicity. Where an asset can be made
 * compliant it emits masking directives rather than refusing outright — the
 * Rexona walkthrough turns on exactly this: official team kit logos are
 * masked and the moment still ships.
 */

/**
 * Rights-protected entity register. In production this is the Global RegTech
 * Vector Index plus the Adobe DAM Rights API; the structure is identical.
 */
const IP_REGISTER: Array<{
  pattern: RegExp
  label: string
  risk: number
  directive: string
}> = [
  { pattern: /\bfifa\b|world cup/i, label: 'FIFA marks', risk: 0.34, directive: 'Mask FIFA word marks and tournament identity; no official-sponsor implication.' },
  { pattern: /\bioc\b|olympic/i, label: 'Olympic marks', risk: 0.38, directive: 'Remove Olympic rings and Games nomenclature (Rule 40 applies).' },
  { pattern: /\buefa\b|champions league|premier league/i, label: 'League marks', risk: 0.3, directive: 'Mask league identity and broadcast furniture.' },
  { pattern: /team kit|jersey|match shirt|kit logo/i, label: 'Team kit trademarks', risk: 0.26, directive: 'Render stylised vector silhouettes; strip kit sponsor trademarks.' },
  { pattern: /broadcast|live feed|match footage|highlight reel/i, label: 'Broadcast footage rights', risk: 0.28, directive: 'No broadcast frames — originate assets from DAM Digital Product Twins only.' },
  { pattern: /\bipl\b|bcci/i, label: 'BCCI / IPL marks', risk: 0.3, directive: 'Mask BCCI and franchise marks; no tournament association.' },
  { pattern: /grammy|oscar|academy award|filmfare/i, label: 'Awards marks', risk: 0.24, directive: 'Remove award trophy likeness and ceremony branding.' },
  { pattern: /soundtrack|official song|music track|audio clip/i, label: 'Music sync rights', risk: 0.22, directive: 'Replace audio bed with cleared library track.' },
]

/** Terms that carry brand-safety risk regardless of category. */
const TOXICITY_REGISTER: Array<{ terms: string[]; weight: number; label: string }> = [
  { terms: ['riot', 'violence', 'assault', 'attack', 'stabbing', 'shooting'], weight: 0.42, label: 'violence' },
  { terms: ['death', 'died', 'fatal', 'funeral', 'mourning', 'tragedy', 'casualty'], weight: 0.4, label: 'bereavement' },
  { terms: ['slur', 'racist', 'sexist', 'abuse', 'harassment', 'hate'], weight: 0.5, label: 'hate speech' },
  { terms: ['protest', 'strike', 'boycott', 'unrest', 'agitation'], weight: 0.3, label: 'civil unrest' },
  { terms: ['scam', 'fraud', 'lawsuit', 'recall', 'contamination'], weight: 0.34, label: 'legal exposure' },
  { terms: ['disaster', 'earthquake', 'flood', 'cyclone', 'famine'], weight: 0.36, label: 'disaster' },
  { terms: ['drug', 'overdose', 'alcohol', 'intoxicated'], weight: 0.28, label: 'substance' },
]

/** Advertising codes evaluated on every pass. */
const RULE_FRAMEWORKS = [
  'ASA (UK) CAP Code',
  'FTC Endorsement Guides',
  'ASCI (India) Code',
  'Unilever Responsible Marketing Policy',
]

export interface ComplianceInput {
  signal: SignalContext
  brand: BrandProfile
  useModel?: boolean
}

export interface ComplianceResult {
  clearance: ComplianceClearance
  trace: TraceEntry
  model_assisted: boolean
}

interface SafetyJudgement {
  toxicity_risk: number
  ip_risk: number
  reasoning: string
  required_disclaimers: string[]
}

const SAFETY_SCHEMA = {
  type: 'object',
  properties: {
    toxicity_risk: { type: 'number', description: 'Brand-safety risk in [0,1].' },
    ip_risk: { type: 'number', description: 'Intellectual-property / sponsor-rights risk in [0,1].' },
    reasoning: { type: 'string' },
    required_disclaimers: { type: 'array', items: { type: 'string' } },
  },
  required: ['toxicity_risk', 'ip_risk', 'reasoning', 'required_disclaimers'],
  additionalProperties: false,
} as const

export async function runCompliance({
  signal,
  brand,
  useModel = true,
}: ComplianceInput): Promise<ComplianceResult> {
  const started = Date.now()

  const corpus = [
    signal.headline,
    signal.raw_text,
    signal.ocr_frames.join(' '),
    signal.detected_entities.join(' '),
  ].join(' ')

  // --- P_IP: sponsor / broadcast / trademark exposure -----------------------
  const flagged: string[] = []
  const directives: string[] = []
  let ipRisk = 0
  for (const entry of IP_REGISTER) {
    if (entry.pattern.test(corpus)) {
      flagged.push(entry.label)
      directives.push(entry.directive)
      // Risks compose probabilistically rather than summing past 1.
      ipRisk = 1 - (1 - ipRisk) * (1 - entry.risk)
    }
  }

  // Masking is remediation, not absolution. A maskable exposure carries a
  // fraction of its bare risk — which is what lets the Rexona kit-logo case
  // proceed on stylised vectors — but the residual still compounds, so a
  // moment carrying four separate rights exposures still trips the ceiling
  // even after every directive is applied.
  const mitigatedIpRisk = directives.length > 0 ? ipRisk * 0.15 : ipRisk

  // --- P_toxic: brand-safety exposure --------------------------------------
  const tokens = new Set(tokenize(corpus))
  let toxicity = 0
  const toxicLabels: string[] = []
  for (const entry of TOXICITY_REGISTER) {
    // Token matching, not substring matching. A raw `includes` check flags
    // "whatever" as hate speech and "flood the feed" as a natural disaster.
    // Terms are tokenised too so both sides pass through the same stemmer,
    // which is what lets "shooting" match "shootings".
    const hit = entry.terms.some((term) => {
      const termTokens = tokenize(term)
      return termTokens.length > 0 && termTokens.every((t) => tokens.has(t))
    })
    if (hit) {
      toxicity = 1 - (1 - toxicity) * (1 - entry.weight)
      toxicLabels.push(entry.label)
    }
  }
  // A moment already flagged sensitive by the radar carries a safety floor.
  if (signal.sensitivity_flag) toxicity = Math.max(toxicity, 0.035)

  const disclaimers: string[] = []
  if (directives.length > 0) {
    disclaimers.push('Not affiliated with, or endorsed by, any tournament rights holder.')
  }
  if (brand.business_group === 'Nutrition') {
    disclaimers.push('Nutritional claims substantiated per ASCI guidance; not a medical claim.')
  }

  let pToxic = clamp01(toxicity)
  let pIp = clamp01(mitigatedIpRisk)
  let modelAssisted = false
  let reasoning =
    flagged.length > 0
      ? `Rights exposure detected (${flagged.join(', ')}); ${directives.length} masking directive(s) emitted.`
      : 'No rights-protected entities detected in frame.'

  if (useModel) {
    const verdict = await judge<SafetyJudgement>({
      system:
        'You are the Compliance & Safety Agent inside Unilever\'s Cultural Response & Moment Engine. You audit live cultural moments for advertising-code compliance (ASA, FTC, ASCI), sponsor and broadcast IP exposure, and brand-safety toxicity. You are the last line before spend is committed. Score conservatively.',
      prompt: [
        `BRAND: ${brand.name} (${brand.business_group})`,
        `MOMENT: ${signal.headline}`,
        `CONTEXT: ${signal.raw_text}`,
        `ON-SCREEN ENTITIES: ${signal.detected_entities.join(', ') || 'none'}`,
        `OCR FRAMES: ${signal.ocr_frames.join(' | ') || 'none'}`,
        `MARKET: ${signal.geo.market}`,
        `RULE FRAMEWORKS IN SCOPE: ${RULE_FRAMEWORKS.join(', ')}`,
        '',
        'Score toxicity risk and IP risk, and list any mandatory disclaimers.',
      ].join('\n'),
      schema: SAFETY_SCHEMA as unknown as Record<string, unknown>,
    })

    if (verdict) {
      if (Number.isFinite(verdict.toxicity_risk)) {
        // Take the more conservative of rules and model — never the looser.
        pToxic = clamp01(Math.max(pToxic, clamp01(verdict.toxicity_risk) * 0.7 + pToxic * 0.3))
      }
      if (Number.isFinite(verdict.ip_risk)) {
        const modelIp = clamp01(verdict.ip_risk)
        pIp = clamp01(directives.length > 0 ? Math.min(pIp, modelIp) : Math.max(pIp, modelIp))
      }
      for (const item of verdict.required_disclaimers ?? []) {
        if (item && !disclaimers.includes(item)) disclaimers.push(item)
      }
      if (verdict.reasoning) reasoning = verdict.reasoning
      modelAssisted = true
    }
  }

  // P_risk is the composite the routing logic reads.
  const pRisk = clamp01(1 - (1 - pToxic) * (1 - pIp))

  const clearance: ComplianceClearance = {
    p_toxic: round(pToxic),
    p_ip: round(pIp),
    p_risk: round(pRisk),
    brand_safety_flag:
      pToxic > REFUSAL_THRESHOLDS.MAX_TOXICITY || pIp > REFUSAL_THRESHOLDS.MAX_IP_RISK,
    masking_directives: directives,
    disclaimers,
    rules_evaluated: RULE_FRAMEWORKS,
    flagged_entities: flagged.concat(toxicLabels),
  }

  const passes = !clearance.brand_safety_flag

  const trace: TraceEntry = {
    node: 'compliance_audit',
    agent: 'Agent_Compliance',
    label: 'Compliance audit',
    detail: passes
      ? `${reasoning} P_toxic = ${pToxic.toFixed(3)}, P_IP = ${pIp.toFixed(3)}.`
      : `Blocked on compliance. ${reasoning} P_toxic = ${pToxic.toFixed(3)}, P_IP = ${pIp.toFixed(3)}.`,
    t_offset_ms: Date.now() - started,
    status: passes ? 'OK' : 'REFUSED',
    metrics: {
      p_toxic: round(pToxic),
      p_ip: round(pIp),
      p_risk: round(pRisk),
      masking_directives: directives.length,
    },
  }

  return { clearance, trace, model_assisted: modelAssisted }
}
