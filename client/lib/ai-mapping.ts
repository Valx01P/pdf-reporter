// Server-only. Suggests column→variable mappings for the fields the
// auto-detector couldn't fill, using OpenAI when configured. Degrades gracefully
// to no suggestions (the user maps manually) when there's no key or the call
// fails. Never invents column names — suggestions are validated against the CSV.

import OpenAI from "openai"
import type { ParsedCsv } from "./psi/derive"
import type { ColumnMapping } from "./psi/types"

const FAST_MODEL = process.env.OPENAI_MODEL_FAST || "gpt-4o-mini"

// The fields the reviewer can ask the AI to fill, with a plain-language brief.
export const MAPPABLE_FIELDS: { field: keyof ColumnMapping; label: string; desc: string }[] = [
  { field: "age", label: "Age", desc: "respondent age or age band (e.g. 18-29, 45-64)" },
  { field: "sex", label: "Sex / Gender", desc: "respondent sex or gender" },
  { field: "education", label: "Education", desc: "educational attainment (college / no college, degree level)" },
  { field: "race", label: "Race / ethnicity", desc: "race and/or ethnicity, including Hispanic" },
  { field: "region", label: "Region", desc: "US geographic region (Census region or national region)" },
  { field: "state", label: "State", desc: "US state name, abbreviation, or code" },
  { field: "party", label: "Party ID", desc: "party identification (Republican / Democrat / Independent)" },
  { field: "recall2024", label: "Past-vote recall", desc: "who the respondent voted for in a PRIOR presidential election (a recall) — NOT the current head-to-head ballot or a turnout-intent question" },
  { field: "q3", label: "LV screen — motivation", desc: "likely-voter screen: how motivated or enthusiastic the respondent is to vote" },
  { field: "q4", label: "LV screen — turnout intent", desc: "likely-voter screen: how likely the respondent is to vote, or how they will vote" },
  { field: "q5", label: "LV screen — social", desc: "likely-voter screen: whether the people they know plan to vote" },
]

export interface MappingSuggestion {
  field: string
  column: string | null
  reason: string
}

// Keyword hints per field for the deterministic fallback (used when the model is
// unavailable or leaves a field null). Matched against the column header AND its
// sample values, so "How enthusiastic…" → q3 even without an LLM.
const FIELD_HINTS: Record<string, string[]> = {
  age: ["age", "18-29", "30-44", "45-64", "65+", "years old", "age group", "age band", "agegroup"],
  sex: ["gender", "sex", "male", "female"],
  education: ["education", "educ", "college", "degree", "school", "bachelor", "postgrad", "no college", "high school"],
  race: ["race", "ethnic", "hispanic", "white", "black", "asian", "latino"],
  region: ["region", "state", "census", "northeast", "midwest", "south", "west", "geography", "area", "division"],
  recall2024: ["2020", "2016", "previous", "prior", "last election", "did you vote for", "recall", "who did you vote"],
  q3: ["motivat", "enthusias", "eager", "excited", "how important is it", "how strongly"],
  q4: ["how likely", "likely to vote", "turnout", "intend to vote", "will you vote", "plan to vote", "already voted", "how often do you vote"],
  q5: ["people you know", "people around you", "friends", "family", "social", "most plan to vote", "others vote", "closest to"],
}

// Score a column for a field by how many hints appear in its header + samples.
function hintScore(field: string, header: string, samples: string[]): number {
  const hints = FIELD_HINTS[field] || []
  const hay = (header + " " + samples.join(" ")).toLowerCase()
  let score = 0
  for (const h of hints) if (hay.includes(h)) score += h.length >= 5 ? 2 : 1
  return score
}

// Deterministic backstop: pick the best-scoring unused column per field. No LLM.
function localSuggest(
  parsed: ParsedCsv,
  need: { field: keyof ColumnMapping; desc: string }[],
  used: Set<string>,
): MappingSuggestion[] {
  const taken = new Set<string>()
  const out: MappingSuggestion[] = []
  for (const f of need) {
    let best: { col: string; score: number } | null = null
    for (const h of parsed.headers) {
      if (used.has(h) || taken.has(h)) continue
      const score = hintScore(String(f.field), h, columnSamples(parsed, h))
      if (score >= 2 && (!best || score > best.score)) best = { col: h, score }
    }
    if (best) {
      taken.add(best.col)
      out.push({ field: String(f.field), column: best.col, reason: "matched by keyword" })
    } else {
      out.push({ field: String(f.field), column: null, reason: "no column matched" })
    }
  }
  return out
}

