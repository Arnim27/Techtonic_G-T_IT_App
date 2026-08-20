import type { BrandProfile } from '../types'

/**
 * Brand DNAi registry.
 *
 * `pillars` + `lexicon` define each brand's approved semantic boundary — the
 * vector the Brand DNAi Alignment Agent measures a live signal against.
 * `forbidden_territory` is the anti-cringe boundary: proximity to these terms
 * drives R_cringe up and forces a refusal, which is the whole point of the
 * system. Cultural permission is not the same as cultural presence.
 */
export const BRANDS: BrandProfile[] = [
  {
    brand_id: 'rexona',
    name: 'Rexona',
    business_group: 'Personal Care',
    pillars: [
      '72H non-stop sweat protection',
      "Won't let you down under pressure",
      'Movement, exertion and athletic confidence',
    ],
    lexicon: [
      'sweat', 'protection', 'performance', 'athlete', 'exertion', 'endurance',
      'heat', 'stamina', 'clutch', 'pressure', 'confidence', 'movement',
      'training', 'stoppage', 'overtime', 'sprint', 'marathon', 'humidity',
      'deodorant', 'antiperspirant', 'freshness', 'dry',
    ],
    permitted_categories: [
      'Athletic Exertion', 'Live Sport', 'Fitness', 'Heatwave', 'Dance',
      'Commuting', 'Endurance',
    ],
    forbidden_territory: [
      'grief', 'funeral', 'political protest', 'religious ritual', 'injury',
      'illness', 'disaster', 'bereavement',
    ],
    primary_sku: 'RXN-CLIN-PRO-50ML',
    colour: '#0057b8',
    lifecycle_stage: 'Growth',
    market: 'IN / Global',
  },
  {
    brand_id: 'sunsilk',
    name: 'Sunsilk',
    business_group: 'Beauty & Wellbeing',
    pillars: [
      'Hair that moves with your ambition',
      'Everyday transformation, not perfection',
      'Expert-backed care for real Indian hair',
    ],
    lexicon: [
      'hair', 'shine', 'frizz', 'monsoon', 'humidity', 'smooth', 'volume',
      'shampoo', 'conditioner', 'styling', 'salon', 'braid', 'texture',
      'confidence', 'campus', 'transformation', 'glossy', 'strength',
    ],
    permitted_categories: [
      'Beauty Ritual', 'Monsoon', 'Campus Culture', 'Music & Dance',
      'Festive Grooming', 'Wedding Season',
    ],
    forbidden_territory: [
      'body shaming', 'skin tone comparison', 'political protest', 'grief',
      'medical claim', 'communal tension',
    ],
    primary_sku: 'SNS-BLKSHN-340ML',
    colour: '#e9483d',
    lifecycle_stage: 'Growth',
    market: 'IN',
  },
  {
    brand_id: 'lakme',
    name: 'Lakmé',
    business_group: 'Beauty & Wellbeing',
    pillars: [
      'India’s beauty authority since 1952',
      'Runway craft translated for every day',
      'Colour that belongs to the wearer',
    ],
    lexicon: [
      'makeup', 'lipstick', 'foundation', 'runway', 'fashion', 'colour',
      'matte', 'glow', 'kajal', 'eyeliner', 'bridal', 'festive', 'couture',
      'artistry', 'palette', 'shade', 'skin', 'primer', 'trend',
    ],
    permitted_categories: [
      'Fashion Week', 'Festive Grooming', 'Wedding Season', 'Beauty Ritual',
      'Creator Culture', 'Awards Season',
    ],
    forbidden_territory: [
      'skin lightening', 'body shaming', 'political protest', 'grief',
      'medical claim', 'age shaming',
    ],
    primary_sku: 'LKM-ABSL-MATTE-04',
    colour: '#f1bf39',
    lifecycle_stage: 'Build',
    market: 'IN',
  },
  {
    brand_id: 'surf-excel',
    name: 'Surf Excel',
    business_group: 'Home Care',
    pillars: [
      'Dirt is good — stains are the price of doing something worthwhile',
      'Children learning through mess and generosity',
      'Removes tough stains in one wash',
    ],
    lexicon: [
      'stain', 'dirt', 'wash', 'detergent', 'laundry', 'mud', 'play',
      'children', 'kindness', 'generosity', 'grass', 'paint', 'festival',
      'colour', 'clean', 'fabric', 'monsoon', 'school',
    ],
    permitted_categories: [
      'Family Life', 'Festive Play', 'School Culture', 'Monsoon', 'Sport',
      'Community Kindness',
    ],
    forbidden_territory: [
      'communal tension', 'religious ritual', 'political protest', 'grief',
      'child safety incident', 'disaster',
    ],
    primary_sku: 'SFX-EASYWASH-1KG',
    colour: '#63aa62',
    lifecycle_stage: 'Protect',
    market: 'IN',
  },
  {
    brand_id: 'dove',
    name: 'Dove',
    business_group: 'Beauty & Wellbeing',
    pillars: [
      'Real beauty, no distortion',
      'Care that is proven, gentle and unconditional',
      'Self-esteem as a category commitment',
    ],
    lexicon: [
      'care', 'gentle', 'moisture', 'skin', 'nourish', 'real', 'self-esteem',
      'body', 'confidence', 'unretouched', 'soap', 'cream', 'sensitive',
      'kindness', 'representation', 'authentic',
    ],
    permitted_categories: [
      'Self-Esteem', 'Beauty Ritual', 'Creator Culture', 'Family Life',
      'Body Confidence',
    ],
    // Entries name practices the brand must never endorse, and are phrased
    // precisely enough not to fire merely because a moment *discusses* them.
    // "retouched imagery" is forbidden; a conversation about retouching is
    // the territory Dove owns.
    forbidden_territory: [
      'body shaming', 'skin lightening', 'retouched imagery',
      'political protest', 'diet culture', 'age shaming',
    ],
    primary_sku: 'DOV-DEEPMST-100G',
    colour: '#087eaa',
    lifecycle_stage: 'Defend',
    market: 'IN / Global',
  },
  {
    brand_id: 'axe',
    name: 'Axe',
    business_group: 'Personal Care',
    pillars: [
      'Attraction is earned through confidence, not conquest',
      'Fragrance as social courage',
      'Youth culture native, never borrowed',
    ],
    lexicon: [
      'fragrance', 'body spray', 'confidence', 'night out', 'music', 'party',
      'festival', 'dance', 'attraction', 'charisma', 'scent', 'gaming',
      'college', 'crew', 'nightlife', 'beat',
    ],
    permitted_categories: [
      'Music Festival', 'Nightlife', 'Gaming Culture', 'Campus Culture',
      'Creator Culture', 'Dance',
    ],
    forbidden_territory: [
      'objectification', 'harassment', 'grief', 'political protest',
      'religious ritual', 'substance abuse',
    ],
    primary_sku: 'AXE-DKTMPT-150ML',
    colour: '#10212b',
    lifecycle_stage: 'Growth',
    market: 'IN / Global',
  },
  {
    brand_id: 'horlicks',
    name: 'Horlicks',
    business_group: 'Nutrition',
    pillars: [
      'Scientifically proven nutrition for growing families',
      'Taller, stronger, sharper — evidenced, not claimed',
      'Trusted at the family table',
    ],
    lexicon: [
      'nutrition', 'growth', 'protein', 'immunity', 'milk', 'family', 'exam',
      'study', 'energy', 'height', 'bones', 'breakfast', 'children',
      'vitamins', 'strength', 'health',
    ],
    permitted_categories: [
      'Family Life', 'Exam Season', 'School Culture', 'Sport', 'Nutrition',
    ],
    forbidden_territory: [
      'unverified medical claim', 'disease cure', 'political protest', 'grief',
      'body shaming', 'disaster',
    ],
    primary_sku: 'HRL-CLASSIC-500G',
    colour: '#ca7b25',
    lifecycle_stage: 'Defend',
    market: 'IN',
  },
]

export const BRAND_BY_ID: Record<string, BrandProfile> = Object.fromEntries(
  BRANDS.map((b) => [b.brand_id, b]),
)

export function getBrand(brandId: string): BrandProfile {
  return BRAND_BY_ID[brandId] ?? BRANDS[0]
}
