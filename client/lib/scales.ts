// Canonical answer scales, ordered from most-negative to most-positive. Used to
// (a) detect that a question is an ordered Likert/approval/etc. scale and
// (b) sort its options so a diverging bar reads correctly. Each entry lists the
// label variants we recognise; matching is case/space/punctuation-insensitive.

export const CANONICAL_SCALES: string[][] = [
  // Agreement (5- and 7-point share one ordering)
  [
    "strongly disagree",
    "disagree",
    "somewhat disagree",
    "neither agree nor disagree",
    "neutral",
    "somewhat agree",
    "agree",
    "strongly agree",
  ],
  // Approval
  [
    "strongly disapprove",
    "disapprove",
    "somewhat disapprove",
    "neither approve nor disapprove",
    "somewhat approve",
    "approve",
    "strongly approve",
  ],
  // Support / opposition
  [
    "strongly oppose",
    "oppose",
    "somewhat oppose",
    "neither support nor oppose",
    "somewhat support",
    "support",
    "strongly support",
  ],
  // Satisfaction
  [
    "very dissatisfied",
    "dissatisfied",
    "somewhat dissatisfied",
    "neither satisfied nor dissatisfied",
    "neutral",
    "somewhat satisfied",
    "satisfied",
    "very satisfied",
  ],
  // Likelihood
  [
    "very unlikely",
    "unlikely",
    "somewhat unlikely",
    "neither likely nor unlikely",
    "somewhat likely",
    "likely",
    "very likely",
  ],
  [
    "definitely won't",
    "definitely will not",
    "probably won't",
    "probably will not",
    "might or might not",
    "probably will",
    "definitely will",
  ],
  // Frequency
  ["never", "rarely", "sometimes", "often", "always"],
  // Quality / performance
  ["very poor", "poor", "fair", "good", "excellent"],
  // Importance
  [
    "not at all important",
    "slightly important",
    "moderately important",
    "very important",
    "extremely important",
  ],
  // Familiarity
  ["never heard of it", "heard of it", "somewhat familiar", "familiar", "very familiar"],
  // Confidence
  [
    "not at all confident",
    "not very confident",
    "somewhat confident",
    "very confident",
    "extremely confident",
  ],
]

// Tokens that mark the neutral midpoint of a scale.
const NEUTRAL_TOKENS = [
  "neutral",
  "neither agree nor disagree",
  "neither approve nor disapprove",
  "neither support nor oppose",
  "neither satisfied nor dissatisfied",
  "neither likely nor unlikely",
  "might or might not",
  "fair",
  "moderately important",
  "sometimes",
  "somewhat familiar",
  "somewhat confident",
]

export function normalizeLabel(s: string): string {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/['’]/g, "'")
}

export function isNeutralLabel(label: string): boolean {
  return NEUTRAL_TOKENS.includes(normalizeLabel(label))
}

// Given the distinct answer labels for a column, return the canonical scale
// that best covers them (every label must appear in the scale), or null.
export function matchScale(distinctLabels: string[]): string[] | null {
  if (distinctLabels.length < 2) return null
  const norm = distinctLabels.map(normalizeLabel)
  let best: { scale: string[]; covered: number } | null = null
  for (const scale of CANONICAL_SCALES) {
    const set = new Set(scale)
    const allCovered = norm.every((l) => set.has(l))
    if (!allCovered) continue
    const covered = norm.length
    if (!best || covered > best.covered) best = { scale, covered }
  }
  return best ? best.scale : null
}

// Order a set of distinct labels by a canonical scale, dropping scale entries
// that don't appear in the data. Returns ordered ORIGINAL labels.
export function orderByScale(distinctLabels: string[], scale: string[]): string[] {
  const byNorm = new Map<string, string>()
  for (const l of distinctLabels) byNorm.set(normalizeLabel(l), l)
  const ordered: string[] = []
  for (const s of scale) {
    const orig = byNorm.get(s)
    if (orig != null) {
      ordered.push(orig)
      byNorm.delete(s)
    }
  }
  // Append anything that didn't match (shouldn't happen after matchScale).
  for (const leftover of byNorm.values()) ordered.push(leftover)
  return ordered
}
