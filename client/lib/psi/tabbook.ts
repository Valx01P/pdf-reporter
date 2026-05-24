// Tabbook assembly for one universe. Builds a single wide grid that mirrors the
// PSI reference Tabbook: every crosstabbable question's Total on the left and a
// fixed banner of demographic groups (and any chosen question banners) to the
// right. All questions share one column set; the (unweighted n) per column is
// question-independent. Column percentages are weighted column-shares with a
// 95%-CI significance flag against the question's overall (Total) share.

import { demoValue, tabulateQuestion } from "./tabulate"
import type { DerivedRespondent } from "./types"
import type { Tabbook, TabbookColumn, TabbookGroup, TabbookQuestion, TabbookRow } from "../types"

// One demographic banner group: which DerivedRespondent field it reads, the
// header text, the canonical category order, and display labels for raw values.
export interface TabbookDim {
  key: string
  group: string
  order: string[]
  labels?: Record<string, string>
}

const AGE_ORDER = ["18-29", "30-44", "45-64", "65+"]
const SEX_ORDER = ["Male", "Female"]

// Demographic banner, in reference display order. Categories present in the data
// but absent from `order` are appended; listed-but-absent categories are dropped.
export const DEMO_BANNER: TabbookDim[] = [
  {
    key: "raceEdu",
    group: "Race (W College/No College)",
    order: ["White No College", "White College", "Hispanic", "Black", "Asian/Other"],
    labels: { "Asian/Other": "Asian / Other" },
  },
  { key: "ageBucket", group: "Age", order: AGE_ORDER },
  { key: "sex", group: "Gender", order: SEX_ORDER },
  {
    key: "ageSex",
    group: "Age × Gender",
    order: AGE_ORDER.flatMap((a) => SEX_ORDER.map((s) => `${a} · ${s}`)),
    labels: Object.fromEntries(
      AGE_ORDER.flatMap((a) => SEX_ORDER.map((s) => [`${a} · ${s}`, `${a} ${s}`])),
    ),
  },
  {
    key: "edu",
    group: "Education",
    order: ["HS or less", "Some college", "College grad", "Postgrad"],
    labels: {
      "HS or less": "High school or less",
      "Some college": "Some college/assoc. degree",
      "College grad": "College graduate",
      Postgrad: "Postgraduate study",
    },
  },
  {
    key: "region",
    group: "Region",
    order: ["Northeast", "Mid-Atlantic", "Southeast Atlantic", "Appalachia", "Great Lakes", "Lower Midwest/Plains", "Southwest", "West"],
    labels: {
      Northeast: "New England",
      Appalachia: "Appalachia / South Interior",
      "Lower Midwest/Plains": "Lower Midwest / Plains",
      West: "West / Mountain / Pacific",
    },
  },
  {
    key: "recall",
    group: "2024 Vote",
    order: ["Trump", "Harris", "Third", "DNV"],
    labels: { Trump: "Donald Trump", Harris: "Kamala Harris", Third: "Third party", DNV: "Did not vote" },
  },
  {
    key: "historyBucket",
    group: "Vote History",
    order: ["consistent", "occasional", "new"],
    labels: { consistent: "Consistent voter", occasional: "Occasional voter", new: "New / non-voter" },
  },
]

const DEMO_BY_KEY = new Map(DEMO_BANNER.map((d) => [d.key, d]))

export function isDemoBanner(key: string): boolean {
  return DEMO_BY_KEY.has(key)
}

// Resolve the ordered category values present in the data for one banner.
function categoriesFor(
  banner: { key: string; isDemo: boolean },
  rows: Record<string, string>[],
  derived: DerivedRespondent[],
): { value: string; label: string; n: number }[] {
  const counts = new Map<string, number>()
  const valueOf = banner.isDemo
    ? (d: DerivedRespondent) => demoValue(d, banner.key)
    : (d: DerivedRespondent) => (rows[d.i][banner.key] ?? "").trim() || "Unknown"
  for (const d of derived) {
    const v = valueOf(d)
    counts.set(v, (counts.get(v) || 0) + 1)
  }

  const dim = banner.isDemo ? DEMO_BY_KEY.get(banner.key) : undefined
  let ordered: string[]
  if (dim) {
    const present = dim.order.filter((v) => counts.has(v))
    const extras = Array.from(counts.keys()).filter((v) => !dim.order.includes(v)).sort()
    ordered = [...present, ...extras]
  } else {
    // question banner: by frequency, capped so the grid stays sane
    ordered = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v]) => v)
  }
  const labelOf = (v: string) => dim?.labels?.[v] ?? v
  return ordered.map((v) => ({ value: v, label: labelOf(v), n: counts.get(v) || 0 }))
}

