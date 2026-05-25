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

// Fraction of a column's distinct values that confidently map to a weight map.
function coverage(values: string[], map: Record<string, number>): number {
  const distinct = Array.from(new Set(values.filter(Boolean)))
  if (!distinct.length) return 0
  const ok = distinct.filter((v) => bestKeyFor(v, map).score >= 0.5).length
  return ok / distinct.length
}

function colValues(rows: Record<string, string>[], key: string): string[] {
  return rows.map((r) => (r[key] ?? "").trim()).filter(Boolean)
}

// ── column auto-detection ───────────────────────────────────────────────────

const HEADER_HINTS: { field: keyof ColumnMapping; re: RegExp }[] = [
  { field: "q2", re: /(^|[^a-z])q?\.?\s*2([^0-9]|$)|vote.?history|which elections|elections.*voted|voted in/i },
  { field: "q3", re: /(^|[^a-z])q?\.?\s*3([^0-9]|$)|motivat/i },
  { field: "q4", re: /(^|[^a-z])q?\.?\s*4([^0-9]|$)|how.*(will|do) you (plan to )?vote|polling location|prepared/i },
  { field: "q5", re: /(^|[^a-z])q?\.?\s*5([^0-9]|$)|closest to you|people.*plan to vote|social/i },
  { field: "age", re: /^(age|age_?years?|respondent_?age|exact_?age)$/i },
  { field: "sex", re: /^(sex|gender|gender_?identity|demo_?gender)$/i },
  { field: "education", re: /^(education|educ|edu|education_?level|edu_?level|demo_?education)$/i },
  // DEMO_Ethnicity carries the Hispanic category and (being earlier in the file)
  // wins over DEMO_Race, which lacks it — so race/ethnicity classify correctly.
  { field: "race", re: /^(race|ethnicity|race_?ethnicity|ethnic|demo_?ethnicity|demo_?race)$/i },
  { field: "region", re: /^(region|census_?region|area)$/i },
  { field: "state", re: /^(state|st|state_?code|state_?abbr|demo_?state|us_?state)$/i },
  { field: "income", re: /^(income|hh_?income|household_?income|income_?band|demo_?income)$/i },
  { field: "party", re: /^(party|party_?id|q9_?partyid|party_?identification|political_?party)$/i },
  { field: "recall2024", re: /(2024|vote2024).*(vote|recall|choice|who)|who.*2024|presidential.*2024|recall/i },
]

export function autoDetect(parsed: ParsedCsv): ColumnMapping {
  const m: ColumnMapping = {}
  const { headers, rows } = parsed

  // 1) header hints
  for (const h of headers) {
    for (const hint of HEADER_HINTS) {
      if (!m[hint.field] && hint.re.test(h)) m[hint.field] = h
    }
  }
  // 2) value-content matching for Q3/Q4/Q5 (robust to opaque headers)
  const maps: [keyof ColumnMapping, Record<string, number>][] = [
    ["q3", Q3_MOTIVATION],
    ["q4", Q4_PREPAREDNESS],
    ["q5", Q5_SOCIAL],
  ]
  for (const [field, map] of maps) {
    if (m[field]) continue
    let best = { h: "", cov: 0 }
    for (const h of headers) {
      if (Object.values(m).includes(h)) continue
      const cov = coverage(colValues(rows, h), map)
      if (cov > best.cov) best = { h, cov }
    }
    if (best.cov >= 0.5) m[field] = best.h
  }
  return m
}

// Build the response→weight map for one column by fuzzy-matching its distinct
// values to the canonical PSI weights. Unmatched values default to 0.5.
export function buildWeightMap(
  rows: Record<string, string>[],
  col: string | undefined,
  canonical: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!col) return out
  for (const v of Array.from(new Set(colValues(rows, col)))) {
    const { key, score } = bestKeyFor(v, canonical)
    out[v] = score >= 0.4 ? canonical[key] : 0.5
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
  if (/post ?grad|master|phd|doctor|professional|jd|md|graduate degree/.test(v)) return { edu: "Postgrad", bin: "College" }
  if (/bachelor|college (grad|degree)|4 year|four year|ba\b|bs\b|undergrad/.test(v)) return { edu: "College grad", bin: "College" }
  if (/some college|associate|2 year|two year|aa\b|vocational|technical/.test(v)) return { edu: "Some college", bin: "No College" }
  if (/college/.test(v) && !/some/.test(v)) return { edu: "College grad", bin: "College" }
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

function regionOf(row: Record<string, string>, mapping: ColumnMapping): string {
  // explicit region column — match the 8-region vocabulary directly or via alias
  if (mapping.region) {
    const r = norm(row[mapping.region] ?? "")
    if (r) {
      const match = REGION8.find((reg) => norm(reg) === r)
      if (match) return match
      if (REGION_ALIAS[r]) return REGION_ALIAS[r]
    }
  }
  // state column — full name ("California"), "Illinois (US-IL)", or 2-letter code.
  // Fall back to the region column's value (when no state column) so a region
  // field that actually holds state names/codes still resolves instead of "West".
  const stRaw = mapping.state ? (row[mapping.state] ?? "").trim() : mapping.region ? (row[mapping.region] ?? "").trim() : ""
  if (stRaw) {
    const s = stRaw.split("(")[0].trim()
    const code = s.length === 2 ? s.toUpperCase() : STATE_NAME_TO_CODE[norm(s)] || ""
    if (code && STATE_TO_REGION[code]) return STATE_TO_REGION[code]
  }
  return "West" // default bucket; flagged via SMD if it distorts
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
  if (!v || /never voted|have never|none of/.test(v)) return { bucket: "new", count: 0 }
  // numeric count?
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
