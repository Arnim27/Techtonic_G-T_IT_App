#!/usr/bin/env node
/**
 * End-to-end smoke test for the CRME engine.
 *
 * Runs against a live dev server and exercises the real orchestration graph —
 * not a reimplementation of it. Start the app first:
 *
 *   npm run dev
 *   node scripts/smoke.mjs
 *
 * Optionally: BASE=http://localhost:3001 node scripts/smoke.mjs
 */

const BASE = process.env.BASE ?? 'http://localhost:3000'

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function json(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`)
  }
  return response.json()
}

async function post(path, body) {
  return json(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

async function main() {
  console.log(`\nProject NEXT — CRME smoke test against ${BASE}\n`)

  // --- 1. state boots and seeds ---------------------------------------------
  console.log('State endpoint')
  const state = await json('/api/state?cursor=0')
  check('returns a metrics block', !!state.metrics)
  check('seeds decision history', state.metrics.total_decisions > 0,
    `saw ${state.metrics?.total_decisions}`)
  check('exposes the governance constants', state.constants?.autoAbortMs === 900000,
    `autoAbortMs=${state.constants?.autoAbortMs}`)

  // --- 2. thresholds are published ------------------------------------------
  console.log('\nPortfolio / thresholds')
  const portfolio = await json('/api/portfolio')
  check('publishes six lifecycle stages', portfolio.stages?.length === 6)
  check('CRME is ranked #1', portfolio.stages?.some(
    (s) => s.acronym === 'CRME' && s.rank === 1 && s.prioritised))
  check('weighted scores derive from the matrix', portfolio.stages?.every(
    (s) => Math.abs(s.derived_score - s.weighted_score) < 0.011),
    'derived score diverges from the published score')
  check('refusal thresholds match the specification',
    portfolio.thresholds?.refusal?.MIN_BRAND_FIT === 0.65 &&
    portfolio.thresholds?.refusal?.MAX_CRINGE === 0.4 &&
    portfolio.thresholds?.refusal?.MIN_INVENTORY_UNITS === 2000 &&
    portfolio.thresholds?.refusal?.MAX_TOXICITY === 0.05 &&
    portfolio.thresholds?.refusal?.MAX_IP_RISK === 0.1 &&
    portfolio.thresholds?.refusal?.MAX_SIGNAL_AGE_HOURS === 48)

  // --- 3. the worked example from Section 5 ---------------------------------
  console.log('\n94th-minute Rexona benchmark')
  const bench = (await post('/api/ingest', { mode: 'benchmark' })).results[0]
  check('clears every refusal clause', bench.refusal_reasons.length === 0,
    bench.refusal_reasons.map((r) => r.clause).join(' | '))
  check('routes to a human on $45k spend', bench.decision === 'HITL_INTERRUPT',
    `decision=${bench.decision}`)
  check('brand fit is strong', bench.scores.c_fit >= 0.85,
    `C_fit=${bench.scores.c_fit}`)
  check('cringe hazard is low', bench.scores.r_cringe <= 0.1,
    `R_cringe=${bench.scores.r_cringe}`)
  check('kit trademarks were masked, not refused', bench.scores.p_ip <= 0.1,
    `P_IP=${bench.scores.p_ip}`)
  check('raises an interrupt with a 15-minute timer', !!bench.interrupt &&
    Math.abs(new Date(bench.interrupt.expires_at) - new Date(bench.interrupt.created_at) - 900000) < 2000)
  check('renders creative variants', (bench.brief?.variants?.length ?? 0) > 0)
  check('executed all five agents', bench.trace.length >= 5,
    `${bench.trace.length} trace entries`)

  // --- 4. refusal: off-brand pairing ----------------------------------------
  console.log('\nAnti-cringe refusal')
  const offBrand = (await post('/api/ingest', {
    mode: 'custom',
    brand_id: 'lakme',
    headline: 'Stoppage-time goal decides the knockout tie in extreme heat',
    body: 'A 94th-minute winner. Players collapse from exertion, drenched in sweat after 90 minutes of relentless pressure and endurance.',
    category: 'Athletic Exertion',
    budget_usd: 5000,
    velocity: 82000,
  })).results[0]
  check('refuses a beauty brand on a sports moment', offBrand.decision === 'REFUSE',
    `decision=${offBrand.decision}`)
  check('names the clause that fired', offBrand.refusal_reasons.length > 0)
  check('no creative was rendered for a refused moment', !offBrand.brief)

  // --- 5. refusal: commerce gate --------------------------------------------
  console.log('\nCommerce gate')
  const stockOut = (await post('/api/ingest', {
    mode: 'custom',
    brand_id: 'rexona',
    headline: 'Stoppage-time winner in extreme heat',
    body: 'Players drenched in sweat after 90 minutes of exertion, pressure, endurance and movement. Stoppage time stretches on. The question trending is how anyone stays dry in that heat.',
    category: 'Athletic Exertion',
    budget_usd: 4000,
    velocity: 60000,
    force_stock_out: true,
  })).results[0]
  check('suppresses the route when stock is short', stockOut.decision === 'REFUSE',
    `decision=${stockOut.decision}, I_stock=${stockOut.scores.i_stock}`)
  check('cites the inventory floor', stockOut.refusal_reasons.some(
    (r) => r.code === 'INVENTORY_BELOW_FLOOR'))

  // --- 6. HITL resolution ----------------------------------------------------
  console.log('\nHuman-in-the-loop')
  const hitl = await json('/api/hitl')
  const target = hitl.pending?.[0]
  if (target) {
    const resolved = await post('/api/hitl', {
      signal_id: target.signal_id,
      approve: true,
      reviewer: 'smoke-test',
      note: 'Approved by the smoke test.',
    })
    check('approving resumes the graph', resolved.interrupt?.status === 'APPROVED')
    const detail = await json(`/api/decision?signal_id=${encodeURIComponent(target.signal_id)}`)
    check('approval is written to the decision record',
      detail.record?.approval_status === 'APPROVED')
    check('an outcome is attributed for RLOO', detail.record?.outcome !== null)
  } else {
    check('a pending interrupt exists to resolve', false, 'queue was empty')
  }

  // --- 7. audit trail --------------------------------------------------------
  console.log('\nAudit trail')
  const audit = await json(`/api/decision?signal_id=${encodeURIComponent(bench.signal_id)}`)
  check('every agent left a trace entry', audit.record?.trace?.length >= 5)
  check('records the weights in force', typeof audit.record?.weights_applied?.w1 === 'number')
  check('unknown signals 404 cleanly',
    await fetch(`${BASE}/api/decision?signal_id=NOPE`).then((r) => r.status === 404))

  // --- 8. RLOO ---------------------------------------------------------------
  console.log('\nRLOO policy optimisation')
  const rloo = await post('/api/optimise')
  check('optimiser responds', rloo.ok === true)
  check('weights stay within interpretable bounds',
    rloo.weights.w1 >= 0.35 && rloo.weights.w1 <= 0.65 &&
    rloo.weights.w2 >= 0.15 && rloo.weights.w2 <= 0.45 &&
    rloo.weights.w3 >= 0.1 && rloo.weights.w3 <= 0.35,
    JSON.stringify(rloo.weights))

  // --- summary ---------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\nSmoke test could not run: ${error.message}`)
  console.error(`Is the dev server up at ${BASE}?\n`)
  process.exit(1)
})
