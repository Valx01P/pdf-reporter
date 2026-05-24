// Server-only. Generates the report's executive summary via OpenAI, mirroring
// CentPoll's "degrade gracefully when the key is missing" contract: if there's
// no key (or the call fails), fall back to a deterministic, template-built
// summary so the rest of the tool keeps working. Specialized for the dual RV/LV
// universe — the model is told to compare the two and never invent numbers.

import OpenAI from "openai"
import type { AiSummary } from "./types"
import type { ClientPayload } from "./psi/service"

export type { AiSummary }

const FAST_MODEL = process.env.OPENAI_MODEL_FAST || "gpt-4o-mini"

export function isAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

function digest(p: ClientPayload): string {
  const lines: string[] = []
  for (const t of p.toplines) {
    if (t.type === "open_ended" || t.type === "numeric") {
      lines.push(`- ${t.prompt} [${t.type}]`)
      continue
    }
    const fmt = (q: typeof t.rv) =>
      q.options
        .slice()
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 4)
        .map((o) => `${o.label} ${o.pct.toFixed(0)}%`)
        .join(", ")
    lines.push(`- ${t.prompt}\n    RV: ${fmt(t.rv)}\n    LV: ${fmt(t.lv)}`)
  }
  const recallShift = p.shift.find((s) => s.dimension === "recall2024")
  const shiftLine = recallShift
    ? "2024-recall shift RV→LV: " + recallShift.rows.map((r) => `${r.cell} ${r.rv.toFixed(0)}%→${r.lv.toFixed(0)}%`).join(", ")
    : ""
  return [
    `Study: ${p.name}`,
    `Kept n=${p.quality.kept} of ${p.quality.total} (${p.quality.removed} screened out)`,
    `RV: effective n=${p.rv.diagnostics.effectiveN}, DEFF ${p.rv.diagnostics.deff}, MoE ±${p.rv.diagnostics.moe}%`,
    `LV: effective n=${p.lvUniverse.diagnostics.effectiveN}, DEFF ${p.lvUniverse.diagnostics.deff}, MoE ±${p.lvUniverse.diagnostics.moe}%`,
    `LV mean P(vote)=${p.lv.model.meanPvote.toFixed(3)}`,
    shiftLine,
    "",
    "Toplines (RV = Registered Voter universe, LV = Likely Voter universe):",
    lines.join("\n"),
  ].join("\n")
}

export async function generatePsiSummary(payload: ClientPayload): Promise<AiSummary> {
  if (isAiEnabled()) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const res = await client.chat.completions.create({
        model: FAST_MODEL,
        temperature: 0.4,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a senior polling methodologist writing the executive summary of a dual-universe (Registered Voter vs Likely Voter) topline report produced with the PSI Pathway 3 methodology. " +
              "Be precise, neutral, quantitative, and cite the actual percentages. Contrast the RV and LV universes where they differ — the LV screen is the point of the methodology. Never invent numbers or groups not present. Flag the margin of error on close results. " +
              'Respond ONLY with JSON: {"headline": string (<=12 words), "overview": string (2-4 sentences), "findings": string[] (3-6 specific bullets with numbers, noting RV vs LV where relevant), "methodologyNote": string (1-2 sentences on n, weighting, dual universe, MoE)}.',
          },
          { role: "user", content: `Write the executive summary for this poll.\n\n${digest(payload)}` },
        ],
      })
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}")
      return {
        headline: String(parsed.headline || payload.name).slice(0, 160),
        overview: String(parsed.overview || "").slice(0, 1400),
        findings: Array.isArray(parsed.findings) ? parsed.findings.map((f: unknown) => String(f).slice(0, 300)).slice(0, 6) : [],
        methodologyNote: String(parsed.methodologyNote || "").slice(0, 700),
        ai: true,
      }
    } catch (e) {
      console.error("[ai] summary failed, using fallback:", (e as Error)?.message)
    }
  }
  return templatePsiSummary(payload)
}

export function templatePsiSummary(p: ClientPayload): AiSummary {
  const findings: string[] = []
  for (const t of p.toplines) {
    if (t.type === "open_ended" || t.type === "numeric") continue
    const rvTop = t.rv.options.slice().sort((a, b) => b.pct - a.pct)[0]
    const lvTop = t.lv.options.slice().sort((a, b) => b.pct - a.pct)[0]
    if (rvTop && lvTop) {
      if (rvTop.label !== lvTop.label) findings.push(`${t.prompt}: RV leads "${rvTop.label}" (${rvTop.pct.toFixed(0)}%); LV leads "${lvTop.label}" (${lvTop.pct.toFixed(0)}%).`)
      else findings.push(`${t.prompt}: "${rvTop.label}" leads — RV ${rvTop.pct.toFixed(0)}%, LV ${lvTop.pct.toFixed(0)}%.`)
    }
    if (findings.length >= 6) break
  }
  return {
    headline: p.name,
    overview: `Dual-universe topline results from ${p.quality.kept.toLocaleString()} screened respondents. The Registered Voter universe carries ±${p.rv.diagnostics.moe}% margin of error (effective n=${p.rv.diagnostics.effectiveN.toLocaleString()}); the Likely Voter universe ±${p.lvUniverse.diagnostics.moe}% (effective n=${p.lvUniverse.diagnostics.effectiveN.toLocaleString()}).`,
    findings,
    methodologyNote: `PSI Pathway 3 dual-universe weighting. RV and LV universes are raked independently to SOCAL-updated targets; LV is seeded by a three-question P(vote) propensity screen (mean ${p.lv.model.meanPvote.toFixed(2)}). RV DEFF ${p.rv.diagnostics.deff}, LV DEFF ${p.lvUniverse.diagnostics.deff}.`,
    ai: false,
  }
}
