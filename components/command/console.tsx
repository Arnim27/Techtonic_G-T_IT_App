'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Ban,
  Bot,
  ChevronLeft,
  Gauge,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react'
import type { IngestResultSummary, StatePayload } from '@/lib/crme/api-types'
import { DecisionDrawer } from './decision-drawer'
import { HitlPanel } from './hitl-panel'
import {
  VERDICT_LABEL,
  brandColour,
  brandLabel,
  fmtDuration,
  fmtMoney,
  fmtPct,
  fmtTime,
} from './format'

const POLL_MS = 2500

/** The five sub-agents, in graph order, with the clause each one enforces. */
const AGENTS = [
  {
    id: '01',
    node: 'cultural_radar',
    name: 'Cultural Radar',
    agent: 'Agent_Sensing',
    gate: 'Δt ≤ 48h',
  },
  {
    id: '02',
    node: 'evaluate_brand_dna',
    name: 'Brand DNAi Alignment',
    agent: 'Agent_BrandDNA',
    gate: 'C_fit ≥ 0.65 · R_cringe ≤ 0.40',
  },
  {
    id: '03',
    node: 'compliance_audit',
    name: 'Compliance & Safety',
    agent: 'Agent_Compliance',
    gate: 'P_toxic ≤ 0.05 · P_IP ≤ 0.10',
  },
  {
    id: '04',
    node: 'commerce_gate',
    name: 'Supply & Commerce Gate',
    agent: 'Agent_OpsInventory',
    gate: 'I_stock ≥ 2,000',
  },
  {
    id: '05',
    node: 'orchestrate',
    name: 'Orchestration & Dispatch',
    agent: 'Agent_Orchestrator',
    gate: 'Budget < $10k → auto',
  },
]

const BRAND_OPTIONS = [
  'rexona',
  'sunsilk',
  'lakme',
  'surf-excel',
  'dove',
  'axe',
  'horlicks',
]

