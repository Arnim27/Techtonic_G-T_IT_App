import { NextResponse } from 'next/server'
import {
  LIFECYCLE_STAGES,
  SCORING_MATRIX,
  computeWeightedScore,
} from '@/lib/crme/seed/lifecycle'
import { BRANDS } from '@/lib/crme/seed/brands'
import { FINANCIALS, ROADMAP, REFUSAL_THRESHOLDS, AUTO_DISPATCH, HITL, SLA } from '@/lib/crme/config'

export const runtime = 'nodejs'

/**
 * Static architecture reference: the lifecycle ranking matrix, brand registry,
 * financial model, roadmap and the governance thresholds themselves.
 *
 * Exposing the thresholds over the API is intentional — a governance control
 * nobody can read is not a control.
 */
export async function GET() {
  return NextResponse.json({
    scoring_matrix: SCORING_MATRIX,
    stages: LIFECYCLE_STAGES.map((stage) => ({
      ...stage,
      // Recomputed from the 5-variable matrix rather than asserted.
      derived_score: computeWeightedScore(stage),
    })),
    brands: BRANDS.map((brand) => ({
      brand_id: brand.brand_id,
      name: brand.name,
      business_group: brand.business_group,
      pillars: brand.pillars,
      permitted_categories: brand.permitted_categories,
      forbidden_territory: brand.forbidden_territory,
      primary_sku: brand.primary_sku,
      colour: brand.colour,
      lifecycle_stage: brand.lifecycle_stage,
      market: brand.market,
    })),
    financials: FINANCIALS,
    roadmap: ROADMAP,
    thresholds: {
      refusal: REFUSAL_THRESHOLDS,
      auto_dispatch: AUTO_DISPATCH,
      hitl: HITL,
      sla: SLA,
    },
  })
}
