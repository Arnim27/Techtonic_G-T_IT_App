import { NextResponse } from 'next/server'
import { getStore } from '@/lib/crme/store/decision-store'
import { runOptimisation } from '@/lib/crme/engine'
import { simulateOutcome } from '@/lib/crme/store/rloo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Runs one RLOO policy-optimisation pass.
 *
 * Before optimising, any dispatched campaign still missing an outcome has one
 * attributed — this stands in for the nightly SAP POS and DSP conversion
 * feeds that would populate the reward column in production.
 */
export async function POST() {
  const store = getStore()

  let attributed = 0
  for (const record of store.decisions) {
    const dispatched =
      record.decision === 'AUTO_DISPATCH' || record.approval_status === 'APPROVED'
    if (dispatched && !record.outcome) {
      store.recordOutcome(record.signal_id, simulateOutcome(record))
      attributed++
    }
  }

  const result = runOptimisation()

  return NextResponse.json({
    ok: true,
    attributed,
    ...result,
    history: store.weightHistory,
  })
}