export function Console() {
  const [state, setState] = useState<StatePayload | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<IngestResultSummary | null>(null)
  const [autoPilot, setAutoPilot] = useState(false)

  // Cursor lives in a ref so the polling effect never re-subscribes on tick.
  const cursorRef = useRef(0)

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/state?cursor=${cursorRef.current}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('bad status')
      const payload = (await response.json()) as StatePayload
      // Never let a slow in-flight response rewind the cursor.
      cursorRef.current = Math.max(cursorRef.current, payload.cursor)
      setState((previous) => {
        // Keep a rolling window client-side; the server returns only what is
        // new since the cursor. Two polls can still be in flight at once —
        // the interval plus the one that follows an action — and both would
        // carry the same events, so the merge is deduplicated by sequence
        // number rather than trusting the cursor to have advanced.
        const merged = [...payload.events].reverse().concat(previous?.events ?? [])
        const seen = new Set<number>()
        const events = merged.filter((event) => {
          if (seen.has(event.seq)) return false
          seen.add(event.seq)
          return true
        })
        return { ...payload, events: events.slice(0, 60) }
      })
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  // Autopilot keeps the firehose flowing so the console is never static.
  useEffect(() => {
    if (!autoPilot) return
    const id = setInterval(() => {
      void fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'next', count: 1 }),
      }).then(() => poll())
    }, 6000)
    return () => clearInterval(id)
  }, [autoPilot, poll])

  const post = useCallback(
    async (url: string, body: unknown, label: string) => {
      setBusy(label)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        const payload = await response.json()
        await poll()
        return payload
      } finally {
        setBusy(null)
      }
    },
    [poll],
  )

  const ingest = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      const payload = (await post('/api/ingest', body, label)) as {
        results?: IngestResultSummary[]
      }
      const first = payload?.results?.[0]
      if (first) {
        setLastRun(first)
        setSelected(first.signal_id)
      }
    },
    [post],
  )

  const resolveHitl = useCallback(
    async (signalId: string, approve: boolean, note?: string) => {
      await post(
        '/api/hitl',
        { signal_id: signalId, approve, reviewer: 'brand-manager', note },
        signalId,
      )
    },
    [post],
  )

  const metrics = state?.metrics

  return (
    <div className="console">
      <TopBar
        connected={connected}
        modeLabel={metrics?.reasoning_mode ?? 'DETERMINISTIC'}
        modelConfigured={metrics?.model_configured ?? false}
        pending={metrics?.pending_interrupts ?? 0}
        decisions={metrics?.total_decisions ?? 0}
      />

      <div className="con-wrap">
        <ControlDeck
          busy={busy}
          autoPilot={autoPilot}
          onToggleAuto={() => setAutoPilot((v) => !v)}
          onIngest={() => ingest({ mode: 'next', count: 1 }, 'ingest')}
          onBurst={() => ingest({ mode: 'next', count: 5 }, 'burst')}
          onBenchmark={() => ingest({ mode: 'benchmark' }, 'benchmark')}
          onOptimise={() => post('/api/optimise', {}, 'optimise')}
          onReset={() => post('/api/reset', {}, 'reset')}
        />

        {metrics && <KpiStrip metrics={metrics} />}

        <div className="con-grid cols-main">
          <div className="con-grid" style={{ gap: 16 }}>
            <PipelinePanel lastRun={lastRun} />
            <Composer busy={busy === 'custom'} onSubmit={(body) => ingest(body, 'custom')} />
          </div>

          <div className="con-grid" style={{ gap: 16 }}>
            <DecisionTable
              decisions={state?.decisions ?? []}
              selected={selected}
              onSelect={setSelected}
            />
            <div className="con-grid cols-two">
              <RefusalPanel metrics={metrics} />
              <PolicyPanel state={state} />
            </div>
          </div>

          <div className="con-grid" style={{ gap: 16 }}>
            <section className="con-panel">
              <div className="con-panel-head">
                <ShieldCheck size={13} color="var(--con-warn)" />
                <h3>Human sign-off queue</h3>
                <span className="con-count">
                  {state?.pending.length ?? 0} pending
                </span>
              </div>
              <HitlPanel
                pending={state?.pending ?? []}
                autoAbortMs={state?.constants.autoAbortMs ?? 900000}
                onResolve={resolveHitl}
                busySignal={busy}
              />
            </section>

            <section className="con-panel">
              <div className="con-panel-head">
                <Activity size={13} color="var(--con-lime)" />
                <h3>Live telemetry</h3>
                <span className="con-count">{connected ? 'STREAMING' : 'OFFLINE'}</span>
              </div>
              <div className="con-panel-body flush con-scroll" style={{ maxHeight: 460 }}>
                <EventFeed events={state?.events ?? []} />
              </div>
            </section>
          </div>
        </div>

        {metrics && <BrandPanel metrics={metrics} />}
      </div>

      {selected && (
        <DecisionDrawer signalId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function TopBar({
  connected,
  modeLabel,
  modelConfigured,
  pending,
  decisions,
}: {
  connected: boolean
  modeLabel: string
  modelConfigured: boolean
  pending: number
  decisions: number
}) {
  return (
    <header className="con-bar">
      <span className="brand-mark" aria-hidden="true">
        <span>H</span>
        <span>U</span>
        <span>L</span>
      </span>
      <div className="con-title">
        <strong>Project NEXT — CRME</strong>
        <span>Cultural Response &amp; Moment Engine</span>
      </div>

      <div className="con-bar-spacer" />

      <span className={`con-chip ${connected ? 'is-live' : ''}`}>
        {connected && <i className="con-dot" />}
        {connected ? 'Live' : 'Reconnecting'}
      </span>
      <span className="con-chip is-model">
        <Bot size={11} />
        {modelConfigured ? modeLabel : 'Deterministic'}
      </span>
      <span className="con-chip">
        Decisions <b>{decisions}</b>
      </span>
      <span className="con-chip">
        Awaiting sign-off <b>{pending}</b>
      </span>
      <a className="con-back" href="/">
        <ChevronLeft size={11} style={{ verticalAlign: 'middle' }} /> Case
      </a>
    </header>
  )
}

function ControlDeck({
  busy,
  autoPilot,
  onToggleAuto,
  onIngest,
  onBurst,
  onBenchmark,
  onOptimise,
  onReset,
}: {
  busy: string | null
  autoPilot: boolean
  onToggleAuto: () => void
  onIngest: () => void
  onBurst: () => void
  onBenchmark: () => void
  onOptimise: () => void
  onReset: () => void
}) {
  return (
    <div className="con-panel">
      <div className="con-panel-body con-btn-row" style={{ alignItems: 'center' }}>
        <button className="con-btn primary" onClick={onBenchmark} disabled={busy !== null}>
          <Trophy size={12} /> Run 94th-minute benchmark
        </button>
        <button className="con-btn" onClick={onIngest} disabled={busy !== null}>
          <Send size={12} /> Ingest next signal
        </button>
        <button className="con-btn" onClick={onBurst} disabled={busy !== null}>
          <Zap size={12} /> Burst ×5
        </button>
        <button
          className={`con-btn ${autoPilot ? 'ok' : ''}`}
          onClick={onToggleAuto}
        >
          <Play size={12} /> Autopilot {autoPilot ? 'on' : 'off'}
        </button>
        <button className="con-btn" onClick={onOptimise} disabled={busy !== null}>
          <Sparkles size={12} /> Run RLOO pass
        </button>
        <div style={{ flex: 1 }} />
        <button className="con-btn" onClick={onReset} disabled={busy !== null}>
          <RefreshCw size={12} /> Reset store
        </button>
      </div>
    </div>
  )
}

function KpiStrip({ metrics }: { metrics: StatePayload['metrics'] }) {
  return (
    <div className="con-grid cols-kpi">
      <div className="con-kpi">
        <span>Signals evaluated</span>
        <strong>{metrics.total_decisions}</strong>
        <small>{metrics.outcomes_recorded} with outcomes</small>
      </div>
      <div className="con-kpi danger">
        <span>Refusal rate</span>
        <strong>{fmtPct(metrics.refusal_rate)}</strong>
        <small>{metrics.refused} moments declined</small>
      </div>
      <div className="con-kpi ok">
        <span>Fully automated</span>
        <strong>{fmtPct(metrics.automation_rate)}</strong>
        <small>{metrics.auto_dispatched} straight-through</small>
      </div>
      <div className="con-kpi accent">
        <span>Avg cycle time</span>
        <strong>{fmtDuration(metrics.avg_cycle_ms)}</strong>
        <small>SLA {fmtPct(metrics.sla_compliance)} within 15 min</small>
      </div>
      <div className="con-kpi">
        <span>Spend protected</span>
        <strong>{fmtMoney(metrics.spend_protected_usd)}</strong>
        <small>withheld from refused moments</small>
      </div>
      <div className="con-kpi">
        <span>Avg sales lift</span>
        <strong>
          {metrics.avg_sales_lift > 0 ? '+' : ''}
          {metrics.avg_sales_lift.toFixed(1)}%
        </strong>
        <small>across dispatched campaigns</small>
      </div>
    </div>
  )
}

function PipelinePanel({ lastRun }: { lastRun: IngestResultSummary | null }) {
  const traceByNode = new Map(
    (lastRun?.trace ?? []).map((entry) => [entry.node, entry]),
  )

  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <Gauge size={13} color="var(--con-cobalt)" />
        <h3>Agent pipeline</h3>
        {lastRun && (
          <span className="con-count">{fmtDuration(lastRun.cycle_ms)}</span>
        )}
      </div>
      <div className="con-panel-body flush">
        <div className="con-pipe">
          {AGENTS.map((agent) => {
            const entry = traceByNode.get(agent.node)
            const status = entry
              ? entry.status === 'REFUSED'
                ? 'refused'
                : entry.status === 'SUSPENDED'
                  ? 'suspended'
                  : 'ok'
              : 'idle'
            return (
              <div className={`con-pipe-node ${status}`} key={agent.node}>
                <span className="con-pipe-num">{agent.id}</span>
                <span className="con-pipe-name">
                  <strong>{agent.name}</strong>
                  <small>{entry ? agent.agent : agent.gate}</small>
                </span>
                <span
                  className="con-pipe-metric"
                  style={{
                    color:
                      status === 'refused'
                        ? 'var(--con-danger)'
                        : status === 'suspended'
                          ? 'var(--con-warn)'
                          : status === 'ok'
                            ? 'var(--con-ok)'
                            : 'var(--con-dim)',
                  }}
                >
                  {entry ? `${(entry.t_offset_ms / 1000).toFixed(2)}s` : '—'}
                </span>
              </div>
            )
          })}
        </div>
        {lastRun ? (
          <div style={{ padding: 13, borderTop: '1px solid var(--con-line)' }}>
            <div className="con-section-label">Last run · {lastRun.signal_id}</div>
            <div className="con-metrics">
              <span>C_fit {lastRun.scores.c_fit.toFixed(3)}</span>
              <span>R_cringe {lastRun.scores.r_cringe.toFixed(3)}</span>
              <span>P_toxic {lastRun.scores.p_toxic.toFixed(3)}</span>
              <span>P_IP {lastRun.scores.p_ip.toFixed(3)}</span>
              <span>I_stock {lastRun.scores.i_stock.toLocaleString()}</span>
            </div>
            {lastRun.refusal_reasons.length > 0 && (
              <p className="con-hint" style={{ marginTop: 9, color: 'var(--con-danger)' }}>
                {lastRun.refusal_reasons.map((r) => r.clause).join('  ∨  ')}
              </p>
            )}
          </div>
        ) : (
          <div className="con-empty">
            Run a signal to light up the graph.
            <br />
            Each node enforces one clause of G_Refusal.
          </div>
        )}
      </div>
    </section>
  )
}

function Composer({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [brand, setBrand] = useState('rexona')
  const [budget, setBudget] = useState('8000')
  const [stockOut, setStockOut] = useState(false)

  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <Sparkles size={13} color="var(--con-lime)" />
        <h3>Test a moment</h3>
      </div>
      <div className="con-panel-body">
        <div className="con-field">
          <label htmlFor="cmp-headline">Cultural moment</label>
          <input
            id="cmp-headline"
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder="Stoppage-time winner in extreme heat"
          />
        </div>
        <div className="con-field">
          <label htmlFor="cmp-body">Context</label>
          <textarea
            id="cmp-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What is actually happening, in the words the culture is using."
          />
        </div>
        <div className="con-field-row">
          <div className="con-field">
            <label htmlFor="cmp-brand">Brand</label>
            <select
              id="cmp-brand"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
            >
              {BRAND_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {brandLabel(id)}
                </option>
              ))}
            </select>
          </div>
          <div className="con-field">
            <label htmlFor="cmp-budget">Budget (USD)</label>
            <input
              id="cmp-budget"
              value={budget}
              inputMode="numeric"
              onChange={(event) => setBudget(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
        </div>
        <label
          className="con-hint"
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 11 }}
        >
          <input
            type="checkbox"
            checked={stockOut}
            style={{ width: 'auto' }}
            onChange={(event) => setStockOut(event.target.checked)}
          />
          Force a stock-out to exercise the commerce gate
        </label>
        <button
          className="con-btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={busy}
          onClick={() =>
            onSubmit({
              mode: 'custom',
              headline,
              body,
              brand_id: brand,
              budget_usd: Number(budget) || 0,
              force_stock_out: stockOut,
            })
          }
        >
          {busy ? 'Evaluating…' : 'Run through the gates'}
        </button>
        <p className="con-hint" style={{ marginTop: 10 }}>
          Try an off-brand pairing — a beauty brand on a sports moment — and watch
          the cringe gate refuse it.
        </p>
      </div>
    </section>
  )
}

