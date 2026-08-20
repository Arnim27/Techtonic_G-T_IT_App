import { NextResponse } from 'next/server'
import { getStore } from '@/lib/crme/store/decision-store'
import { seedIfEmpty } from '@/lib/crme/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Clears the decision record store and re-seeds a fresh demo history. */
export async function POST() {
  const store = getStore()
  store.reset()
  await seedIfEmpty()
  return NextResponse.json({ ok: true, decisions: store.decisions.length })
}
