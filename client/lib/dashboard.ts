// Generalized "horserace" detection + summary for the Overview dashboard.
//
// The reference mockups (SD Governor, LA Mayoral) are hardcoded to one race.
// This module instead infers the ballot question, its candidates, the leader
// and margin, and the RV→LV movement from *any* poll's toplines — so the same
// dashboard renders for every CSV without per-poll wiring. Pure + UI-free so it
// can be unit-tested and reused by the PDF/export paths later.

import type { QuestionToplines } from "@/lib/psi/service"
import type { ToplineOption } from "@/lib/types"

// Residual / non-candidate buckets that should never be treated as "the leader"
// and sort to the bottom of the tile grid regardless of share.
const RESIDUAL_RE =
  /\b(undecided|not sure|no opinion|none of (these|them|the above)|none|other(\s+candidate)?|don'?t know|\bdk\b|refused|haven'?t decided|someone else|would not vote|no answer|skipped|prefer not)\b/i

// Keywords in a question prompt that signal a vote-choice / ballot question.
const BALLOT_PROMPT_RE =
  /\b(vote|votes|voting|ballot|election|candidate|candidates|mayor|mayoral|governor|gubernatorial|senate|senator|congress|congressional|president|presidential|primary|runoff|re[- ]?elect|elect|head[- ]?to[- ]?head|horse\s?race|matchup|if the (election|race|primary).{0,40}(held|today)|who would you (vote|support)|support for)\b/i

export function isResidual(label: string): boolean {
  return RESIDUAL_RE.test(label.trim())
}

// A label that reads like a person/candidate name or short proper noun:
// 1–4 capitalized tokens, not a sentence, reasonably short.
function looksLikeName(label: string): boolean {
  const v = label.trim()
  if (!v || v.length > 32) return false
  if (/[?]/.test(v)) return false
  const tokens = v.split(/\s+/)
  if (tokens.length > 4) return false
  // At least one capitalized token (covers "Bass", "Karen Bass", "The Rock").
  return tokens.some((t) => /^[A-Z][A-Za-z.'’\-]*$/.test(t))
}

// Heuristic score for how much a question resembles a candidate ballot. Higher
// is more ballot-like; a question must clear MIN_SCORE to be auto-selected.
export function ballotScore(q: QuestionToplines): number {
  if (q.type !== "categorical" && q.type !== "binary") return 0
  const opts = q.rv.options
  if (opts.length < 2 || opts.length > 12) return 0

  let score = 0
  if (BALLOT_PROMPT_RE.test(q.prompt) || BALLOT_PROMPT_RE.test(q.key)) score += 4

  const named = opts.filter((o) => !isResidual(o.label) && looksLikeName(o.label))
  if (named.length >= 2) score += 3
  else if (named.length === 1) score += 1

  if (opts.some((o) => isResidual(o.label))) score += 1
  if (opts.length >= 2 && opts.length <= 8) score += 1

  // Penalize near-unanimous columns (yes/no flags, language indicators, etc.).
  const top = Math.max(...opts.map((o) => o.pct))
  if (top >= 95) score -= 4

  return score
}

const MIN_SCORE = 4

// Pick the most ballot-like question, or null when nothing qualifies (the
// dashboard then falls back to the first substantive question, generically).
export function detectBallotKey(toplines: QuestionToplines[]): string | null {
  let best: { key: string; score: number } | null = null
  for (const q of toplines) {
    const s = ballotScore(q)
    if (s >= MIN_SCORE && (!best || s > best.score)) best = { key: q.key, score: s }
  }
  return best?.key ?? null
}

// Questions eligible to drive the flagship: categorical/binary with 2–12 opts.
// Used to populate the manual override selector.
export function ballotCandidates(toplines: QuestionToplines[]): QuestionToplines[] {
  return toplines.filter(
    (q) => (q.type === "categorical" || q.type === "binary") && q.rv.options.length >= 2 && q.rv.options.length <= 12,
  )
}

export interface RankedOption {
  label: string
  pct: number // share in the selected universe
  otherPct: number // share in the comparison universe (for the RV↔LV delta)
  delta: number // pct − otherPct
  residual: boolean
  color: string
}

export interface BallotSummary {
  prompt: string
  ranked: RankedOption[] // candidates first (by share), residuals last
  leader?: RankedOption
  second?: RankedOption
  margin: number // leader.pct − second.pct (0 when only one candidate)
  tied: boolean
  // Margin movement between universes: (margin in selected) − (margin in other).
  marginShift: number
}

// Distinct, stable hues assigned by candidate rank. Residual buckets get a muted
// slate. Mirrors the mockups' per-candidate coloring without hardcoding names.
const PALETTE = [
  "#1d4ed8", // blue
  "#b91c1c", // red
  "#15803d", // green
  "#7c3aed", // violet
  "#b45309", // amber
  "#0891b2", // cyan
  "#be185d", // pink
  "#4338ca", // indigo
]
const RESIDUAL_COLOR = "#64748b"

function optMap(options: ToplineOption[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of options) m.set(o.label, o.pct)
  return m
}

// Build the ranked candidate list for one selected universe, with deltas vs the
// comparison universe. `selected` / `other` are the same question's option sets.
export function summarizeBallot(
  q: QuestionToplines,
  selected: ToplineOption[],
  other: ToplineOption[],
): BallotSummary {
  const otherByLabel = optMap(other)
  const rows = selected.map((o) => ({
    label: o.label,
    pct: o.pct,
    otherPct: otherByLabel.get(o.label) ?? 0,
    residual: isResidual(o.label),
  }))

  // Candidates by share desc, then residual buckets by share desc.
  const candidates = rows.filter((r) => !r.residual).sort((a, b) => b.pct - a.pct)
  const residuals = rows.filter((r) => r.residual).sort((a, b) => b.pct - a.pct)

  const ranked: RankedOption[] = [...candidates, ...residuals].map((r, i) => ({
    ...r,
    delta: r.pct - r.otherPct,
    color: r.residual ? RESIDUAL_COLOR : PALETTE[candidates.findIndex((c) => c.label === r.label) % PALETTE.length],
  }))

  const leader = ranked.find((r) => !r.residual)
  const second = ranked.filter((r) => !r.residual)[1]
  const margin = leader && second ? leader.pct - second.pct : 0
  const tied = !!leader && !!second && Math.abs(margin) < 0.5

  // Margin in the comparison universe, for the RV↔LV margin-shift readout.
  const otherMargin = (() => {
    const cand = other.filter((o) => !isResidual(o.label)).sort((a, b) => b.pct - a.pct)
    return cand.length >= 2 ? cand[0].pct - cand[1].pct : 0
  })()

  return {
    prompt: q.prompt,
    ranked,
    leader,
    second,
    margin,
    tied,
    marginShift: margin - otherMargin,
  }
}

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`
}

export function fmtSigned(n: number, digits = 1): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`
}
