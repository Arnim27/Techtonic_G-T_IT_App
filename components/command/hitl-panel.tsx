'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { HitlInterrupt } from '@/lib/crme/types'
import { brandColour, brandLabel, fmtCountdown, fmtMoney } from './format'

/**
 * Human-in-the-Loop approval inbox.
 *
 * Each card is a frozen graph. The countdown is the 15-minute auto-abort
 * timer from the specification: if nobody signs, the moment expires and the
 * graph terminates rather than shipping unsupervised.
 */
export function HitlPanel({
  pending,
  autoAbortMs,
  onResolve,
  busySignal,
}: {
  pending: HitlInterrupt[]
  autoAbortMs: number
  onResolve: (signalId: string, approve: boolean, note?: string) => void
  busySignal: string | null
}) {
  // A local 1s tick drives the countdown without re-fetching from the server.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (pending.length === 0) {
    return (
      <div className="con-empty">
        No briefs awaiting signature.
        <br />
        High-spend and sensitive moments will surface here.
      </div>
    )
  }

  return (
    <div style={{ padding: 13 }}>
      {pending.map((item) => (
        <HitlCard
          key={item.interrupt_id}
          item={item}
          now={now}
          autoAbortMs={autoAbortMs}
          onResolve={onResolve}
          busy={busySignal === item.signal_id}
        />
      ))}
    </div>
  )
}

function HitlCard({
  item,
  now,
  autoAbortMs,
  onResolve,
  busy,
}: {
  item: HitlInterrupt
  now: number
  autoAbortMs: number
  onResolve: (signalId: string, approve: boolean, note?: string) => void
  busy: boolean
}) {
  const [note, setNote] = useState('')

  const remaining = new Date(item.expires_at).getTime() - now
  const ratio = Math.max(0, Math.min(1, remaining / autoAbortMs))
  const urgent = remaining < 5 * 60_000
  const expired = remaining <= 0

  return (
    <article className="con-hitl">
      <div className="con-hitl-top">
        <span
          className="con-orb"
          style={{ background: brandColour(item.brand_id) }}
          aria-hidden="true"
        />
        <strong>{brandLabel(item.brand_id)}</strong>
        <span className={urgent ? 'urgent' : ''}>
          {expired ? 'EXPIRED' : fmtCountdown(remaining)}
        </span>
      </div>

      <div className="con-timer">
        <i className={urgent ? 'urgent' : ''} style={{ width: `${ratio * 100}%` }} />
      </div>

      <p>{item.brief.headline}</p>
      <div className="con-hitl-reason">{item.reason}</div>

      <div className="con-hitl-stats">
        <div>
          <small>Brand fit</small>
          <b style={{ color: item.fit >= 0.85 ? 'var(--con-ok)' : 'var(--con-warn)' }}>
            {item.fit.toFixed(2)}
          </b>
        </div>
        <div>
          <small>Risk</small>
          <b>{item.risk.toFixed(3)}</b>
        </div>
        <div>
          <small>Budget</small>
          <b>{fmtMoney(item.budget)}</b>
        </div>
      </div>

      <div className="con-hint">
        {item.inventory_units.toLocaleString()} units in stock ·{' '}
        {item.brief.variants.length} variants rendered ·{' '}
        {item.brief.geo_fenced_postal_codes.length} postal areas
        {item.brief.variants[0]?.masked_elements.length
          ? ` · masking: ${item.brief.variants[0].masked_elements.length} directive(s)`
          : ''}
      </div>

      <div className="con-field" style={{ marginBottom: 0 }}>
        <label htmlFor={`note-${item.interrupt_id}`}>Reviewer note (optional)</label>
        <input
          id={`note-${item.interrupt_id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this call? Feeds refusal-pattern mining."
          disabled={busy || expired}
        />
      </div>

      <div className="con-btn-row">
        <button
          className="con-btn ok"
          disabled={busy || expired}
          onClick={() => onResolve(item.signal_id, true, note || undefined)}
        >
          <Check size={12} /> Approve &amp; deploy
        </button>
        <button
          className="con-btn danger"
          disabled={busy || expired}
          onClick={() => onResolve(item.signal_id, false, note || undefined)}
        >
          <X size={12} /> Reject
        </button>
      </div>
    </article>
  )
}