function columnSamples(parsed: ParsedCsv, header: string, max = 6): string[] {
  const counts = new Map<string, number>()
  for (const r of parsed.rows) {
    const v = (r[header] ?? "").trim()
    if (!v) continue
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([v]) => v)
}

export async function suggestMapping(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  requested?: (keyof ColumnMapping)[],
): Promise<{ ai: boolean; suggestions: MappingSuggestion[] }> {
  const need = MAPPABLE_FIELDS.filter((f) => (requested ? requested.includes(f.field) : !mapping[f.field]))
  if (!need.length) return { ai: false, suggestions: [] }

  const used = new Set(Object.values(mapping).filter(Boolean) as string[])
  // No model configured → still help via the deterministic keyword matcher.
  if (!process.env.OPENAI_API_KEY) return { ai: false, suggestions: localSuggest(parsed, need, used) }
  // Candidate columns: not already mapped, categorical-ish, capped to bound the
  // prompt. The 60-distinct ceiling keeps free-text/IDs out while still admitting
  // a US state column (~50 values) and income bands, which a tighter cap would
  // silently drop — leaving region/income unmappable. Demographics and screens
  // are always categorical.
  const candidates = parsed.headers
    .filter((h) => !used.has(h))
    .map((h) => ({ h, samples: columnSamples(parsed, h) }))
    .filter((c) => {
      const distinct = new Set(parsed.rows.map((r) => (r[c.h] ?? "").trim()).filter(Boolean))
      return distinct.size >= 1 && distinct.size <= 60
    })
    .slice(0, 80)
  if (!candidates.length) return { ai: false, suggestions: [] }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await client.chat.completions.create({
      model: FAST_MODEL,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You map survey CSV columns to standard polling variables. Match by MEANING, not exact wording — survey questions are phrased many ways. Examples: 'How enthusiastic are you to vote' → motivation screen; 'How likely are you to vote' or 'How often do you vote' → turnout-intent screen; 'the people closest to you / do your friends plan to vote' → social screen; a 2020 or 2016 vote question → past-vote recall. " +
            "Use ONLY exact column names from the provided candidate list. If, and only if, NO candidate plausibly fits a field, return null for it — never invent a column, but do prefer a reasonable approximate match over null. A 'recall' is a PAST election's vote; the current 'if the election were held today' ballot is NOT a recall. " +
            'Respond ONLY as JSON: {"suggestions":[{"field":string,"column":string|null,"reason":string up to 12 words}]}.',
        },
        {
          role: "user",
          content:
            `Fields needing a column:\n${need.map((f) => `- ${String(f.field)}: ${f.desc}`).join("\n")}\n\n` +
            `Already mapped (do NOT reuse these columns): ${Object.entries(mapping).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n\n` +
            `Candidate columns (name → sample values):\n${candidates.map((c) => `- ${c.h} → ${c.samples.join(" | ")}`).join("\n")}`,
        },
      ],
    })
    const parsedJson = JSON.parse(res.choices[0]?.message?.content || "{}")
    const valid = new Set(parsed.headers)
    const needFields = new Set(need.map((f) => String(f.field)))
    const taken = new Set<string>()
    const byField = new Map<string, MappingSuggestion>()
    for (const s of Array.isArray(parsedJson.suggestions) ? parsedJson.suggestions : []) {
      const field = String(s?.field || "")
      if (!needFields.has(field)) continue
      const col = s?.column ? String(s.column) : ""
      const column = col && valid.has(col) && !used.has(col) && !taken.has(col) ? col : null
      if (column) taken.add(column)
      byField.set(field, { field, column, reason: String(s?.reason || "").slice(0, 120) })
    }
    // Backstop: for any field the model left unmatched, try the deterministic
    // keyword matcher against the columns it didn't already claim.
    const stillNull = need.filter((f) => !byField.get(String(f.field))?.column)
    if (stillNull.length) {
      for (const local of localSuggest(parsed, stillNull, new Set([...used, ...taken]))) {
        if (local.column) {
          taken.add(local.column)
          byField.set(local.field, local)
        } else if (!byField.has(local.field)) byField.set(local.field, local)
      }
    }
    return { ai: true, suggestions: need.map((f) => byField.get(String(f.field)) ?? { field: String(f.field), column: null, reason: "" }) }
  } catch (e) {
    console.error("[ai] mapping suggestion failed:", (e as Error)?.message)
    // Degrade to the deterministic matcher rather than returning nothing.
    return { ai: false, suggestions: localSuggest(parsed, need, used) }
  }
}
