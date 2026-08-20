/**
 * A minimal, dependency-free state-graph runtime.
 *
 * This is the TypeScript analogue of the LangGraph `StateGraph` shown in the
 * Project NEXT specification: nodes return partial state updates, conditional
 * edges route on the accumulated state, and `interrupt()` suspends execution
 * with the graph state frozen so a human can resume it later.
 *
 *   builder.addNode('evaluate_brand_dna', evaluateBrandDna)
 *   builder.addConditionalEdges('evaluate_brand_dna', routeDecision, {...})
 *   const graph = builder.compile()
 */

export const END = '__end__' as const

export type NodeName = string

export type NodeFn<S> = (state: S) => Promise<Partial<S>> | Partial<S>

export type RouterFn<S> = (state: S) => string

/**
 * Thrown by `interrupt()`. The runtime catches it, freezes state and returns
 * a suspended result rather than propagating an error.
 */
export class GraphInterrupt<P = unknown> extends Error {
  readonly payload: P
  constructor(payload: P) {
    super('GRAPH_INTERRUPT')
    this.name = 'GraphInterrupt'
    this.payload = payload
  }
}

/**
 * Suspends graph execution. Mirrors `langgraph.types.interrupt` — the node
 * calling it does not return; the runtime captures the payload and the caller
 * decides when (and whether) to resume.
 */
export function interrupt<P>(payload: P): never {
  throw new GraphInterrupt(payload)
}

export type RunStatus = 'COMPLETED' | 'SUSPENDED' | 'ERROR'

export interface RunResult<S, P = unknown> {
  status: RunStatus
  state: S
  /** Ordered list of nodes actually executed. */
  path: NodeName[]
  /** Present when status is SUSPENDED. */
  interrupt: P | null
  /** Present when status is ERROR. */
  error: string | null
}

interface ConditionalEdge<S> {
  router: RouterFn<S>
  mapping: Record<string, NodeName | typeof END>
}

export class StateGraph<S extends object> {
  private nodes = new Map<NodeName, NodeFn<S>>()
  private edges = new Map<NodeName, NodeName | typeof END>()
  private conditionals = new Map<NodeName, ConditionalEdge<S>>()
  private entryPoint: NodeName | null = null

  addNode(name: NodeName, fn: NodeFn<S>): this {
    if (this.nodes.has(name)) {
      throw new Error(`Duplicate node: ${name}`)
    }
    this.nodes.set(name, fn)
    return this
  }

  addEdge(from: NodeName, to: NodeName | typeof END): this {
    this.edges.set(from, to)
    return this
  }

  addConditionalEdges(
    from: NodeName,
    router: RouterFn<S>,
    mapping: Record<string, NodeName | typeof END>,
  ): this {
    this.conditionals.set(from, { router, mapping })
    return this
  }

  setEntryPoint(name: NodeName): this {
    this.entryPoint = name
    return this
  }

  compile(options: { maxSteps?: number } = {}): CompiledGraph<S> {
    if (!this.entryPoint) throw new Error('Graph has no entry point')
    if (!this.nodes.has(this.entryPoint)) {
      throw new Error(`Entry point "${this.entryPoint}" is not a node`)
    }
    // Validate every declared destination resolves to a real node.
    for (const [from, to] of this.edges) {
      if (to !== END && !this.nodes.has(to)) {
        throw new Error(`Edge ${from} -> ${to} targets an unknown node`)
      }
    }
    for (const [from, edge] of this.conditionals) {
      for (const target of Object.values(edge.mapping)) {
        if (target !== END && !this.nodes.has(target)) {
          throw new Error(
            `Conditional edge from ${from} targets unknown node ${target}`,
          )
        }
      }
    }
    return new CompiledGraph<S>(
      this.nodes,
      this.edges,
      this.conditionals,
      this.entryPoint,
      options.maxSteps ?? 64,
    )
  }
}

export class CompiledGraph<S extends object> {
  constructor(
    private readonly nodes: Map<NodeName, NodeFn<S>>,
    private readonly edges: Map<NodeName, NodeName | typeof END>,
    private readonly conditionals: Map<NodeName, ConditionalEdge<S>>,
    private readonly entryPoint: NodeName,
    private readonly maxSteps: number,
  ) {}

  /**
   * Runs the graph from `initial` (or resumes from `startAt`) until it reaches
   * END, suspends on an interrupt, or exceeds the step ceiling.
   */
  async invoke<P = unknown>(
    initial: S,
    startAt?: NodeName,
  ): Promise<RunResult<S, P>> {
    let state = { ...initial }
    let current: NodeName | typeof END = startAt ?? this.entryPoint
    const path: NodeName[] = []

    for (let step = 0; step < this.maxSteps; step++) {
      if (current === END) {
        return { status: 'COMPLETED', state, path, interrupt: null, error: null }
      }

      const node = this.nodes.get(current)
      if (!node) {
        return {
          status: 'ERROR',
          state,
          path,
          interrupt: null,
          error: `Unknown node: ${current}`,
        }
      }

      path.push(current)

      try {
        const update = await node(state)
        state = { ...state, ...update }
        current = this.next(current, state)
      } catch (error) {
        if (error instanceof GraphInterrupt) {
          return {
            status: 'SUSPENDED',
            state,
            path,
            interrupt: error.payload as P,
            error: null,
          }
        }
        return {
          status: 'ERROR',
          state,
          path,
          interrupt: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return {
      status: 'ERROR',
      state,
      path,
      interrupt: null,
      error: `Graph exceeded ${this.maxSteps} steps — probable cycle`,
    }
  }

  private next(from: NodeName, state: S): NodeName | typeof END {
    const conditional = this.conditionals.get(from)
    if (conditional) {
      const key = conditional.router(state)
      const target = conditional.mapping[key]
      if (target === undefined) {
        throw new Error(
          `Router for "${from}" returned "${key}", which is not in its mapping`,
        )
      }
      return target
    }
    return this.edges.get(from) ?? END
  }
}