function DecisionTable({
  decisions,
  selected,
  onSelect,
}: {
  decisions: StatePayload['decisions']
  selected: string | null
  onSelect: (signalId: string) => void
}) {
  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <Activity size={13} color="var(--con-cobalt)" />
        <h3>Decision record store</h3>
        <span className="con-count">{decisions.length} recent</span>
      </div>
      <div className="con-panel-body flush con-scroll" style={{ maxHeight: 520 }}>
        <div className="con-row head">
          <span>Brand</span>
          <span>Moment</span>
          <span>Verdict</span>
          <span style={{ textAlign: 'right' }}>C_fit</span>
          <span style={{ textAlign: 'right' }}>Risk</span>
          <span style={{ textAlign: 'right' }}>Budget</span>
        </div>
        {decisions.length === 0 && (
          <div className="con-empty">No decisions yet — ingest a signal.</div>
        )}
        {decisions.map((record) => (
          <button
            className={`con-row ${selected === record.signal_id ? 'selected' : ''}`}
            key={record.record_id}
            onClick={() => onSelect(record.signal_id)}
          >
            <span className="con-brand">
              <i
                className="con-orb"
                style={{ background: brandColour(record.brand_id) }}
              />
              {brandLabel(record.brand_id)}
            </span>
            <span className="con-headline">
              {record.headline}
              <small>
                {record.category} · {record.market} · {fmtDuration(record.cycle_ms)}
                {record.approval_status !== 'NOT_REQUIRED'
                  ? ` · ${record.approval_status.toLowerCase()}`
                  : ''}
              </small>
            </span>
            <span className={`con-verdict ${record.decision}`}>
              {VERDICT_LABEL[record.decision] ?? record.decision}
            </span>
            <span
              className={`con-num ${record.scores.brand_fit >= 0.85 ? 'high' : record.scores.brand_fit < 0.65 ? 'low' : ''}`}
            >
              {record.scores.brand_fit.toFixed(2)}
            </span>
            <span
              className={`con-num ${record.scores.toxicity_risk > 0.05 ? 'low' : ''}`}
            >
              {record.scores.toxicity_risk.toFixed(3)}
            </span>
            <span className="con-num">{fmtMoney(record.budget_usd)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function EventFeed({ events }: { events: StatePayload['events'] }) {
  if (events.length === 0) {
    return <div className="con-empty">Waiting for cultural telemetry…</div>
  }
  return (
    <div className="con-feed">
      {events.map((event) => (
        <div className="con-feed-item" key={event.seq}>
          <time>{fmtTime(event.at)}</time>
          <div className="con-feed-body">
            <span className={`con-feed-tag ${event.type.toLowerCase()}`}>
              {event.type.replace(/_/g, ' ')}
            </span>
            <p>{event.summary}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function RefusalPanel({ metrics }: { metrics: StatePayload['metrics'] | undefined }) {
  const mining = metrics?.mining
  const rows = mining?.by_code ?? []
  const max = rows.reduce((acc, row) => Math.max(acc, row.count), 1)

  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <Ban size={13} color="var(--con-danger)" />
        <h3>Refusal pattern mining</h3>
        <span className="con-count">{mining?.total_refusals ?? 0}</span>
      </div>
      <div className="con-panel-body">
        {rows.length === 0 && (
          <div className="con-empty">
            Nothing refused yet.
            <br />A system that never says no is not a governance layer.
          </div>
        )}
        {rows.map((row) => (
          <div className="con-bar-row" key={row.key}>
            <div className="con-bar-label">
              {row.label}
              <small>{row.example}</small>
              <div className="con-bar-track">
                <i style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </div>
            <div className="con-bar-val">{row.count}</div>
          </div>
        ))}
        {mining && mining.human_rejections > 0 && (
          <p className="con-hint" style={{ marginTop: 11 }}>
            {mining.human_rejections} human rejection(s) captured — the highest-signal
            rows in the corpus, mined for cringe patterns the rules do not yet encode.
          </p>
        )}
      </div>
    </section>
  )
}

function PolicyPanel({ state }: { state: StatePayload | null }) {
  const weights = state?.weights
  const history = state?.weight_history ?? []
  const metrics = state?.metrics

  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <Sparkles size={13} color="var(--con-lime)" />
        <h3>RLOO policy weights</h3>
        <span className="con-count">{metrics?.weight_samples ?? 0} outcomes</span>
      </div>
      <div className="con-panel-body">
        <div className="con-weights">
          <div className="con-weight">
            <small>w1 · similarity</small>
            <b>{weights ? weights.w1.toFixed(3) : '—'}</b>
            <em>cos(E_sig, e_brand)</em>
          </div>
          <div className="con-weight">
            <small>w2 · resonance</small>
            <b>{weights ? weights.w2.toFixed(3) : '—'}</b>
            <em>S_resonance</em>
          </div>
          <div className="con-weight">
            <small>w3 · cringe</small>
            <b>{weights ? weights.w3.toFixed(3) : '—'}</b>
            <em>R_cringe penalty</em>
          </div>
        </div>
        <p className="con-hint">
          C_fit = w1·cos(E_sig, e_brand) + w2·S_resonance − w3·R_cringe, normalised
          by (w1 + w2). Post-campaign sales lift and DSP conversions update the
          vector by leave-one-out advantage.
        </p>
        {history.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="con-section-label">Update history</div>
            {history.slice(0, 4).map((entry, index) => (
              <div className="con-bar-row" key={`${entry.at}-${index}`}>
                <div className="con-bar-label">
                  w1 {entry.weights.w1.toFixed(3)} · w2 {entry.weights.w2.toFixed(3)} ·
                  w3 {entry.weights.w3.toFixed(3)}
                  <small>
                    {fmtTime(entry.at)} · {entry.samples} samples
                  </small>
                </div>
                <div className="con-bar-val" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function BrandPanel({ metrics }: { metrics: StatePayload['metrics'] }) {
  return (
    <section className="con-panel">
      <div className="con-panel-head">
        <ShieldCheck size={13} color="var(--con-ok)" />
        <h3>Portfolio — decisions by brand</h3>
        <span className="con-count">{metrics.brands.length} brands live</span>
      </div>
      <div className="con-panel-body flush">
        <div className="con-row head" style={{ gridTemplateColumns: '1.4fr repeat(4, 1fr)' }}>
          <span>Brand</span>
          <span style={{ textAlign: 'right' }}>Evaluated</span>
          <span style={{ textAlign: 'right' }}>Approved</span>
          <span style={{ textAlign: 'right' }}>Refused</span>
          <span style={{ textAlign: 'right' }}>Avg C_fit</span>
        </div>
        {metrics.brands.map((brand) => (
          <div
            className="con-row"
            key={brand.brand_id}
            style={{ gridTemplateColumns: '1.4fr repeat(4, 1fr)', cursor: 'default' }}
          >
            <span className="con-brand">
              <i className="con-orb" style={{ background: brand.colour }} />
              {brand.name}
            </span>
            <span className="con-num">{brand.evaluated}</span>
            <span className="con-num high">{brand.approved}</span>
            <span className="con-num low">{brand.refused}</span>
            <span className="con-num">{brand.avg_fit.toFixed(2)}</span>
          </div>
        ))}
        {metrics.brands.length === 0 && (
          <div className="con-empty">No brand activity recorded yet.</div>
        )}
      </div>
    </section>
  )
}
