# Project NEXT — CRME

**Cultural Response & Moment Engine** · HUL Techtonic S8

A working implementation of the Project NEXT enterprise architecture: a five-agent
autonomous decisioning network that evaluates live cultural signals against a brand's
approved boundary, audits compliance, verifies real inventory, and either dispatches
programmatically or freezes for a human signature.

The system's primary job is **refusal**. Content creation at Unilever is already solved —
Digital Product Twins, Sketch Pro studios and Beauty AI Studios are operational. The
4-to-8 week latency lives entirely in the manual Decision & Clearance gate. This codebase
is that gate.

---

## Run it

```bash
npm install
npm run dev
```

Then open:

| Route | What it is |
| --- | --- |
| `/` | The case narrative, with live figures pulled from the running engine |
| `/command` | The operations console — the actual product |

No credentials, no cloud project, no API key. The engine runs entirely on its
deterministic reasoning path out of the box.

### Optional: add a hosted model

```bash
cp .env.example .env
# then uncomment ANTHROPIC_API_KEY or GOOGLE_API_KEY
```

A model **layers judgement on top of** the deterministic scores; it never replaces them.
Every call is time-boxed and wrapped, and any failure falls back silently. A refusal gate
that stops working when an API key expires is not a governance control.

### Smoke test

```bash
npm run smoke
```

Exercises the real orchestration graph over HTTP while `npm run dev` is running:
the benchmark case, both refusal paths, the HITL round-trip, the audit trail and the
RLOO pass.

---

## Architecture

```
Live cultural telemetry — video frames | OCR | social firehose | broadcast captions
                                    │
                                    ▼
              ┌──────────────────────────────────────────┐
              │ 1. CULTURAL RADAR         Agent_Sensing   │──(Δt > 48h)────────► REFUSE
              └──────────────────────┬───────────────────┘
                                     │  SignalContext (E_sig)
                                     ▼
              ┌──────────────────────────────────────────┐
              │ 2. BRAND DNAi ALIGNMENT   Agent_BrandDNA  │──(C_fit < 0.65)────► REFUSE
              └──────────────────────┬───────────────────┘   (R_cringe > 0.40)
                                     │  BrandFitVector (E_brand)
                                     ▼
              ┌──────────────────────────────────────────┐
              │ 3. COMPLIANCE & SAFETY   Agent_Compliance │──(P_toxic > 0.05)──► REFUSE
              └──────────────────────┬───────────────────┘   (P_IP > 0.10)
                                     │  ComplianceClearance (E_comp)
                                     ▼
              ┌──────────────────────────────────────────┐
              │ 4. SUPPLY & COMMERCE GATE Agent_OpsInv…   │──(I_stock < 2,000)─► SUPPRESS
              └──────────────────────┬───────────────────┘
                                     │  CommercialPayload (E_ops)
                                     ▼
              ┌──────────────────────────────────────────┐
              │ 5. ORCHESTRATION & DISPATCH               │
              └──────────────────────┬───────────────────┘
                          ┌──────────┴──────────┐
                          ▼                     ▼
              PATH A: auto dispatch    PATH B: HITL interrupt
              Sketch Pro + DSP APIs    frozen graph, 15-min auto-abort
```

Node order is the cost model: the cheapest refusal fires first, and **no creative is ever
rendered for a moment that was going to be declined.**

### The decision function

```
C_fit = w1·cos(E_sig, e_brand) + w2·S_resonance − w3·R_cringe        w = (0.50, 0.30, 0.20)

G_Refusal = (C_fit < 0.65) ∨ (R_cringe > 0.40) ∨ (I_stock < 2,000)
          ∨ (P_toxic > 0.05) ∨ (P_IP > 0.10) ∨ (Δt_signal > 48h)

PATH A  ⇔  G_Refusal = 0 ∧ C_fit ≥ 0.85 ∧ P_risk ≤ 0.02 ∧ Budget < $10,000
PATH B  ⇔  G_Refusal = 0 ∧ ¬PATH A
```

Anything that clears refusal but does not *fully* satisfy PATH A goes to a human. The
default posture is to ask, not to assume.

---

## Two deliberate departures from the source specification

Both are documented at the point of implementation.

**1. `C_fit` is normalised by `(w1 + w2)`.**
Taken literally the positive terms sum to 0.80, so the expression can never exceed 0.80 —
which makes the specification's own auto-dispatch threshold (`C_fit ≥ 0.85`) and its worked
Rexona example (`C_fit = 0.94`) unreachable. Normalising restores the full [0,1] range the
thresholds are written against. The shape of the formula and the relative influence of every
term are unchanged. See `lib/crme/agents/brand-dnai.ts`.

**2. Masking mitigates IP risk rather than clearing it.**
The Rexona walkthrough masks official team-kit logos and proceeds. Treating a maskable
exposure as full risk would refuse it. Residual risk still compounds, so a moment carrying
four separate rights exposures trips the ceiling even after every directive is applied.
See `lib/crme/agents/compliance.ts`.

---

## Reasoning: deterministic first

Every score has an auditable derivation that runs with no network access:

- **Semantic similarity** — a signed hashing vectoriser (256-dim, bigrams, sub-linear term
  weighting, L2-normalised) over the signal and the brand's approved boundary, blended with
  an explainable lexical-coverage term. The raw cosine is mapped through a **monotonic**
  logistic calibration, so calibration never reorders two signals — it only rescales them.
