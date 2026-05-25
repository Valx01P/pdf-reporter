// Phase 1 — shared data foundation. Parse the survey CSV, fuzzy-detect the
// Q2/Q3/Q4/Q5 + demographic columns, run the quality screen (speeders +
// straightliners), and derive every demographic variable the raking engine
// needs. After this the RV and LV tracks share no computation.

import Papa from "papaparse"
import { Q3_MOTIVATION, Q4_PREPAREDNESS, Q5_SOCIAL, STATE_TO_REGION, REGION8 } from "./constants"
import type { ColumnMapping, DerivedRespondent, HistoryBucket, QualityReport } from "./types"

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsv(csvText: string): ParsedCsv {
  // Strip a UTF-8 BOM and let papaparse auto-detect the delimiter (CSV/TSV/;).
  const clean = String(csvText || "").replace(/^﻿/, "").trim()
  const res = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  })
  const headers = (res.meta.fields || []).map((h) => h.trim()).filter(Boolean)
  const rows = res.data
    .map((r) => {
      const o: Record<string, string> = {}
      for (const h of headers) o[h] = (r[h] ?? "").toString().trim()
      return o
    })
    .filter((r) => headers.some((h) => r[h] !== ""))
  return { headers, rows }
}

// ── fuzzy matching helpers ──────────────────────────────────────────────────

export function norm(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length > 2))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// Best map key for a single response value, with a similarity score.
export function bestKeyFor(value: string, map: Record<string, number>): { key: string; score: number } {
  const vt = tokens(value)
  const vn = norm(value)
  let best = { key: "", score: 0 }
  for (const key of Object.keys(map)) {
    const kn = norm(key)
    let score = jaccard(vt, tokens(key))
    if (vn === kn) score = 1
    else if (kn.includes(vn) || vn.includes(kn)) score = Math.max(score, 0.85)
    if (score > best.score) best = { key, score }
  }
  return best
}

function colValues(rows: Record<string, string>[], key: string): string[] {
  return rows.map((r) => (r[key] ?? "").trim()).filter(Boolean)
}

// ── column auto-detection ───────────────────────────────────────────────────

// Fuzzy, label-tolerant detection. A header is scored against each field's
// candidate phrases by token overlap, plus a bonus when the field's primary
// keyword appears as a whole word — so real-world labels like "US Region",
// "Education Level", or "Party ID (With Leaners)" are picked up even though they
// don't match a rigid pattern. Best score wins per field; ties break toward the
// earlier column. Q3/Q4/Q5 and the recall column are detected separately (by
// option-content and past-vote phrasing) so genuine survey questions aren't
// hijacked into a likely-voter slot and dropped from the toplines.
const FIELD_CANDIDATES: { field: keyof ColumnMapping; phrases: string[]; primary: RegExp }[] = [
  { field: "q2", phrases: ["vote history", "voting history", "which elections", "elections voted", "voted in", "how often do you vote", "vote frequency", "frequency of voting"], primary: /\b(vote|voting) history\b|how often.*\bvote\b|\bvot(e|ing) frequen/ },
  { field: "age", phrases: ["age", "age group", "age band", "age range", "age bracket", "respondent age"], primary: /\bage\b/ },
  { field: "sex", phrases: ["sex", "gender", "gender identity"], primary: /\b(sex|gender)\b/ },
  { field: "education", phrases: ["education", "education level", "level of education", "educational attainment", "highest education", "educ"], primary: /\beducation(al)?\b/ },
  { field: "race", phrases: ["race", "ethnicity", "race ethnicity", "race and ethnicity", "racial"], primary: /\b(race|ethnic|racial)/ },
  { field: "region", phrases: ["region", "us region", "census region", "geographic region", "region of country", "area"], primary: /\bregion\b/ },
  { field: "state", phrases: ["state", "us state", "state code", "state abbreviation", "home state", "state of residence"], primary: /\bstate\b/ },
  { field: "income", phrases: ["income", "household income", "hh income", "annual income", "family income"], primary: /\bincome\b/ },
  { field: "party", phrases: ["party", "party id", "partyid", "party identification", "political party", "party affiliation", "party id with leaners", "partisan id"], primary: /\bpart(y|isan)\b|partyid/ },
]

