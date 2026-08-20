import type {
  BrandProfile,
  CommercialPayload,
  ComplianceClearance,
  CreativeVariant,
  DispatchPayload,
  DispatchTarget,
  SignalContext,
} from '../types'
import { createRng, rngPick } from '../rng'

/**
 * Adobe DAM + Sketch Pro + DSP connectors (simulated).
 *
 * Unilever's content *creation* problem is already solved — Digital Product
 * Twins, Sketch Pro studios and Beauty AI Studios are operational. So this
 * layer deliberately does not generate new creative from scratch: it selects
 * an existing approved Digital Product Twin from the DAM and renders localised
 * variants around it. Duplicating assets that already exist destroys value.
 */

const LOCALES = [
  { locale: 'en-IN', label: 'English (India)' },
  { locale: 'hi-IN', label: 'Hindi' },
  { locale: 'ta-IN', label: 'Tamil' },
  { locale: 'mr-IN', label: 'Marathi' },
  { locale: 'en-GB', label: 'English (UK)' },
  { locale: 'pt-BR', label: 'Portuguese (Brazil)' },
]

const ASPECT_RATIOS = ['9:16', '1:1', '16:9']

/** Resolves the approved Digital Product Twin for a brand's hero SKU. */
export function resolveAssetTwin(brand: BrandProfile, signal: SignalContext): string {
  const rng = createRng(`${brand.brand_id}:${signal.category}:dam`)
  const generation = 3 + Math.floor(rng() * 4)
  return `DAM-TWIN-${brand.brand_id.toUpperCase()}-${brand.primary_sku}-G${generation}`
}

export interface CreativeRequest {
  signal: SignalContext
  brand: BrandProfile
  compliance: ComplianceClearance
  commercial: CommercialPayload
  headline: string
  /** Number of localised variants to render. */
  variantCount?: number
}

/** Sketch Pro Design API — renders localised variants around an approved twin. */
export function renderVariants({
  signal,
  brand,
  compliance,
  commercial,
  headline,
  variantCount = 3,
}: CreativeRequest): CreativeVariant[] {
  const rng = createRng(`${signal.signal_id}:sketchpro`)
  const twin = resolveAssetTwin(brand, signal)
  const isIndia = signal.geo.country === 'IN'
  const pool = isIndia ? LOCALES.slice(0, 4) : LOCALES

  const chosen: typeof LOCALES = []
  for (let i = 0; i < Math.min(variantCount, pool.length); i++) {
    const candidate = pool[(i + Math.floor(rng() * pool.length)) % pool.length]
    if (!chosen.some((c) => c.locale === candidate.locale)) chosen.push(candidate)
  }
  // Guarantee the requested count even if the modulo walk collided.
  for (const locale of pool) {
    if (chosen.length >= variantCount) break
    if (!chosen.some((c) => c.locale === locale.locale)) chosen.push(locale)
  }

  return chosen.map((entry, index) => ({
    variant_id: `${signal.signal_id}-V${index + 1}`,
    locale: entry.locale,
    headline,
    body: `${brand.pillars[0]}. ${brand.name} — available now in ${commercial.in_stock_postal_codes.length} serviceable postal areas.`,
    dam_asset_twin_id: twin,
    aspect_ratio: rngPick(rng, ASPECT_RATIOS),
    masked_elements: compliance.masking_directives,
  }))
}

/** Assembles the executable brief handed to the dispatch layer. */
export function buildDispatchPayload(args: {
  signal: SignalContext
  brand: BrandProfile
  compliance: ComplianceClearance
  commercial: CommercialPayload
  headline: string
  target: DispatchTarget
}): DispatchPayload {
  const { signal, brand, compliance, commercial, headline, target } = args
  const variants = renderVariants({
    signal,
    brand,
    compliance,
    commercial,
    headline,
  })

  const brief = [
    `Moment: ${signal.headline}`,
    `Category: ${signal.category} · Market: ${signal.geo.market}`,
    `Brand permission: ${brand.pillars[0]}`,
    compliance.masking_directives.length
      ? `Mandatory masking: ${compliance.masking_directives.join('; ')}`
      : 'No masking directives required.',
    `Serviceable stock: ${commercial.i_stock.toLocaleString()} units across ${commercial.fulfilment_hubs.length} hubs.`,
  ].join('\n')

  return {
    headline,
    creative_brief: brief,
    variants,
    dam_asset_twin_id: resolveAssetTwin(brand, signal),
    dispatch_target: target,
    dsp_ad_feeds: buildDspFeeds(signal, brand, target),
    estimated_budget_usd: signal.proposed_budget_usd,
    geo_fenced_postal_codes: commercial.in_stock_postal_codes,
  }
}

/** Meta / TikTok / DV360 programmatic feeds. */
function buildDspFeeds(
  signal: SignalContext,
  brand: BrandProfile,
  target: DispatchTarget,
): string[] {
  if (target === 'CREATOR_NETWORK') {
    return [
      `creator-network://brief/${brand.brand_id}/${signal.signal_id}?cohort=50k`,
    ]
  }
  return [
    `meta://campaigns/${brand.brand_id}/${signal.signal_id}`,
    `tiktok://spark-ads/${brand.brand_id}/${signal.signal_id}`,
    `dv360://line-items/${brand.brand_id}/${signal.signal_id}`,
  ]
}
