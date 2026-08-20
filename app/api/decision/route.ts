import { NextResponse } from 'next/server'
import { getStore } from '@/lib/crme/store/decision-store'
import { getBrand } from '@/lib/crme/seed/brands'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Full audit record for one decision: every agent's trace, the clauses that
 * fired, the weights in force at the time, and the outcome if one landed.
 *
 * This is the artefact a regulator or a brand director actually asks for —
 * not "the AI decided", but which threshold, on which evidence, under which
 * policy version.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const signalId = url.searchParams.get('signal_id')

  if (!signalId) {
    return NextResponse.json(
      { ok: false, error: 'signal_id query parameter is required' },
      { status: 400 },
    )
  }

  const store = getStore()
  const record = store.findRecord(signalId)

  if (!record) {
    return NextResponse.json({ ok: false, error: 'Decision not found' }, { status: 404 })
  }

  const brand = getBrand(record.brand_id)
  const interrupt = store.interrupts.find((i) => i.signal_id === signalId) ?? null

  return NextResponse.json({
    ok: true,
    record,
    interrupt,
    brand: {
      brand_id: brand.brand_id,
      name: brand.name,
      colour: brand.colour,
      pillars: brand.pillars,
      business_group: brand.business_group,
    },
  })
}