- **Cringe hazard** — forbidden-territory proximity, category permission, and a trend-chasing
  term. The chasing penalty is conditioned on category permission: a brand speaking inside its
  own territory is not trend-jumping just because the moment is loud.
- **Compliance** — a rights register (FIFA, IOC, league marks, kit trademarks, broadcast
  footage, music sync) and a brand-safety register, composed probabilistically.
- **Inventory** — seeded per signal so querying twice returns the same answer. A decision
  record must never contain contradictory evidence for one decision.

When a model is configured it contributes to the cringe and safety judgements only, and only
in the conservative direction — it can raise a hazard the rules missed, never lower one they
caught.

---

## Verified behaviour

`npm run smoke` passes 28/28 against a live server. Beyond that, these cases were executed
end-to-end through the real graph:

| Case | Verdict | Why |
| --- | --- | --- |
| Rexona / 94th minute, $45k | `HITL_INTERRUPT` | C_fit 0.885, R_cringe 0.023, all gates clear, spend over the $10k ceiling |
| Rexona / same moment, $4k | `HITL_INTERRUPT` | Rights exposure (P_risk 0.070) blocks automation even at low spend |
| Lakmé / same moment | `REFUSE` | C_fit 0.000, R_cringe 0.816 — no permission in Athletic Exertion |
| Sunsilk / monsoon, $6.5k | `AUTO_DISPATCH` | C_fit 0.912, clean rights, in stock, under ceiling |
| Horlicks / exam season, $5.2k | `AUTO_DISPATCH` | C_fit 0.920 |
| Dove / self-esteem, $7.1k | `AUTO_DISPATCH` | C_fit 0.976 |
| Horlicks / monsoon | `REFUSE` | Mis-routed — C_fit 0.044 |
| Rexona / 900 units | `REFUSE` | Inventory below the 2,000-unit floor |
| Rexona / 61h-old signal | `REFUSE` | Cultural window closed |
| Rexona / civil unrest | `REFUSE` | P_toxic 0.300 and R_cringe 1.000 |

The specification's worked example reports C_fit 0.94 / R_cringe 0.03; this implementation
produces 0.885 / 0.023 on the same moment. Both sit comfortably inside the same decision
bands and route identically.

---

## The data moat

Every evaluated signal, every human edit and — most valuably — every explicit refusal is
written to the Decision Record Store. That corpus is what competitors cannot license.

- **RLOO policy optimisation** — post-campaign sales lift and DSP conversions become a reward
  signal. Advantage is computed leave-one-out (each sample excluded from its own baseline,
  which keeps the gradient estimate unbiased on small batches) and correlated against each
  term of the Brand Fit Index. Weights stay inside interpretable bounds.
- **Refusal-pattern mining** — aggregates by clause, category and brand. A human rejecting
  something the gate *passed* is the highest-signal row in the corpus: it is the system
  learning a cringe pattern the rules do not yet encode.

Storage is process-local so the app runs with no infrastructure. `lib/crme/store/decision-store.ts`
is the seam — swap the array-backed methods for BigQuery inserts and Vertex Feature Store
writes and nothing upstream changes.

---

## Layout

```
app/
  page.tsx                     Case narrative, wired to live engine figures
  command/page.tsx             Operations console
  command/console.css          Console stylesheet (brand tokens from globals.css)
  api/state                    Single poll endpoint: events + metrics + queue
  api/ingest                   Run signals: firehose, benchmark, or operator free text
  api/hitl                     Pending queue; approve / reject
  api/decision                 Full audit record for one decision
  api/optimise                 One RLOO pass
  api/portfolio                Lifecycle matrix, brands, financials, thresholds
  api/reset                    Clear and re-seed

lib/crme/
  types.ts                     Payload contracts (E_sig, E_brand, E_comp, E_ops)
  config.ts                    Every threshold and weight, in one place
  graph.ts                     StateGraph runtime with interrupt()
  pipeline.ts                  The graph, the refusal gate, the router
  engine.ts                    Service layer the routes call
  agents/                      The five sub-agents
  connectors/                  SAP S/4HANA, Adobe DAM, Sketch Pro, DSP
  llm/                         Embeddings + pluggable model provider
  store/                       Decision Record Store, RLOO, refusal mining
  seed/                        Brand registry, signal firehose, lifecycle matrix

components/command/            Console UI
scripts/smoke.mjs              End-to-end test against a running server
```

---

## Using the console

- **Run 94th-minute benchmark** replays the worked example from the specification.
- **Ingest next signal** / **Burst ×5** pull from the simulated firehose, which is
  deliberately adversarial: unsafe moments, mis-routed brands and dead signals are mixed in.
  Measured over a 134-signal run the split is **44% refused, 37% human gate, 19% fully
  automated**. A demo where everything is approved proves nothing about a system whose job
  is refusal.
- **Autopilot** keeps the firehose flowing.
- **Test a moment** takes free text. Pair a beauty brand with a sports moment and watch the
  cringe gate decline it.
- **Run RLOO pass** attributes outcomes and updates the weight vector.
- Click any row for the full audit trail: which clause fired, on what evidence, under which
  policy weights.

---

## Notes

- The lockfile predates the one dependency added for the optional Claude adapter
  (`@anthropic-ai/sdk`), so use `npm install` or `pnpm install` rather than a frozen install.
- Cycle times shown in the console are real compute time (milliseconds), not the 15-minute
  operational SLA. The SLA is what the *organisation* achieves end-to-end; the graph itself
  is far faster than its own budget.
