'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DecisionDetail } from '@/lib/crme/api-types'
import {
  VERDICT_LABEL,

  brandLabel,
  fmtDuration,
  fmtMoney,
  fmtTime,
} from './format'

/**
 * Full audit view for one decision.
 *
 * Everything a brand director or regulator would ask for: which clause fired,
 * on what evidence, under which policy weights, and what the agents actually
 * did — in order, with timings.
 */
export function DecisionDrawer({
  signalId,
  onClose,
}: {
  signalId: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<DecisionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)

    fetch(`/api/decision?signal_id=${encodeURIComponent(signalId)}`)
      .then((response) => response.json())
      .then((body: DecisionDetail & { error?: string }) => {
        if (cancelled) return
        if (body.ok) setDetail(body)
        else setError(body.error ?? 'Decision not found')
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the decision record')
      })

    return () => {
      cancelled = true
    }
  }, [signalId])

  // Close on Escape — an operator should never be trapped in a drawer.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const record = detail?.record

  return (
    <div
      className="con-detail"
      role="dialog"
      aria-modal="true"
      aria-label="Decision record"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="con-detail-panel">
        <div className="con-detail-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="con-section-label" style={{ marginBottom: 6 }}>
              {signalId}
              {detail ? ` · ${brandLabel(detail.brand.brand_id)}` : ''}
            </div>
            <h2>{record?.headline ?? 'Loading decision record…'}</h2>
          </div>
          {record && (
            <span className={`con-verdict ${record.decision}`}>
              {VERDICT_LABEL[record.decision] ?? record.decision}
            </span>
          )}
          <button className="con-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="con-detail-body">
          {error && <div className="con-empty">{error}</div>}
          {!detail && !error && <div className="con-empty">Loading audit trail…</div>}

          {record && detail && (
            <>
              {/* --- scores --- */}
              <section>
                <div className="con-section-label">Brand fit index</div>
                <div className="con-score-grid">
                  <Score
                    label="C_fit"
                    value={record.scores.brand_fit.toFixed(3)}
                    note={`floor 0.65 · auto 0.85`}
                    tone={record.scores.brand_fit >= 0.85 ? 'ok' : record.scores.brand_fit < 0.65 ? 'bad' : 'warn'}
                  />
                  <Score
                    label="R_cringe"
                    value={record.scores.cringe_risk.toFixed(3)}
                    note="ceiling 0.40"
                    tone={record.scores.cringe_risk > 0.4 ? 'bad' : 'ok'}
                  />
                  <Score
                    label="cos(E_sig, e_brand)"
                    value={record.scores.cosine_similarity.toFixed(3)}
                    note="semantic term"
                  />
                  <Score
                    label="S_resonance"
                    value={record.scores.resonance.toFixed(3)}
                    note="cultural term"
                  />
                  <Score
                    label="P_toxic"
                    value={record.scores.toxicity_risk.toFixed(3)}
                    note="ceiling 0.05"
                    tone={record.scores.toxicity_risk > 0.05 ? 'bad' : 'ok'}
                  />
                  <Score
                    label="P_IP"
                    value={record.scores.ip_risk.toFixed(3)}
                    note="ceiling 0.10"
                    tone={record.scores.ip_risk > 0.1 ? 'bad' : 'ok'}
                  />
                  <Score
                    label="I_stock"
                    value={record.scores.inventory_units.toLocaleString()}
                    note="floor 2,000 units"
                    tone={record.scores.inventory_units < 2000 ? 'bad' : 'ok'}
                  />
                  <Score
                    label="Cycle time"
                    value={fmtDuration(record.cycle_ms)}
                    note="SLA 15 min"
                    tone="ok"
                  />
                </div>
                <p className="con-hint" style={{ marginTop: 11 }}>
                  Policy in force: w1 {record.weights_applied.w1.toFixed(3)} · w2{' '}
                  {record.weights_applied.w2.toFixed(3)} · w3{' '}
                  {record.weights_applied.w3.toFixed(3)} · reasoning{' '}
                  {record.reasoning_mode.toLowerCase()} · budget{' '}
                  {fmtMoney(record.budget_usd)} · {record.market}
                </p>
              </section>

              {/* --- refusal clauses --- */}
              {record.refusal_reasons.length > 0 && (
                <section>
                  <div className="con-section-label">
                    Refusal gate — clauses that fired
                  </div>
                  {record.refusal_reasons.map((reason) => (
                    <div className="con-bar-row" key={reason.code + reason.clause}>
                      <div className="con-bar-label">
                        {reason.clause}
                        <small>
                          {reason.code} · raised by {reason.agent}
                        </small>
                      </div>
                      <div className="con-bar-val" style={{ color: 'var(--con-danger)' }}>
                        ✕
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* --- brand permission --- */}
              <section>
                <div className="con-section-label">
                  Brand permission — {detail.brand.name}
                </div>
                <div className="con-metrics">
                  {detail.brand.pillars.map((pillar) => (
                    <span key={pillar}>{pillar}</span>
                  ))}
                </div>
              </section>

              {/* --- agent trace --- */}
              <section>
                <div className="con-section-label">Agent execution trace</div>
                <div className="con-trace">
                  {record.trace.map((entry, index) => (
                    <div
                      className={`con-trace-item ${entry.status}`}
                      key={`${entry.node}-${index}`}
                    >
                      <div className="con-trace-t">
                        T+{(entry.t_offset_ms / 1000).toFixed(2)}s
                      </div>
                      <div className="con-trace-b">
                        <strong>{entry.label}</strong>
                        <span className="con-agent">{entry.agent}</span>
                        <p style={{ marginTop: 5 }}>{entry.detail}</p>
                        {entry.metrics && (
                          <div className="con-metrics">
                            {Object.entries(entry.metrics).map(([key, value]) => (
                              <span key={key}>
                                {key} {formatMetric(value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* --- outcome --- */}
              {record.outcome && (
                <section>
                  <div className="con-section-label">
                    Post-campaign outcome — RLOO reward signal
                  </div>
                  <div className="con-score-grid">
                    <Score
                      label="Sales lift"
                      value={`${record.outcome.sales_lift_pct > 0 ? '+' : ''}${record.outcome.sales_lift_pct}%`}
                      tone={record.outcome.sales_lift_pct > 0 ? 'ok' : 'bad'}
                    />
                    <Score label="CTR" value={`${(record.outcome.ctr * 100).toFixed(2)}%`} />
                    <Score
                      label="Conversion"
                      value={`${(record.outcome.conversion_rate * 100).toFixed(2)}%`}
                    />
                    <Score label="Reward" value={record.outcome.reward.toFixed(3)} />
                  </div>
                </section>
              )}

              {/* --- output schema --- */}
              <section>
                <div className="con-section-label">
                  Mandatory output schema
                </div>
                <pre className="con-code">
{JSON.stringify(
  {
    signal_id: record.signal_id,
    decision: record.decision,
    scores: {
      brand_fit: record.scores.brand_fit,
      cringe_risk: record.scores.cringe_risk,
      toxicity_risk: record.scores.toxicity_risk,
      inventory_units: record.scores.inventory_units,
    },
    brand_assigned: record.brand_id,
    refusal_reasoning:
      record.refusal_reasons.map((r) => r.clause).join(' ∨ ') || null,
    approval_status: record.approval_status,
    logged_at: fmtTime(record.created_at),
  },
  null,
  2,
)}
                </pre>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function formatMetric(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString()
  if (Math.abs(value) < 1) return value.toFixed(3)
  return value.toFixed(2)
}

function Score({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'ok' | 'bad' | 'warn'
}) {
  const colour =
    tone === 'ok'
      ? 'var(--con-ok)'
      : tone === 'bad'
        ? 'var(--con-danger)'
        : tone === 'warn'
          ? 'var(--con-warn)'
          : 'var(--con-text)'
  return (
    <div className="con-score">
      <small>{label}</small>
      <b style={{ color: colour }}>{value}</b>
      {note && <em>{note}</em>}
    </div>
  )
}

