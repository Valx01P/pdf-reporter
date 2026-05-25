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
  if (!need.length || !process.env.OPENAI_API_KEY) return { ai: false, suggestions: [] }

  const used = new Set(Object.values(mapping).filter(Boolean) as string[])
  // Candidate columns: not already mapped, categorical-ish (1–20 distinct values),
  // capped to bound the prompt. Demographics and screens are always categorical.
  const candidates = parsed.headers
    .filter((h) => !used.has(h))
    .map((h) => ({ h, samples: columnSamples(parsed, h) }))
    .filter((c) => {
      const distinct = new Set(parsed.rows.map((r) => (r[c.h] ?? "").trim()).filter(Boolean))
      return distinct.size >= 1 && distinct.size <= 20
    })
    .slice(0, 60)
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
            "You map survey CSV columns to standard polling variables. Use ONLY exact column names from the provided candidate list. If no candidate fits a field, return null for that field — never invent a column. A 'recall' is a PAST vote; the current 'if the election were held today' ballot is NOT a recall. " +
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
    const out: MappingSuggestion[] = []
    for (const s of Array.isArray(parsedJson.suggestions) ? parsedJson.suggestions : []) {
      const field = String(s?.field || "")
      if (!needFields.has(field)) continue
      const col = s?.column ? String(s.column) : ""
      const column = col && valid.has(col) && !used.has(col) && !taken.has(col) ? col : null
      if (column) taken.add(column)
      out.push({ field, column, reason: String(s?.reason || "").slice(0, 120) })
    }
    return { ai: true, suggestions: out }
  } catch (e) {
    console.error("[ai] mapping suggestion failed:", (e as Error)?.message)
    return { ai: false, suggestions: [] }
  }
}
