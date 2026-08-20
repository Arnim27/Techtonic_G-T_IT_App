import { NextResponse } from 'next/server'
import { getStore } from '@/lib/crme/store/decision-store'
import { ENGINE_CONSTANTS, getMetrics, seedIfEmpty } from '@/lib/crme/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Single poll endpoint for the operations console.
 *
 * The client passes the highest event sequence number it has already seen and
 * receives everything after it, plus a fresh metrics snapshot. One request per
 * tick keeps the console consistent — a split feed can show a decision before
 * the metrics that counted it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const cursor = Number(url.searchParams.get('cursor') ?? '0')
  const decisionLimit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('limit') ?? '24')),
  )

  await seedIfEmpty()

  const store = getStore()
  store.sweepExpired()

  return NextResponse.json({
    cursor: store.latestSeq,
    booted_at: store.bootedAt,
    events: Number.isFinite(cursor) ? store.eventsSince(cursor) : store.events,
    metrics: getMetrics(),
    pending: store.pendingInterrupts,
    decisions: store.decisions.slice(0, decisionLimit).map((record) => ({
      record_id: record.record_id,
      signal_id: record.signal_id,
      brand_id: record.brand_id,
      decision: record.decision,
      approval_status: record.approval_status,
      headline: record.headline,
      category: record.category,
      market: record.market,
      budget_usd: record.budget_usd,
      cycle_ms: record.cycle_ms,
      scores: record.scores,
      refusal_reasons: record.refusal_reasons,
      reasoning_mode: record.reasoning_mode,
      created_at: record.created_at,
      outcome: record.outcome,
    })),
    weights: store.weights,
    weight_history: store.weightHistory,
    constants: ENGINE_CONSTANTS,
  })
}
