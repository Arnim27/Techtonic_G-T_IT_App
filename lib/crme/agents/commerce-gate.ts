import type {
  BrandProfile,
  CommercialPayload,
  SignalContext,
  TraceEntry,
} from '../types'
import { REFUSAL_THRESHOLDS } from '../config'
import { queryInventory } from '../connectors/sap-s4hana'


/**
 * Agent 4 — Supply & Commerce Gate (Agent_OpsInventory).
 *
 * Interrogates SAP S/4HANA OData inventory across regional dark stores and
 * retail hubs, and suppresses routes where the product cannot actually be
 * bought. Cultural relevance without availability is just paid frustration.
 */

export interface CommerceInput {
  signal: SignalContext
  brand: BrandProfile
  forceStockOut?: boolean
}

export interface CommerceResult {
  payload: CommercialPayload
  trace: TraceEntry
}

export function runCommerceGate({
  signal,
  brand,
  forceStockOut,
}: CommerceInput): CommerceResult {
  const started = Date.now()

  const payload = queryInventory({ signal, brand, forceStockOut })
  const cleared = payload.i_stock >= REFUSAL_THRESHOLDS.MIN_INVENTORY_UNITS

  const trace: TraceEntry = {
    node: 'commerce_gate',
    agent: 'Agent_OpsInventory',
    label: 'Commerce gate',
    detail: cleared
      ? `SAP S/4HANA confirms ${payload.i_stock.toLocaleString()} units of ${brand.primary_sku} across ${payload.fulfilment_hubs.length} hubs. Geo-targeting authorised for ${payload.in_stock_postal_codes.length} postal areas.`
      : `Route suppressed — only ${payload.i_stock.toLocaleString()} units available against a ${REFUSAL_THRESHOLDS.MIN_INVENTORY_UNITS.toLocaleString()} unit floor. Spending here would drive demand to an out-of-stock shelf.`,
    t_offset_ms: Date.now() - started,
    status: cleared ? 'OK' : 'REFUSED',
    metrics: {
      i_stock: payload.i_stock,
      hubs_queried: payload.fulfilment_hubs.length,
      serviceable_postal_codes: payload.in_stock_postal_codes.length,
      inventory_floor: REFUSAL_THRESHOLDS.MIN_INVENTORY_UNITS,
    },
  }

  return { payload: { ...payload, inventory_cleared: cleared }, trace }
}
