import type { SignalContext, SignalSource } from '../types'
import { BRANDS } from './brands'
import { createRng, rngInt, rngPick } from '../rng'

/**
 * Cloud Pub/Sub firehose (simulated).
 *
 * Produces the live cultural telemetry the Cultural Radar ingests: broadcast
 * OCR, social firehose, search trends, creator network and commerce signals.
 *
 * The template set is deliberately adversarial: off-brand trend-jumping,
 * unsafe context and moments that arrive already dead. Measured over a
 * 134-signal run the split is 44% refused, 37% escalated to a human, 19%
 * fully automated. A demo where everything is approved proves nothing about a
 * system whose primary job is refusal.
 */

interface MomentTemplate {
  category: string
  headline: string
  body: string
  entities: string[]
  ocr: string[]
  source: SignalSource
  /**
   * Brands with genuine permission in this moment. Kept to the brand the copy
   * is actually written for: a monsoon *hair* story belongs to Sunsilk, not to
   * every brand that happens to permit the Monsoon category. Listing a brand
   * here that the body carries no vocabulary for produces a refusal that looks
   * like a bug rather than a judgement.
   */
  fitBrands: string[]
  sensitivity?: boolean
  /** Base engagement velocity in shares/min. */
  velocity: [number, number]
}

const TEMPLATES: MomentTemplate[] = [
  {
    category: 'Athletic Exertion',
    headline: 'Stoppage-time equaliser sparks a stadium-wide roar',
    body: 'A 94th-minute goal in extreme heat. Players collapse from exertion, shirts drenched with sweat after 90 minutes of relentless pressure, endurance and movement. Stoppage time stretches on as the stadium erupts. Commentators call it the performance of the tournament, and the question trending afterwards is how anyone stays dry through that kind of heat.',
    entities: ['stadium crowd', 'team kit', 'match footage'],
    ocr: ['94:00 +4', 'FULL TIME APPROACHING', 'stoppage time'],
    source: 'BROADCAST_OCR',
    fitBrands: ['rexona'],
    velocity: [40000, 92000],
  },
  {
    category: 'Monsoon',
    headline: 'First monsoon burst turns the evening commute into a soaked crawl',
    body: 'Sudden downpour across the city. Humidity spikes past ninety percent and frizz complaints surge as hair loses shine and smooth texture within minutes of the first rain. Commuters share drenched platform footage; salon bookings and styling searches climb as the monsoon opens. Volume, strength and glossy finish dominate the beauty conversation.',
    entities: ['commuter footage', 'weather bulletin'],
    ocr: ['HEAVY RAIN ALERT', 'humidity 94%'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: ['sunsilk'],
    velocity: [8000, 34000],
  },
  {
    category: 'Creator Culture',
    headline: 'A getting-ready-with-me format explodes overnight',
    body: 'A creator reel showing a full makeup routine goes viral: primer, foundation, shade matching, matte lipstick and a glow finish. Duets multiply as the colour palette trends across the beauty tutorial community, with kajal and eyeliner walkthroughs close behind.',
    entities: ['creator reel', 'user photography'],
    ocr: ['GRWM', '2.4M views'],
    source: 'CREATOR_NETWORK',
    fitBrands: ['lakme'],
    velocity: [12000, 48000],
  },
  {
    category: 'Wedding Season',
    headline: 'Wedding season opens with a viral mehendi choreography',
    body: 'Bridal dance footage spreads rapidly as the festive wedding calendar begins. Bridal makeup, festive colour palettes and couture detailing trend together; shade matching for the sangeet look and matte lipstick walkthroughs climb alongside mehendi choreography.',
    entities: ['wedding footage', 'music track'],
    ocr: ['SHAADI SEASON', 'sangeet night'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: ['lakme'],
    velocity: [6000, 26000],
  },
  {
    category: 'Exam Season',
    headline: 'Board results day sends study-routine content surging',
    body: 'Results announced nationwide. Exam preparation and study routines dominate as every family shares breakfast-table celebration clips. Parents search for nutrition, protein and vitamins that support growth, energy and immunity in children through the next academic year. Milk-based health drinks trend alongside revision timetables.',
    entities: ['results portal', 'family footage'],
    ocr: ['RESULTS DECLARED', 'class XII'],
    source: 'SEARCH_TRENDS',
    fitBrands: ['horlicks'],
    velocity: [4000, 19000],
  },
  {
    category: 'Music Festival',
    headline: 'Headline set closes with an unannounced collaboration',
    body: 'Festival crowd surges as two headliners share the stage. The beat drops and the dance floor turns; music, party energy and nightlife footage fill the feed. Confidence and charisma read as the currency of the night as the crew closes out the set.',
    entities: ['festival stage', 'official song', 'crowd footage'],
    ocr: ['MAIN STAGE', 'ENCORE'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: ['axe'],
    velocity: [15000, 55000],
  },
  {
    category: 'Family Life',
    headline: 'A schoolyard kindness clip becomes the day’s feel-good story',
    body: 'Children share a muddy football pitch after rain; one child gives away a clean shirt. Grass stains, mud and dirt cover every fabric as play continues regardless. The clip spreads through parent communities as an act of kindness and generosity; school groups pass it on, and the laundry pile becomes the punchline.',
    entities: ['school footage'],
    ocr: ['playground', 'after the rain'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: ['surf-excel'],
    velocity: [3000, 17000],
  },
  {
    category: 'Self-Esteem',
    headline: 'An unretouched campaign response starts a real-beauty conversation',
    body: 'Consumers post unedited, unretouched photographs in response to a retouching controversy. Real beauty, authentic representation and self-esteem lead the conversation. Comments centre on care for sensitive skin, gentle routines and body confidence rather than correction.',
    entities: ['user photography'],
    ocr: ['NO FILTER', 'as I am'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: ['dove'],
    velocity: [5000, 22000],
  },
  // --- Adversarial: unsafe context -----------------------------------------
  {
    category: 'Civil Unrest',
    headline: 'Protest march shuts the central business district',
    body: 'A large political protest and strike brings the district to a standstill. Reports of unrest and agitation spread rapidly across the feed.',
    entities: ['news footage', 'broadcast'],
    ocr: ['BREAKING', 'city centre closed'],
    source: 'SOCIAL_FIREHOSE',
    fitBrands: [],
    sensitivity: true,
    velocity: [20000, 70000],
  },
  {
    category: 'Disaster',
    headline: 'Flood warning issued across three coastal districts',
    body: 'Cyclone-driven flooding forces evacuations. Disaster relief coordination and casualty reports dominate national coverage.',
    entities: ['news footage'],
    ocr: ['RED ALERT', 'evacuation'],
    source: 'BROADCAST_OCR',
    fitBrands: [],
    sensitivity: true,
    velocity: [30000, 88000],
  },
  {
    category: 'Awards Season',
    headline: 'Awards night upset dominates the overnight conversation',
    body: 'An unexpected winner takes the top honour. Red-carpet fashion, couture gowns and beauty looks trend alongside the ceremony broadcast; runway-adjacent styling, bold lipstick shade choices and glow finishes dominate the overnight conversation.',
    entities: ['award ceremony', 'broadcast', 'official song'],
    ocr: ['AND THE WINNER IS', 'LIVE'],
    source: 'BROADCAST_OCR',
    fitBrands: ['lakme'],
    velocity: [18000, 60000],
  },
  {
    category: 'Gaming Culture',
    headline: 'A clutch final-round comeback becomes the clip of the tournament',
    body: 'Esports final decided by a last-second play. The crew erupts; gaming clips, college watch party rooms and nightlife celebrations spread within minutes. Competitive confidence and charisma dominate the clip as the beat of the stream soundtrack carries the moment.',
    entities: ['tournament stream', 'broadcast'],
    ocr: ['GRAND FINAL', 'MATCH POINT'],
    source: 'CREATOR_NETWORK',
    fitBrands: ['axe'],
    velocity: [9000, 38000],
  },
]

const MARKETS = [
  { market: 'Mumbai, IN', country: 'IN', postal: ['400001', '400051', '400070'] },
  { market: 'New Delhi, IN', country: 'IN', postal: ['110001', '110016'] },
  { market: 'Bengaluru, IN', country: 'IN', postal: ['560001', '560034'] },
  { market: 'Chennai, IN', country: 'IN', postal: ['600001', '600020'] },
  { market: 'London, UK', country: 'GB', postal: ['E1 6AN', 'SW1A 1AA'] },
  { market: 'São Paulo, BR', country: 'BR', postal: ['01310', '04533'] },
]

/**
 * The worked example from Section 5 of the specification: the 94th-minute
 * Rexona dilemma. Budget of $45,000 puts it over the $10k automation ceiling,
 * so it must route to a human — exactly as the walkthrough describes.
 */
export function rexonaBenchmarkSignal(now = new Date()): SignalContext {
  return {
    signal_id: 'SIG-REX-FIFA-94',
    timestamp: now.toISOString(),
    source: 'BROADCAST_OCR',
    headline: 'Knockout tie decided by a 94th-minute goal in extreme heat',
    raw_text:
      'Stoppage-time winner in a knockout match played in extreme heat. The scorer’s knee-slide celebration ends with the squad visibly drenched in sweat after 90 minutes of sustained exertion, endurance and pressure. Broadcast commentary calls it the defining performance of the tournament. Consumers are already asking how anyone stays dry through that kind of heat and movement.',
    category: 'Athletic Exertion',
    geo: {
      market: 'Mumbai, IN',
      country: 'IN',
      postal_codes: ['400001', '400051', '400070'],
    },
    engagement_velocity: 82000,
    velocity_delta: 4100,
    ocr_frames: [
      '94:00 +4 STOPPAGE TIME',
      'PITCH TEMP 38°C',
      'knee-slide celebration',
      'team kit visible',
    ],
    modalities: ['video', 'ocr', 'audio_transcript', 'social_text'],
    detected_entities: ['team kit', 'match footage', 'broadcast', 'stadium crowd'],
    signal_age_hours: 0.02,
    sensitivity_flag: false,
    candidate_brand_id: 'rexona',
    proposed_budget_usd: 45000,
  }
}

/**
 * Deterministically generates signal `index` of the firehose. Same index
 * always yields the same signal, so a replayed decision is reproducible.
 */
export function generateSignal(index: number, now = new Date()): SignalContext {
  const rng = createRng(`firehose:${index}`)
  const template = TEMPLATES[index % TEMPLATES.length]
  const market = rngPick(rng, MARKETS)

  // Route to a brand with permission most of the time, but deliberately
  // mis-route a share of signals so the anti-cringe gate has real work to do.
  const misroute = rng() < 0.15 || template.fitBrands.length === 0
  const brandPool = misroute
    ? BRANDS.filter((b) => !template.fitBrands.includes(b.brand_id))
    : BRANDS.filter((b) => template.fitBrands.includes(b.brand_id))
  const brand = rngPick(rng, brandPool.length ? brandPool : BRANDS)

  const velocity = rngInt(rng, template.velocity[0], template.velocity[1])
  // A minority of moments arrive already dead, past the 48h window.
  const stale = rng() < 0.08
  const ageHours = stale ? 49 + rng() * 40 : rng() * 6

  // Budget distribution: most activations are small; a meaningful minority
  // cross the $10k ceiling and therefore require a human signature.
  const bigSpend = rng() < 0.42
  const budget = bigSpend
    ? rngInt(rng, 10000, 180000)
    : rngInt(rng, 1200, 9800)

  return {
    signal_id: `SIG-${String(index).padStart(5, '0')}`,
    timestamp: new Date(now.getTime() - ageHours * 3600_000).toISOString(),
    source: template.source,
    headline: template.headline,
    raw_text: template.body,
    category: template.category,
    geo: {
      market: market.market,
      country: market.country,
      postal_codes: market.postal,
    },
    engagement_velocity: velocity,
    velocity_delta: rngInt(rng, -1800, 5200),
    ocr_frames: template.ocr,
    modalities: ['video', 'ocr', 'social_text'],
    detected_entities: template.entities,
    signal_age_hours: ageHours,
    sensitivity_flag: template.sensitivity ?? false,
    candidate_brand_id: brand.brand_id,
    proposed_budget_usd: budget,
  }
}

export const TEMPLATE_COUNT = TEMPLATES.length