export function bannerGroupLabel(key: string): string {
  return DEMO_BY_KEY.get(key)?.group ?? key
}

export function buildTabbook(
  rows: Record<string, string>[],
  derived: DerivedRespondent[],
  weights: number[],
  substantiveKeys: string[],
  universe: "RV" | "LV",
  name: string,
  banners: { key: string; isDemo: boolean }[],
): Tabbook {
  // ── 1. Fixed column set: Total, then every banner's categories ──────────────
  const columns: TabbookColumn[] = [
    { group: "Total", groupKey: "__total__", label: "Total", value: "Total", isTotal: true, unweightedN: derived.length },
  ]
  const groups: TabbookGroup[] = [{ label: "Total", span: 1 }]
  // Per-respondent column index for each banner (question-independent membership).
  const memberCols: number[][] = [] // memberCols[bannerIdx][k] -> column index

  for (const banner of banners) {
    const cats = categoriesFor(banner, rows, derived)
    if (!cats.length) continue
    const group = banner.isDemo ? bannerGroupLabel(banner.key) : banner.key
    const valueToCol = new Map<string, number>()
    for (const c of cats) {
      valueToCol.set(c.value, columns.length)
      columns.push({ group, groupKey: banner.key, label: c.label, value: c.value, isTotal: false, unweightedN: c.n })
    }
    groups.push({ label: group, span: cats.length })
    const valueOf = banner.isDemo
      ? (d: DerivedRespondent) => demoValue(d, banner.key)
      : (d: DerivedRespondent) => (rows[d.i][banner.key] ?? "").trim() || "Unknown"
    memberCols.push(derived.map((d) => valueToCol.get(valueOf(d)) ?? -1))
  }

  // ── 2. Per-question column-% matrix ─────────────────────────────────────────
  const questions: TabbookQuestion[] = []
  for (const key of substantiveKeys) {
    const total = tabulateQuestion(rows, derived, weights, key)
    if (total.type === "numeric" || total.type === "open_ended") {
      const note =
        total.type === "numeric" && total.numeric
          ? `mean ${total.numeric.mean} · median ${total.numeric.median} (n=${total.answered})`
          : `${total.openCount ?? total.answered} open-ended responses`
      questions.push({ key, prompt: key, type: total.type, rows: [], note })
      continue
    }

    const rowLabels = total.options.map((o) => o.label)
    const rowIndex = new Map(rowLabels.map((l, i) => [l, i]))
    // matrix[rowIdx][colIdx] = weighted count; colWeighted[colIdx] = weighted base
    const matrix = rowLabels.map(() => new Array(columns.length).fill(0))
    const colWeighted = new Array(columns.length).fill(0)

    derived.forEach((d, k) => {
      const answer = (rows[d.i][key] ?? "").trim()
      if (answer === "") return
      const ri = rowIndex.get(answer)
      if (ri == null) return
      const w = weights[k]
      // Total column
      matrix[ri][0] += w
      colWeighted[0] += w
      // each banner's column for this respondent
      for (const cols of memberCols) {
        const ci = cols[k]
        if (ci >= 0) {
          matrix[ri][ci] += w
          colWeighted[ci] += w
        }
      }
    })

    const outRows: TabbookRow[] = total.options.map((opt, ri) => {
      const totalPct = opt.pct // weighted topline share = Total column
      const p = totalPct / 100
      const pct = columns.map((_, ci) => {
        const base = colWeighted[ci]
        return base ? (matrix[ri][ci] / base) * 100 : 0
      })
      const significant = columns.map((col, ci) => {
        if (col.isTotal || col.unweightedN <= 30) return false
        const base = colWeighted[ci]
        if (!base) return false
        const m = 1.96 * Math.sqrt((p * (1 - p)) / base) * 100
        return Math.abs(pct[ci] - totalPct) > m
      })
      return { label: opt.label, pct, significant }
    })

    questions.push({ key, prompt: key, type: total.type, rows: outRows })
  }

  return { name, universe, groups, columns, questions }
}
