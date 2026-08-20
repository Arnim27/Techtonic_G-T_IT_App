import type { ReasoningMode } from '../types'

/**
 * Pluggable reasoning provider.
 *
 * The CRME agents are designed so that every score has a deterministic,
 * auditable derivation. A hosted model is an *enhancement layer*: when
 * credentials are present the agent asks it for nuanced cultural judgement
 * and blends the answer with the deterministic score; when they are absent —
 * or the call fails, times out, or returns malformed JSON — the deterministic
 * value stands unchanged.
 *
 * This is deliberate. A refusal gate that stops working when an API key
 * expires is not a governance control.
 */

export interface JudgementRequest {
  /** System framing for the sub-agent. */
  system: string
  /** The concrete question, already containing all context. */
  prompt: string
  /** JSON Schema the answer must satisfy. */
  schema: Record<string, unknown>
  /** Hard ceiling so a hung provider can never stall a decision cycle. */
  timeoutMs?: number
}

export interface ProviderInfo {
  mode: ReasoningMode
  model: string | null
  configured: boolean
}

const DEFAULT_TIMEOUT_MS = 8000

/** Resolve which provider is active from the environment, once per process. */
export function resolveProvider(): ProviderInfo {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      mode: 'CLAUDE',
      model: process.env.CRME_CLAUDE_MODEL ?? 'claude-opus-5',
      configured: true,
    }
  }
  const geminiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (geminiKey) {
    return {
      mode: 'GEMINI',
      model: process.env.CRME_GEMINI_MODEL ?? 'gemini-2.5-pro',
      configured: true,
    }
  }
  return { mode: 'DETERMINISTIC', model: null, configured: false }
}

/**
 * Ask the configured model for a structured judgement.
 * Returns `null` on *any* failure — callers must already have a usable score.
 */
export async function judge<T>(request: JudgementRequest): Promise<T | null> {
  const provider = resolveProvider()
  if (!provider.configured) return null

  try {
    if (provider.mode === 'CLAUDE') {
      return await judgeWithClaude<T>(request, provider.model as string)
    }
    return await judgeWithGemini<T>(request, provider.model as string)
  } catch {
    // Deliberately silent: the deterministic path is authoritative.
    return null
  }
}

// ---------------------------------------------------------------------------
// Claude — official Anthropic SDK, loaded lazily so a missing optional
// dependency degrades to the deterministic path instead of breaking the build.
// ---------------------------------------------------------------------------

async function judgeWithClaude<T>(
  request: JudgementRequest,
  model: string,
): Promise<T | null> {
  const mod = await import('@anthropic-ai/sdk').catch(() => null)
  if (!mod) return null

  const Anthropic = mod.default
  const client = new Anthropic({
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: 1,
  })

  // `output_config` is newer than some published SDK typings, so the call is
  // made through a structural signature rather than the generated parameter
  // type. The request shape itself is the documented one.
  type CreateFn = (params: Record<string, unknown>) => Promise<unknown>
  const create = client.messages.create.bind(client.messages) as unknown as CreateFn

  const response = await create({
    model,
    max_tokens: 2048,
    system: request.system,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: request.schema,
      },
    },
    messages: [{ role: 'user', content: request.prompt }],
  })

  // Guard before reading content: a policy decline yields no usable text.
  const message = response as {
    stop_reason?: string
    content?: Array<{ type: string; text?: string }>
  }
  if (message.stop_reason === 'refusal') return null

  const text = (message.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')

  return parseJson<T>(text)
}

// ---------------------------------------------------------------------------
// Gemini — the platform named in the Project NEXT architecture. Reached over
// its REST surface so no additional dependency is required.
// ---------------------------------------------------------------------------

async function judgeWithGemini<T>(
  request: JudgementRequest,
  model: string,
): Promise<T | null> {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) return null

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(request.schema),
          },
        }),
      },
    )

    if (!response.ok) return null
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return parseJson<T>(text)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Gemini's responseSchema is OpenAPI-flavoured and rejects JSON Schema
 * keywords such as `additionalProperties`, so they are stripped.
 */
function toGeminiSchema(schema: Record<string, unknown>): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) {
        if (key === 'additionalProperties' || key === '$schema') continue
        out[key] = strip(value)
      }
      return out
    }
    return node
  }
  return strip(schema)
}

function parseJson<T>(text: string): T | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // Tolerate a fenced or prose-wrapped object.
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T
    } catch {
      return null
    }
  }
}
