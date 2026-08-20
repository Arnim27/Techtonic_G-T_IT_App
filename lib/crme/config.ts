/**
 * Calibrated operational constants.
 *
 * Every value here is lifted directly from the Project NEXT technical
 * architecture specification (Section 4: Decision Thresholds & State-Graph
 * Execution Logic). Changing one changes the behaviour of the refusal gate,
 * so they are centralised rather than inlined at the call sites.
 */

/** Brand Fit Index weight vector: C_fit = w1·cos + w2·S_res − w3·R_cringe */
export const DEFAULT_WEIGHTS = { w1: 0.5, w2: 0.3, w3: 0.2 } as const

export type Weights = { w1: number; w2: number; w3: number }

/** Deterministic refusal gate — G_Refusal fires if ANY clause is true. */
export const REFUSAL_THRESHOLDS = {
  /** C_fit < 0.65 */
  MIN_BRAND_FIT: 0.65,
  /** R_cringe > 0.40 */
  MAX_CRINGE: 0.4,
  /** I_stock < 2,000 units */
  MIN_INVENTORY_UNITS: 2000,
  /** P_toxic > 0.05 */
  MAX_TOXICITY: 0.05,
  /** P_IP > 0.10 */
  MAX_IP_RISK: 0.1,
  /** Δt_signal > 48 hrs */
  MAX_SIGNAL_AGE_HOURS: 48,
} as const

/** PATH A — fully automated studio routing. */
export const AUTO_DISPATCH = {
  /** C_fit ≥ 0.85 */
  MIN_BRAND_FIT: 0.85,
  /** P_risk ≤ 0.02 */
  MAX_RISK: 0.02,
  /** Budget < $10,000 */
  MAX_BUDGET_USD: 10000,
} as const

/** PATH B — human-in-the-loop interrupt. */
export const HITL = {
  /** Budget ≥ $10,000 forces review. */
  BUDGET_TRIGGER_USD: 10000,
  /** 15-minute auto-abort timer on a frozen graph state. */
  AUTO_ABORT_MS: 15 * 60 * 1000,
} as const

/** Automated decision SLA advertised by Project NEXT. */
export const SLA = {
  TARGET_MS: 15 * 60 * 1000,
  /** Benchmarked end-to-end cycle from the Rexona FIFA walkthrough. */
  BENCHMARK_MS: 14 * 60 * 1000 + 30 * 1000,
} as const

/** Embedding space used by the Brand DNAi vector store. */
export const EMBEDDING_DIMS = 256

/** RLOO policy optimiser bounds — weights stay interpretable. */
export const RLOO = {
  LEARNING_RATE: 0.04,
  /** Minimum outcome-bearing records before weights are allowed to move. */
  MIN_SAMPLES: 6,
  BOUNDS: {
    w1: [0.35, 0.65],
    w2: [0.15, 0.45],
    w3: [0.1, 0.35],
  } as Record<'w1' | 'w2' | 'w3', [number, number]>,
}

/** Financial architecture (Section 6). Values in USD. */
export const FINANCIALS = {
  build: [
    { domain: 'Cloud Compute & Vertex AI', y1: 450000, run: 250000 },
    { domain: 'Model APIs & Multimodal Tokens', y1: 300000, run: 600000 },
    { domain: 'Enterprise SAP/DAM Connectors', y1: 650000, run: 150000 },
    { domain: 'Governance, Red-Teaming & Security', y1: 250000, run: 100000 },
    { domain: 'Change Management & Training', y1: 350000, run: 100000 },
  ],
  totalBuild: 2000000,
  totalRun: 1200000,
  paybackMonths: 7.2,
} as const

/** 12-month phased implementation roadmap (Section 6). */
export const ROADMAP = [
  {
    phase: 'Phase 1: Foundation',
    window: 'M1 – M3',
    milestones:
      'Deploy LangGraph on Vertex AI; establish read-only connectors to SAP S/4HANA OData, DAM, and Brand DNAi vector DB.',
  },
  {
    phase: 'Phase 2: Agent Logic',
    window: 'M4 – M6',
    milestones:
      'Develop 5 sub-agents; implement state persistence (PostgresSaver) and mobile HITL interrupt push cards.',
  },
  {
    phase: 'Phase 3: Pilot',
    window: 'M7 – M9',
    milestones:
      'Benchmark sandbox pilot on Rexona (Personal Care) during tentpole sports events; validate < 15 min SLA.',
  },
  {
    phase: 'Phase 4: Global Scale',
    window: 'M10 – M12',
    milestones:
      'Enterprise roll-out across all 4 Business Groups and 190 markets; integration with 50,000+ creator network.',
  },
] as const
