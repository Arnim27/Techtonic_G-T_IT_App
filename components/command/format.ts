/** Shared display helpers for the operations console. */

export function fmtTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('en-GB', { hour12: false })
}

export function fmtMoney(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1000) return `$${(usd / 1000).toFixed(usd >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(usd)}`
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function fmtCountdown(ms: number): string {
  const clamped = Math.max(0, ms)
  const minutes = Math.floor(clamped / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function fmtPct(value: number, dp = 0): string {
  return `${(value * 100).toFixed(dp)}%`
}

export const VERDICT_LABEL: Record<string, string> = {
  REFUSE: 'Refused',
  AUTO_DISPATCH: 'Dispatched',
  HITL_INTERRUPT: 'Human gate',
}

/** Brand accent colours, mirrored from the server-side registry. */
export const BRAND_COLOURS: Record<string, string> = {
  rexona: '#0057b8',
  sunsilk: '#e9483d',
  lakme: '#f1bf39',
  'surf-excel': '#63aa62',
  dove: '#087eaa',
  axe: '#8ea3b5',
  horlicks: '#ca7b25',
}

export function brandColour(brandId: string): string {
  return BRAND_COLOURS[brandId] ?? '#2b8cff'
}

export function brandLabel(brandId: string): string {
  const map: Record<string, string> = {
    rexona: 'Rexona',
    sunsilk: 'Sunsilk',
    lakme: 'Lakmé',
    'surf-excel': 'Surf Excel',
    dove: 'Dove',
    axe: 'Axe',
    horlicks: 'Horlicks',
  }
  return map[brandId] ?? brandId
}
