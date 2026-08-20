import type {
  BrandProfile,
  CommercialPayload,
  FulfilmentHub,
  SignalContext,
} from '../types'
import { REFUSAL_THRESHOLDS } from '../config'
import { createRng, rngInt } from '../rng'

/**
 * SAP S/4HANA OData connector (simulated).
 *
 * Interrogates regional dark stores and retail hubs for live inventory of the
 * brand's primary SKU. This is the connector that stops Project NEXT paying
 * for impressions against a product nobody can buy — the single largest
 * source of wasted trade spend in the legacy operating model.
 *
 * Replace `queryInventory` with a real OData call
 * (`GET /sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod`)
 * and the rest of the system is unchanged.
 */

const HUB_CATALOGUE: Record<string, Array<{ hub: string; city: string; postal: string }>> = {
  IN: [
    { hub: 'HUB-MUM-01', city: 'Mumbai', postal: '400001' },
    { hub: 'HUB-MUM-04', city: 'Mumbai', postal: '400051' },
    { hub: 'HUB-DEL-02', city: 'New Delhi', postal: '110001' },
    { hub: 'HUB-BLR-03', city: 'Bengaluru', postal: '560001' },
    { hub: 'HUB-HYD-01', city: 'Hyderabad', postal: '500001' },
    { hub: 'HUB-CHN-02', city: 'Chennai', postal: '600001' },
    { hub: 'HUB-KOL-01', city: 'Kolkata', postal: '700001' },
    { hub: 'HUB-PUN-05', city: 'Pune', postal: '411001' },
  ],
  GLOBAL: [
    { hub: 'HUB-NYC-01', city: 'New York', postal: '10001' },
    { hub: 'HUB-LON-02', city: 'London', postal: 'E1 6AN' },
    { hub: 'HUB-SAO-01', city: 'São Paulo', postal: '01310' },
    { hub: 'HUB-DXB-03', city: 'Dubai', postal: '00000' },
  ],
}

export interface InventoryQuery {
  signal: SignalContext
  brand: BrandProfile
  /** Forces a stock-out to demonstrate the commerce refusal path. */
  forceStockOut?: boolean
}

export function queryInventory({
  signal,
  brand,
  forceStockOut,
}: InventoryQuery): CommercialPayload {
  const rng = createRng(`${signal.signal_id}:${brand.brand_id}:sap`)
  const region = signal.geo.country === 'IN' ? 'IN' : 'GLOBAL'
  const catalogue = HUB_CATALOGUE[region] ?? HUB_CATALOGUE.IN

  // Query only the hubs serving the postal codes the signal is geo-fenced to.
  const hubCount = Math.max(3, Math.min(catalogue.length, signal.geo.postal_codes.length + 2))
  const selected = catalogue.slice(0, hubCount)

  const hubs: FulfilmentHub[] = selected.map((entry) => ({
    hub_id: entry.hub,
    city: entry.city,
    postal_code: entry.postal,
    units: forceStockOut ? rngInt(rng, 0, 240) : rngInt(rng, 400, 4200),
  }))

  const iStock = hubs.reduce((total, hub) => total + hub.units, 0)
  const inStockHubs = hubs.filter((hub) => hub.units >= 250)

  const skuIds = [brand.primary_sku, `${brand.primary_sku}-MULTI`]

  return {
    i_stock: iStock,
    sku_ids: skuIds,
    in_stock_postal_codes: inStockHubs.map((hub) => hub.postal_code),
    fulfilment_hubs: hubs,
    direct_to_cart_links: inStockHubs.slice(0, 3).map(
      (hub) =>
        `https://shop.hul.example/${brand.brand_id}/${brand.primary_sku}?hub=${hub.hub_id}&pc=${encodeURIComponent(hub.postal_code)}`,
    ),
    inventory_cleared: iStock >= REFUSAL_THRESHOLDS.MIN_INVENTORY_UNITS,
  }
}