function scoreHeader(header: string, cand: { phrases: string[]; primary: RegExp }): number {
  const ht = tokens(header)
  const hn = norm(header)
  let best = 0
  for (const p of cand.phrases) {
    const pn = norm(p)
    if (hn === pn) return 1 // exact (normalized) header == phrase
    let s = jaccard(ht, tokens(p))
    // Header contains a whole MULTI-WORD phrase as words ("US Region" ⊃ "us
    // region"). Multi-word only: a single keyword contained in a long question
    // ("…which party's candidate…") is not strong evidence — that's left to the
    // token-count-gated primary bonus below, so questions aren't claimed.
    if (pn.includes(" ") && new RegExp(`\\b${pn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hn)) s = Math.max(s, 0.8)
    best = Math.max(best, s)
  }
  // Primary-keyword bonus only for short, demographic-like headers — so a long
  // survey question that merely mentions a keyword (e.g. "which party's
  // candidate…") isn't claimed as that demographic and dropped from the toplines.
  if (ht.size <= 4 && cand.primary.test(hn)) best = Math.max(best, 0.7)
  return best
}

// Coverage by token overlap (not substring): the fraction of a column's distinct
// values that substantially match a canonical option. Used to detect Q3/Q4/Q5 by
// their answer wording, so a short generic scale ("Very"/"Somewhat") doesn't get
// claimed just because those words appear inside a long canonical option.
function contentCoverage(values: string[], map: Record<string, number>): number {
  const distinct = Array.from(new Set(values.filter(Boolean)))
  if (!distinct.length) return 0
  const keyTokens = Object.keys(map).map(tokens)
  const ok = distinct.filter((v) => {
    const vt = tokens(v)
    return vt.size > 0 && keyTokens.some((kt) => jaccard(vt, kt) >= 0.5)
  }).length
  return ok / distinct.length
}

export function autoDetect(parsed: ParsedCsv): ColumnMapping {
  const m: ColumnMapping = {}
  const { headers, rows } = parsed

  // 1) scored header matching, assigned greedily (highest score first; earlier
  // column breaks ties — so e.g. an Ethnicity column outranks a later Race one).
  const pairs: { field: keyof ColumnMapping; header: string; idx: number; score: number }[] = []
  headers.forEach((h, idx) => {
    for (const cand of FIELD_CANDIDATES) {
      const score = scoreHeader(h, cand)
      if (score >= 0.5) pairs.push({ field: cand.field, header: h, idx, score })
    }
  })
  pairs.sort((a, b) => b.score - a.score || a.idx - b.idx)
  const usedHeaders = new Set<string>()
  for (const p of pairs) {
    if (m[p.field] || usedHeaders.has(p.header)) continue
    m[p.field] = p.header
    usedHeaders.add(p.header)
  }

  // 2) recall column — a past-vote partisan anchor, not the horse-race ballot.
  if (!m.recall2024) {
    const recall = detectRecall(headers.filter((h) => !usedHeaders.has(h)))
    if (recall) {
      m.recall2024 = recall
      usedHeaders.add(recall)
    }
  }

  // 3) Q3/Q4/Q5 by option-content (robust to opaque headers); only over columns
  // not already claimed, so a real question is never consumed as a screen var.
  const maps: [keyof ColumnMapping, Record<string, number>][] = [
    ["q3", Q3_MOTIVATION],
    ["q4", Q4_PREPAREDNESS],
    ["q5", Q5_SOCIAL],
  ]
  for (const [field, map] of maps) {
    if (m[field]) continue
    let best = { h: "", cov: 0 }
    for (const h of headers) {
      if (usedHeaders.has(h) || Object.values(m).includes(h)) continue
      const cov = contentCoverage(colValues(rows, h), map)
      if (cov > best.cov) best = { h, cov }
    }
    // Require a strong option-wording match so a generic scale (e.g. a 4-point
    // enthusiasm question) isn't claimed as an LV screen and pulled out of the
    // toplines; a genuine PSI Q3/Q4/Q5 column matches near 1.0.
    if (best.cov >= 0.6) {
      m[field] = best.h
      usedHeaders.add(best.h)
    }
  }

  // 3b) Likely-voter screens by topic — a turnout-intent question ("How likely
  // are you to vote") → Q4 and an enthusiasm/motivation question → Q3, when the
  // option wording didn't match the canonical PSI maps. Specific phrasing only,
  // so substantive questions aren't pulled into a screen slot; their ordinal
  // answers are scored by `ordinalPropensity` in buildWeightMap.
  const SCREEN: { field: keyof ColumnMapping; re: RegExp }[] = [
    { field: "q4", re: /how likely.*\bvote\b|likelihood (of|to) vot|intend.*\bvote\b|will you vote|plan to vote|certain to vote/ },
    { field: "q3", re: /enthusias|how motivated|motivation (to|for) vot/ },
  ]
  for (const s of SCREEN) {
    if (m[s.field]) continue
    const h = headers.find((h) => !usedHeaders.has(h) && s.re.test(norm(h)))
    if (h) {
      m[s.field] = h
      usedHeaders.add(h)
    }
  }

  // 4) Q-number header fallback for the LV screens (e.g. "Q3_VoteIntent",
  // "Q4: Ballot method") when option-content didn't already claim them. Matches
  // only Q2–Q5 at the start of the header, so Q10/Q12 etc. are never caught.
  const qnumField: Record<string, keyof ColumnMapping> = { "2": "q2", "3": "q3", "4": "q4", "5": "q5" }
  for (const h of headers) {
    if (usedHeaders.has(h)) continue
    const mq = norm(h).match(/^q ?([2-5])\b/)
    if (!mq) continue
    const field = qnumField[mq[1]]
    if (field && !m[field]) {
      m[field] = h
      usedHeaders.add(h)
    }
  }

  // 5) Region refinement: when several columns look like a region, prefer the
  // one whose values best fill the 8-region benchmark — so a full national-region
  // column wins over a 4-region "US Region" the rake would otherwise have to drop.
  const regionCand = FIELD_CANDIDATES.find((c) => c.field === "region")
  if (regionCand) {
    const region8 = REGION8 as readonly string[]
    const fit = (h: string) =>
      Array.from(new Set(colValues(rows, h))).filter((v) => region8.includes(canonicalRegion(v))).length
    let best = { h: m.region || "", score: m.region ? fit(m.region) : -1 }
    headers.forEach((h) => {
      if (scoreHeader(h, regionCand) < 0.5) return
      const f = fit(h)
      if (f > best.score) best = { h, score: f }
    })
    if (best.h) m.region = best.h
  }
  return m
}

// A horse-race ballot ("if the election were held today…") or turnout screen is
// NOT a recall — weighting to it would be circular. Exclude that phrasing.
const BALLOT_RE =
  /held today|if the .*election|election .*(were|was) held|going to vote|plan(ning)? to vote|how (likely|enthusiastic)|would you (support|vote|pick|choose)|candidates? were|support for|head to head|generic ballot/
// A real past-vote recall: "who did you vote for", an explicit recall, a
// "vote(d) … in <year>" past-election phrasing, or a compact "<year>vote" /
// "vote<year>" column name (e.g. "Q6_2024Vote").
const RECALL_RE =
  /who did you vote for|\brecall(ed)?\b|vote(d)? for .*(in|during) (the )?(19|20)\d\d|(19|20)\d\d .*(presidential|general|midterm|election).*\bvote|(19|20)\d\d ?vote|vote ?(19|20)\d\d/

// Vote-history / turnout-frequency phrasing — that's the Q2 variable, not a
// single past-vote recall, so it must not be picked up as the recall anchor.
const HISTORY_RE = /select all that apply|at least once|which (of the following )?election|elections .*(did|have) you vot|years did you vote|how often/

function detectRecall(headers: string[]): string | undefined {
  const cands = headers.filter((h) => {
    const hn = norm(h)
    if (BALLOT_RE.test(hn) || HISTORY_RE.test(hn)) return false
    return RECALL_RE.test(hn) || (/\bvote/.test(hn) && /(19|20)\d\d/.test(hn) && /\bwho\b|did you/.test(hn))
  })
  if (!cands.length) return undefined
  // Prefer the most recent past election the column refers to.
  const yearOf = (h: string) => {
    const ys = norm(h).match(/(19|20)\d\d/g)
    return ys ? Math.max(...ys.map(Number)) : 0
  }
  return cands.sort((a, b) => yearOf(b) - yearOf(a))[0]
}

// Score a likely-voter screen answer on an ordinal turnout/enthusiasm scale to a
// 0..1 propensity, or null when it isn't recognizable as one. Lets a screen that
// doesn't use the canonical PSI wording (e.g. "Certain / Likely / Unlikely",
// "Very / Somewhat / Not at all") still differentiate respondents in the LV
// model. Order matters: neutral is checked before "unlikely" so "Neither likely
// nor unlikely" lands in the middle; negatives before positives.
export function ordinalPropensity(raw: string): number | null {
  const v = norm(raw)
  if (!v) return null
  if (/already voted|have (already )?voted|i voted/.test(v)) return 0.98 // already cast = certain
  if (/neither|unsure|not sure|undecided|toss up|50 ?50|maybe|it depends|moderate/.test(v)) return 0.45
  if (/not at all|certain not|definitely not|will not|won t\b|no chance|\bnever\b/.test(v)) return 0.06
  if (/not (very|too|that|likely)|unlikely|probably not|doubt|slightly|a little|^low$/.test(v)) return 0.22
  if (/\bcertain\b|definitely|absolutely|extremely|very likely|highly likely/.test(v)) return 0.95
  if (/^very\b|very (likely|motivated|enthusiastic)|enthusiastic|highly|\blikely\b/.test(v)) return 0.85
  if (/somewhat|fairly|probably|^likely|sometimes/.test(v)) return 0.62
  return null
}

// Build the response→weight map for one column by fuzzy-matching its distinct
// values to the canonical PSI weights. Values that don't match fall back to an
// ordinal turnout/enthusiasm propensity, then to 0.5 (neutral).
export function buildWeightMap(
  rows: Record<string, string>[],
  col: string | undefined,
  canonical: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!col) return out
  for (const v of Array.from(new Set(colValues(rows, col)))) {
    const { key, score } = bestKeyFor(v, canonical)
    out[v] = score >= 0.4 ? canonical[key] : (ordinalPropensity(v) ?? 0.5)
  }
  return out
}

// ── demographic derivation ──────────────────────────────────────────────────

function ageBucket(raw: string): string {
  const n = Number(raw)
  if (Number.isFinite(n)) {
    if (n < 30) return "18-29"
    if (n < 45) return "30-44"
    if (n < 65) return "45-64"
    return "65+"
  }
  const lead = raw.match(/\d+/)
  if (lead) {
    const a = Number(lead[0])
    if (a < 30) return "18-29"
    if (a < 45) return "30-44"
    if (a < 65) return "45-64"
    return "65+"
  }
  return "18-29"
}

function sexOf(raw: string): string {
  const v = norm(raw)
  if (/(^|\b)(f|female|woman|women)\b/.test(v)) return "Female"
  if (/(^|\b)(m|male|man|men)\b/.test(v)) return "Male"
  return "Female" // non-binary / unknown coerced; counted as a warning upstream
}

function eduOf(raw: string): { edu: string; bin: "College" | "No College" } {
  const v = norm(raw)
  // Explicit "No College" / "high school" must be tested before the generic
  // /college/ rule below, or "No College" gets miscounted as College.
  if (/\b(no|non|not|without) college\b|noncollege|high school|hs (or|degree|grad|diploma)|less than (a )?college|no degree|did not (finish|complete|graduate)|some high school|ged\b/.test(v))
    return { edu: "HS or less", bin: "No College" }
  if (/post ?grad|master|phd|doctor|professional|jd|md|graduate degree/.test(v)) return { edu: "Postgrad", bin: "College" }
  if (/bachelor|college (grad|degree)|4 year|four year|ba\b|bs\b|undergrad/.test(v)) return { edu: "College grad", bin: "College" }
  if (/some college|associate|2 year|two year|aa\b|vocational|technical/.test(v)) return { edu: "Some college", bin: "No College" }
  if (/college|university|degree/.test(v)) return { edu: "College grad", bin: "College" } // plain "College"
  return { edu: "HS or less", bin: "No College" }
}

function raceEduOf(raceRaw: string, bin: "College" | "No College"): string {
  const v = norm(raceRaw)
  if (/black|african/.test(v)) return "Black"
  if (/hispanic|latino|latina|latinx/.test(v)) return "Hispanic"
  if (/white|caucasian|anglo/.test(v)) return bin === "College" ? "White College" : "White No College"
  return "Asian/Other"
}

// Full-name region labels (e.g. usmay.py's NATIONAL_REGIONS) that don't
// norm-match a REGION8 key, mapped to their REGION8 equivalent.
const REGION_ALIAS: Record<string, string> = {
  "new england": "Northeast",
  "west mountain pacific": "West",
  "appalachia south interior": "Appalachia",
}

// The 4 standard US Census regions — many polling files use these instead of
// the 8-region scheme. Recognized and preserved as-is so they survive into the
// composition, crosstabs, and (via the pipeline's overlap guard) custom weighting.
export const CENSUS4 = ["Northeast", "Midwest", "South", "West"] as const

// Canonicalize a raw region string to a known region label (REGION8, Census-4,
// or a full-name alias), or "" if it isn't recognizable as a region.
function canonicalRegion(raw: string): string {
  const r = norm(raw)
  if (!r) return ""
  const r8 = REGION8.find((reg) => norm(reg) === r)
  if (r8) return r8
  const c4 = CENSUS4.find((reg) => norm(reg) === r)
  if (c4) return c4
  if (REGION_ALIAS[r]) return REGION_ALIAS[r]
  // partial match onto a Census region (e.g. "South Atlantic" → "South")
  for (const reg of CENSUS4) if (r.includes(norm(reg))) return reg
  return ""
}

function regionOf(row: Record<string, string>, mapping: ColumnMapping): string {
  // explicit region column — keep the recognized region category (REGION8 or
  // the 4 Census regions) rather than forcing everything into one bucket.
  if (mapping.region) {
    const c = canonicalRegion(row[mapping.region] ?? "")
    if (c) return c
  }
  // state column — full name ("California"), "Illinois (US-IL)", or 2-letter code.
  // Fall back to the region column's value (when no state column) so a region
  // field that actually holds state names/codes still resolves.
  const stRaw = mapping.state ? (row[mapping.state] ?? "").trim() : mapping.region ? (row[mapping.region] ?? "").trim() : ""
  if (stRaw) {
    const s = stRaw.split("(")[0].trim()
    const code = s.length === 2 ? s.toUpperCase() : STATE_NAME_TO_CODE[norm(s)] || ""
    if (code && STATE_TO_REGION[code]) return STATE_TO_REGION[code]
  }
  // Last resort: keep the raw region value (so an unknown scheme still forms its
  // own cells for display) rather than silently dumping everyone into one region.
  const rawRegion = mapping.region ? (row[mapping.region] ?? "").trim() : ""
  return rawRegion || "West"
}

// 7-band income brackets, in display order (matches the Wisconsin tabbook).
export const INCOME_BANDS = ["$0–$25k", "$25–$50k", "$50–$75k", "$75–$100k", "$100–$150k", "$150–$200k", "$200k+"]

// Map a raw income string to a band. Handles full strings ("$100,000 to
// $124,999", "Less than $5,000"), shorthand ("$250k", "$1 million +"), and
// values that are already a canonical band (re-fed pre-binned data). Prefers the
// first amount after a "$" so a leading band index ("2 - $30,000") isn't read as
// the income. Returns "" when no amount is present.
function incomeBand(raw: string): string {
  const s = String(raw).trim()
  if (!s) return ""
  if (INCOME_BANDS.includes(s)) return s
  const clean = s.replace(/,/g, "")
  const m =
    clean.match(/\$\s*(\d+(?:\.\d+)?)\s*([km]|thousand|million|billion)?/i) ||
    clean.match(/(\d+(?:\.\d+)?)\s*([km]|thousand|million|billion)?/i)
  if (!m) return ""
  let n = Number(m[1])
  if (!Number.isFinite(n)) return ""
  const suf = (m[2] || "").toLowerCase()
  if (suf === "k" || suf === "thousand") n *= 1_000
  else if (suf === "m" || suf === "million") n *= 1_000_000
  else if (suf === "billion") n *= 1_000_000_000
  if (n < 25000) return "$0–$25k"
  if (n < 50000) return "$25–$50k"
  if (n < 75000) return "$50–$75k"
  if (n < 100000) return "$75–$100k"
  if (n < 150000) return "$100–$150k"
  if (n < 200000) return "$150–$200k"
  return "$200k+"
}

// Party identification → Republican / Democrat / Independent. Anything that is
// neither major party (incl. "Independent / Other") buckets to Independent.
function partyOf(raw: string): string {
  const v = norm(raw)
  if (!v) return ""
  if (v.includes("republican")) return "Republican"
  if (v.includes("democrat")) return "Democrat"
  return "Independent"
}

function recallOf(raw: string): { recall: string; voted: boolean } {
  const v = norm(raw)
  if (/trump|republican|gop/.test(v)) return { recall: "Trump", voted: true }
  if (/harris|biden|democrat|kamala/.test(v)) return { recall: "Harris", voted: true }
  if (/did not|didn t|didnt|not vote|no vote|stayed home|none|dnv|abstain|too young|not eligible/.test(v))
    return { recall: "DNV", voted: false }
  if (v === "" ) return { recall: "DNV", voted: false }
  return { recall: "Third", voted: true } // any other named candidate
}

function historyOf(raw: string): { bucket: HistoryBucket; count: number } {
  const v = norm(raw)
  if (!v) return { bucket: "new", count: 0 }
  // Frequency-style answers ("How often do you vote?": Always / Sometimes /
  // Rarely / Never / Recently registered) — bucket directly.
  if (/\b(always|every election|every time|all elections|in every)\b/.test(v)) return { bucket: "consistent", count: 3 }
  if (/\b(rarely|seldom|recently registered|newly registered|first time|just registered)\b|never voted|have never|none of/.test(v))
    return { bucket: "new", count: 0 }
  if (/^never$|\bnever\b/.test(v)) return { bucket: "new", count: 0 }
  if (/\b(only in presidential|presidential.*only|sometimes|occasional|usually|most elections|most of the time)\b/.test(v))
    return { bucket: "occasional", count: 1 }
  // numeric count, or a multi-select list of elections ("2024 General; 2022 …")
  const asNum = Number(raw)
  let count: number
  if (Number.isFinite(asNum)) count = asNum
  else count = String(raw).split(/[;,|/]+/).map((s) => s.trim()).filter(Boolean).length
  if (count >= 3) return { bucket: "consistent", count }
  if (count >= 1) return { bucket: "occasional", count }
  return { bucket: "new", count: 0 }
}

// ── quality screen + assembly ───────────────────────────────────────────────

const DURATION_RE = /^(duration|loi|time_?taken|completion_?time|elapsed|seconds|response_?time)$/i

export function deriveAll(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  substantiveKeys: string[],
  thresholds = { speederPct: 0.3 },
): { derived: DerivedRespondent[]; quality: QualityReport; coerced: number } {
  const { headers, rows } = parsed
  const durationCol = headers.find((h) => DURATION_RE.test(h))

  // speeders
  const speederSet = new Set<number>()
  if (durationCol) {
    const durs = rows.map((r) => Number(r[durationCol])).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
    if (durs.length) {
      const median = durs[Math.floor(durs.length / 2)]
      const floor = median * thresholds.speederPct
      rows.forEach((r, i) => {
        const d = Number(r[durationCol])
        if (Number.isFinite(d) && d > 0 && d < floor) speederSet.add(i)
      })
    }
  }

  // straightliners across the substantive battery (>=4 answered, all identical)
  const straightSet = new Set<number>()
  if (substantiveKeys.length >= 4) {
    rows.forEach((r, i) => {
      const answers = substantiveKeys.map((k) => (r[k] ?? "").trim()).filter(Boolean)
      if (answers.length >= 4 && new Set(answers.map((a) => a.toLowerCase())).size === 1) straightSet.add(i)
    })
  }

  const removed = new Set<number>([...speederSet, ...straightSet])
  const derived: DerivedRespondent[] = []
  let coerced = 0

  rows.forEach((row, i) => {
    if (removed.has(i)) return
    const ageBkt = mapping.age ? ageBucket(row[mapping.age] ?? "") : "18-29"
    const sexRaw = mapping.sex ? row[mapping.sex] ?? "" : ""
    const sex = sexOf(sexRaw)
    if (sexRaw && sex === "Female" && !/(^|\b)(f|female|woman|women)\b/.test(norm(sexRaw))) coerced++
    const { edu, bin } = mapping.education ? eduOf(row[mapping.education] ?? "") : { edu: "HS or less", bin: "No College" as const }
    const raceEdu = raceEduOf(mapping.race ? row[mapping.race] ?? "" : "", bin)
    const region = regionOf(row, mapping)
    const income = mapping.income ? incomeBand(row[mapping.income] ?? "") : ""
    const party = mapping.party ? partyOf(row[mapping.party] ?? "") : ""
    const { recall, voted } = mapping.recall2024 ? recallOf(row[mapping.recall2024] ?? "") : { recall: "DNV", voted: false }
    const { bucket, count } = mapping.q2 ? historyOf(row[mapping.q2] ?? "") : { bucket: "occasional" as HistoryBucket, count: 1 }

    derived.push({
      i,
      ageBucket: ageBkt,
      sex,
      edu,
      eduBin: bin,
      raceEdu,
      region,
      income,
      party,
      recall,
      ageSex: `${ageBkt} · ${sex}`,
      eduSex: `${sex} · ${bin === "College" ? "College" : "No College"}`,
      ageEdu: `${ageBkt} · ${bin === "College" ? "College" : "No College"}`,
      q3: mapping.q3 ? (row[mapping.q3] ?? "").trim() : "",
      q4: mapping.q4 ? (row[mapping.q4] ?? "").trim() : "",
      q5: mapping.q5 ? (row[mapping.q5] ?? "").trim() : "",
      historyBucket: bucket,
      votedElections: count,
      voted2024: voted,
    })
  })

  return {
    derived,
    coerced,
    quality: {
      total: rows.length,
      speeders: speederSet.size,
      straightliners: straightSet.size,
      removed: removed.size,
      kept: rows.length - removed.size,
      durationCol,
    },
  }
}

// minimal full-name → 2-letter for region mapping
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
}
