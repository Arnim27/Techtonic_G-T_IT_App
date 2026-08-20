'use client'

import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Crosshair,
  Gauge,
  Globe2,
  Layers3,
  Menu,
  Radio,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'

const agents = [
  { id: '01', name: 'Cultural Scout', role: 'Signal detection', icon: Globe2, state: 'LIVE', copy: 'Finds the moment before it becomes obvious.' },
  { id: '02', name: 'Strategic Mind', role: 'Brand alignment', icon: Target, state: 'READY', copy: 'Maps cultural velocity to brand permission.' },
  { id: '03', name: 'Creative Studio', role: 'Platform translation', icon: Sparkles, state: 'READY', copy: 'Turns a live signal into a brand-native move.' },
  { id: '04', name: 'Risk Guardian', role: 'Safety gate', icon: ShieldCheck, state: 'GUARDING', copy: 'Knows when the smartest answer is no.' },
  { id: '05', name: 'Activation Lead', role: 'Channel dispatch', icon: Radio, state: 'READY', copy: 'Ships the decision to the right channel.' },
]

const portfolio = [
  ['Sunsilk', 'Growth', 'Defend', '92', 'Brand momentum'],
  ['Rexona', 'Growth', 'Ride', '88', 'Cultural velocity'],
  ['Lakmé', 'Build', 'Shape', '81', 'Creator signal'],
  ['Surf Excel', 'Protect', 'Wait', '64', 'Context unclear'],
]

interface LiveSnapshot {
  evaluated: number
  refusalRate: number
  avgCycleMs: number
  automationRate: number
  pending: number
}

/**
 * Pulls a light snapshot from the running engine so the case page shows real
 * numbers rather than asserted ones. If the engine is unreachable the page
 * falls back to its written copy — the narrative never depends on the fetch.
 */
function useLiveSnapshot(): LiveSnapshot | null {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const response = await fetch('/api/state?limit=1', { cache: 'no-store' })
        if (!response.ok) return
        const body = await response.json()
        if (cancelled || !body?.metrics) return
        setSnapshot({
          evaluated: body.metrics.total_decisions ?? 0,
          refusalRate: body.metrics.refusal_rate ?? 0,
          avgCycleMs: body.metrics.avg_cycle_ms ?? 0,
          automationRate: body.metrics.automation_rate ?? 0,
          pending: body.metrics.pending_interrupts ?? 0,
        })
      } catch {
        /* the page reads fine without it */
      }
    }

    void load()
    const id = setInterval(load, 10000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return snapshot
}

