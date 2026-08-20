import { NextResponse } from 'next/server'
import { ingestNext, ingestSignal, runBenchmark } from '@/lib/crme/engine'
import { generateSignal } from '@/lib/crme/seed/signals'
import { getBrand } from '@/lib/crme/seed/brands'
import type { SignalContext } from '@/lib/crme/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IngestBody {
  /** 'next' pulls from the firehose, 'benchmark' replays the Rexona case. */
  mode?: 'next' | 'benchmark' | 'custom'
  /** How many firehose signals to pull in one call. */
  count?: number
  /** Free-text moment for `custom` mode. */
  headline?: string
  body?: string
  brand_id?: string
  budget_usd?: number
  market?: string
  category?: string
  velocity?: number
  force_stock_out?: boolean
}

/**
 * Runs one or more signals through the orchestration graph.
 *
 * `custom` lets an operator type a cultural moment in plain language and watch
 * the gates evaluate it — the fastest way to prove the system refuses things.
 */
export async function POST(request: Request) {
  let payload: IngestBody = {}
  try {
    payload = (await request.json()) as IngestBody
  } catch {
    payload = {}
  }

  const mode = payload.mode ?? 'next'

  try {
    if (mode === 'benchmark') {
      const result = await runBenchmark()
      return NextResponse.json({ ok: true, results: [summarise(result)] })
    }

    if (mode === 'custom') {
      const signal = buildCustomSignal(payload)
      const result = await ingestSignal(signal, {
        forceStockOut: payload.force_stock_out,
      })
      return NextResponse.json({ ok: true, results: [summarise(result)] })
    }

    const count = Math.min(8, Math.max(1, payload.count ?? 1))
    const results = []
    for (let i = 0; i < count; i++) {
      results.push(summarise(await ingestNext()))
    }
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ingest failed' },
      { status: 500 },
    )
  }
}

function summarise(result: Awaited<ReturnType<typeof ingestNext>>) {
  return {
    signal_id: result.state.signal_id,
    brand_id: result.state.brand_id,
    decision: result.state.decision,
    output: result.output,
    cycle_ms: result.state.cycle_ms,
    trace: result.state.trace,
    scores: {
      c_fit: result.state.brand_fit?.c_fit ?? 0,
      cosine_similarity: result.state.brand_fit?.cosine_similarity ?? 0,
      s_resonance: result.state.brand_fit?.s_resonance ?? 0,
      r_cringe: result.state.brand_fit?.r_cringe ?? 0,
      p_toxic: result.state.compliance?.p_toxic ?? 0,
      p_ip: result.state.compliance?.p_ip ?? 0,
      p_risk: result.state.risk_score,
      i_stock: result.state.commercial?.i_stock ?? 0,
    },
    refusal_reasons: result.state.refusal_reasons,
    brief: result.state.brief_payload,
    interrupt: result.interrupt,
    reasoning_mode: result.state.reasoning_mode,
  }
}

/** Builds a SignalContext from operator free text. */
function buildCustomSignal(payload: IngestBody): SignalContext {
  const template = generateSignal(Math.floor(Math.random() * 1000) + 5000)
  const brand = getBrand(payload.brand_id ?? 'rexona')
  const headline = (payload.headline ?? '').trim() || template.headline
  const body = (payload.body ?? '').trim() || headline

  return {
    ...template,
    signal_id: `SIG-OPS-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    headline,
    raw_text: body,
    category: payload.category?.trim() || template.category,
    geo: {
      ...template.geo,
      market: payload.market?.trim() || template.geo.market,
    },
    engagement_velocity: Number.isFinite(payload.velocity)
      ? Math.max(0, Number(payload.velocity))
      : template.engagement_velocity,
    velocity_delta: 2400,
    ocr_frames: [],
    detected_entities: [],
    signal_age_hours: 0.05,
    sensitivity_flag: false,
    candidate_brand_id: brand.brand_id,
    proposed_budget_usd: Number.isFinite(payload.budget_usd)
      ? Math.max(0, Number(payload.budget_usd))
      : template.proposed_budget_usd,
  }
}
