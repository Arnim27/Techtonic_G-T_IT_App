import { NextResponse } from 'next/server'
import { getStore } from '@/lib/crme/store/decision-store'
import { resolveHitl } from '@/lib/crme/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Pending approval cards, newest first, with expired ones already swept. */
export async function GET() {
  const store = getStore()
  return NextResponse.json({
    pending: store.pendingInterrupts,
    resolved: store.interrupts.filter((i) => i.status !== 'PENDING').slice(0, 30),
  })
}

interface ResolveBody {
  signal_id?: string
  approve?: boolean
  reviewer?: string
  note?: string
}

/**
 * Resumes a frozen graph. The reviewer's note is retained deliberately: an
 * explicit human rejection is the highest-value row in the decision record
 * store, and the note is what refusal-pattern mining eventually learns from.
 */
export async function POST(request: Request) {
  let body: ResolveBody
  try {
    body = (await request.json()) as ResolveBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.signal_id) {
    return NextResponse.json({ ok: false, error: 'signal_id is required' }, { status: 400 })
  }
  if (typeof body.approve !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'approve must be a boolean' },
      { status: 400 },
    )
  }

  const { interrupt } = resolveHitl(
    body.signal_id,
    body.approve,
    body.reviewer?.trim() || 'brand-manager',
    body.note?.trim() || undefined,
  )

  if (!interrupt) {
    return NextResponse.json(
      { ok: false, error: 'No interrupt found for that signal' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, interrupt })
}