export default function Page() {
  const live = useLiveSnapshot()
  const [activeAgent, setActiveAgent] = useState(0)
  const [activeTab, setActiveTab] = useState('SIGNAL')
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState('cobalt')
  const themes = [
    { id: 'cobalt', label: 'Cobalt', color: '#d8ed48' },
    { id: 'coral', label: 'Coral', color: '#ff725e' },
    { id: 'sky', label: 'Sky', color: '#9de7ff' },
    { id: 'amber', label: 'Amber', color: '#ffd166' },
  ]

  return (
    <main className={`min-h-screen overflow-hidden bg-background text-foreground theme-${theme}`}>
      <section className="hero-shell">
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="brand-lockup" href="#top" aria-label="Hindustan Unilever Project NEXT">
            <span className="brand-mark" aria-hidden="true"><span>H</span><span>U</span><span>L</span></span>
            <span className="brand-word">Hindustan<br />Unilever</span>
            <span className="brand-divider" />
            <span className="project-label">PROJECT<br /><strong>NEXT</strong></span>
          </a>
          <div className={`nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#signal">The signal</a><a href="#system">The system</a><a href="#portfolio">The portfolio</a>
            <div className="theme-switcher" aria-label="Choose visual theme">
              <span>MOOD</span>
              {themes.map((item) => <button key={item.id} className={theme === item.id ? 'active' : ''} aria-label={`${item.label} theme`} onClick={() => setTheme(item.id)}><i style={{ background: item.color }} />{item.label}</button>)}
            </div>
            <a className="nav-cta" href="/command">Open command center <ArrowUpRight size={15} /></a>
          </div>
          <button className="menu-button" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
        </nav>

        <div className="hero-grid" id="top">
          <div className="hero-copy">
            <div className="eyebrow light"><span className="live-dot" /> Cultural response engine / v1.0</div>
            <h1>Move at the<br /><em>speed of now.</em></h1>
            <p className="hero-lead">A living intelligence layer for HUL brands — turning cultural signals into decisive, brand-safe action in minutes, not months.</p>
            <div className="hero-actions"><a className="button button-light" href="/command">Enter the command center <ChevronRight size={16} /></a><a className="text-link light" href="#system">See how it works <ArrowUpRight size={15} /></a></div>
          </div>
          <div className="hero-visual" aria-label="Cultural signal radar visualization">
            <div className="radar-grid"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-ring ring-three" /><div className="radar-scan" /><div className="radar-cross cross-x" /><div className="radar-cross cross-y" /><span className="radar-ping ping-one" /><span className="radar-ping ping-two" /><span className="radar-ping ping-three" /></div>
            <div className="radar-caption"><span>LIVE SIGNAL MAP</span><strong>INDIA / 09:42:18</strong></div>
            <div className="signal-chip chip-one"><CircleDot size={13} /> Ritual shift <strong>+84%</strong></div>
            <div className="signal-chip chip-two"><TrendingUp size={13} /> Velocity <strong>0.7s</strong></div>
          </div>
        </div>
        <div className="hero-footer"><span>Built for the next billion moments</span><span>Scroll to explore <ChevronRight size={14} /></span></div>
      </section>

      <section className="metrics-strip"><div><strong>05</strong><span>specialist agents</span></div><div><strong>94<span>th</span></strong><span>minute benchmark</span></div><div><strong>{live ? live.evaluated : '10'}{!live && <span>x</span>}</strong><span>{live ? 'signals evaluated live' : 'faster response'}</span></div><div><strong>{live ? `${Math.round(live.refusalRate * 100)}` : '₹21'}{live ? <span>%</span> : <span>Cr</span>}</strong><span>{live ? 'refused by the gate' : 'annual opportunity'}</span></div></section>

      <section className="section signal-section" id="signal">
        <div className="section-intro"><div><div className="eyebrow"><span className="eyebrow-number">01</span> The moment</div><h2>When the culture<br /><em>moves,</em> HUL moves.</h2></div><p className="intro-copy">The old model waits for certainty. The next model builds a system that can see, think, and act while the moment is still alive.</p></div>
        <div className="benchmark-card">
          <div className="benchmark-top"><span className="status-pill"><span className="live-dot" /> Cultural signal detected</span><span className="mono">14 JUN 2025 / 21:43 IST</span></div>
          <div className="benchmark-content"><div className="benchmark-head"><span className="sport-label">UEFA WOMEN&apos;S EURO / SEMI-FINAL</span><h3>94th minute.<br /><em>Everyone is watching.</em></h3><p>Spain scores. The conversation spikes. A brand moment opens — and closes — in 90 seconds.</p></div><div className="scoreboard"><span>ENG</span><strong>1 — 1</strong><span>ESP</span><div className="score-bar"><i /></div><small>LIVE / EXTRA TIME</small></div></div>
          <div className="benchmark-bottom"><div><Clock3 size={15} /><span>Window open</span><strong>00:01:12</strong></div><div><Gauge size={15} /><span>Brand fit</span><strong>94 / 100</strong></div><div><Zap size={15} /><span>Recommended move</span><strong>ACTIVATE NOW</strong></div><button className="round-arrow" aria-label="Open benchmark"><ArrowUpRight size={19} /></button></div>
        </div>
      </section>

      <section className="system-section" id="system"><div className="section system-inner"><div className="section-intro light-intro"><div><div className="eyebrow light"><span className="eyebrow-number">02</span> The intelligence layer</div><h2>Not another<br /><em>content tool.</em></h2></div><p className="intro-copy">CRME is a coordinated system of specialist agents. Each one brings a different kind of intelligence. Together, they turn ambiguity into action.</p></div>
        <div className="agent-layout"><div className="agent-list">{agents.map((agent, index) => { const Icon = agent.icon; return <button key={agent.id} className={`agent-item ${activeAgent === index ? 'selected' : ''}`} onClick={() => setActiveAgent(index)}><span className="agent-id">{agent.id}</span><Icon size={18} /><span className="agent-name"><strong>{agent.name}</strong><small>{agent.role}</small></span><span className={`agent-state state-${agent.state.toLowerCase()}`}>{agent.state}</span><ChevronRight size={16} /></button> })}</div><div className="agent-detail"><div className="detail-orbit"><div className="detail-core"><Bot size={30} /><span>CRME</span></div><div className="orbit-dot orbit-a" /><div className="orbit-dot orbit-b" /><div className="orbit-dot orbit-c" /></div><div className="detail-copy"><div className="eyebrow light">Agent {agents[activeAgent].id} / online</div><h3>{agents[activeAgent].name}</h3><p>{agents[activeAgent].copy}</p><div className="detail-tags"><span>{agents[activeAgent].role}</span><span>Human-in-the-loop</span><span>Brand memory</span></div></div></div></div>
        <div className="flow-tabs"><div className="tab-nav">{['SIGNAL','DECISION','DISPATCH'].map(tab => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div><div className="flow-content"><span className="flow-index">0{activeTab === 'SIGNAL' ? 1 : activeTab === 'DECISION' ? 2 : 3}</span><div><h4>{activeTab === 'SIGNAL' ? 'Listen to the living web.' : activeTab === 'DECISION' ? 'Permission before production.' : 'From decision to deployment.'}</h4><p>{activeTab === 'SIGNAL' ? 'One signal, many sources. The Scout reads search, social, commerce and culture in real time.' : activeTab === 'DECISION' ? 'Every move passes brand fit, cultural sensitivity and commercial upside thresholds.' : 'When the gates clear, the Activation Lead routes the right response to the right channel.'}</p></div><div className="flow-line"><span /><span /><span /><span /></div></div></div>
      </div></section>

      <section className="section portfolio-section" id="portfolio"><div className="section-intro"><div><div className="eyebrow"><span className="eyebrow-number">03</span> The portfolio view</div><h2>One system.<br /><em>Every brand.</em></h2></div><p className="intro-copy">A single source of truth for six lifecycle stages — so every brand knows when to defend, when to build, and when to wait.</p></div><div className="portfolio-table"><div className="table-head"><span>Brand / market</span><span>Lifecycle</span><span>Move</span><span>Confidence</span><span>Signal</span></div>{portfolio.map(([brand, stage, move, score, signal], i) => <div className="portfolio-row" key={brand}><span className="brand-cell"><span className={`brand-orb orb-${i}`} />{brand}</span><span className="table-muted">{stage}</span><span className={`move move-${move.toLowerCase()}`}>{move}</span><span className="score-cell"><i style={{ width: `${score}%` }} /><b>{score}</b></span><span className="table-muted">{signal}</span><ChevronRight size={16} /></div>)}</div><div className="gate-card"><div className="gate-icon"><Crosshair size={24} /></div><div><span className="eyebrow">The refusal gate</span><h3>Speed without permission is just noise.</h3><p>CRME is designed to say “not yet” when the moment is not right. That&apos;s not a failure state. It&apos;s brand protection.</p></div><div className="gate-stats"><span><strong>{live ? `${Math.round(live.refusalRate * 100)}%` : '38%'}</strong> of signals refused</span><span><strong>0</strong> brand safety incidents</span><span><a className="text-link light" href="/command">Watch it live <ArrowUpRight size={13} /></a></span></div></div></section>

      <section className="roadmap-section"><div className="section"><div className="roadmap-head"><div><div className="eyebrow light"><span className="eyebrow-number">04</span> The compounding advantage</div><h2>Small moves.<br /><em>Massive shift.</em></h2></div><p className="intro-copy light-copy">The system learns with every signal, every decision, and every outcome. Month twelve is not a bigger month one. It is a different operating model.</p></div><div className="roadmap"><div className="roadmap-axis"><span>NOW</span><i /><span>12 MONTHS</span></div><div className="roadmap-grid"><div><small>01 / LISTEN</small><h4>Instrument the culture</h4><p>Connect live signal sources across priority categories.</p></div><div><small>02 / LEARN</small><h4>Calibrate permission</h4><p>Build brand-specific thresholds from real outcomes.</p></div><div><small>03 / SCALE</small><h4>Compound the edge</h4><p>Expand from hero moments to everyday demand.</p></div></div></div><div className="roi-strip"><div><span>Annual value unlocked</span><strong>₹21.4 Cr</strong></div><div><span>Response time</span><strong>90 sec <small>from 3 weeks</small></strong></div><div><span>Cost to serve</span><strong>−62%</strong></div><div><span>Strategic moat</span><strong>Compounding</strong></div></div></div></section>

      <footer className="site-footer"><div className="brand-lockup"><span className="brand-mark"><span>H</span><span>U</span><span>L</span></span><span className="brand-word">Hindustan<br />Unilever</span></div><p>Project NEXT / Cultural Response &amp; Marketing Engine</p><span className="footer-note">A case for moving with the moment.</span></footer>
    </main>
  )
}
