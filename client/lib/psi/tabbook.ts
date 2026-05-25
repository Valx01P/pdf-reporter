// Tabbook assembly for one universe. Builds a single wide grid that mirrors the
// PSI reference Tabbook: every crosstabbable question's Total on the left and a
// fixed banner of demographic groups (and any chosen question banners) to the
// right. All questions share one column set; the (unweighted n) per column is
// question-independent. Column percentages are weighted column-shares with a
// 95%-CI significance flag against the question's overall (Total) share.

import { demoValue, tabulateQuestion } from "./tabulate"
import { INCOME_BANDS } from "./derive"
import { normalizeLabel } from "../scales"
import type { DerivedRespondent } from "./types"
import type { Tabbook, TabbookColumn, TabbookGroup, TabbookQuestion, TabbookRow, TabbookSummaryRow } from "../types"

// Net / summary rows beneath a question's options, computed per banner column by
// summing the relevant option column-%. Detection mirrors the Wisconsin tabbook:
// approval, likelihood, and ballot (horse-race) questions each get a net block.
function summaryRowsFor(rows: TabbookRow[], ncol: number): TabbookSummaryRow[] | undefined {
  if (rows.length < 2) return undefined
  const norm = rows.map((r) => normalizeLabel(r.label))
  const count = (pred: (l: string) => boolean) => norm.filter(pred).length
  const sum = (pred: (l: string) => boolean): number[] => {
    const out = new Array(ncol).fill(0)
    rows.forEach((r, i) => {
      if (!pred(norm[i])) return
      for (let c = 0; c < ncol; c++) out[c] += r.pct[c]
    })
    return out
  }
  // A net only makes sense when the two sides cover most of the options — guards
  // against a stray "approve"/"less likely" answer in an unrelated question.
  const dominant = (a: number, b: number) => a >= 1 && b >= 1 && a + b >= rows.length * 0.6

  // Neutral / midpoint options must not be summed into either net side, e.g.
  // "Neither approve nor disapprove" contains "disapprove" but is neutral.
  const neutral = (l: string) => l.includes("neither") || l.includes("neutral") || l.includes("no opinion") || l.includes("no difference")

  // Approval. "disapprove" contains "approve", so the approve test excludes it.
  const isDisapprove = (l: string) => l.includes("disapprove") && !neutral(l)
  const isApprove = (l: string) => l.includes("approve") && !l.includes("disapprove") && !neutral(l)
  if (dominant(count(isApprove), count(isDisapprove))) {
    const app = sum(isApprove)
    const dis = sum(isDisapprove)
    return [
      { label: "Approve", values: app, format: "pct" },
      { label: "Disapprove", values: dis, format: "pct" },
      { label: "Net (App – Disapp)", values: app.map((a, c) => a - dis[c]), format: "net", emphasis: true },
    ]
  }

  // Likelihood (e.g. "Much more likely" … "Much less likely").
  const isMore = (l: string) => l.includes("more likely") && !neutral(l)
  const isLess = (l: string) => l.includes("less likely") && !neutral(l)
  if (dominant(count(isMore), count(isLess))) {
    const more = sum(isMore)
    const less = sum(isLess)
    return [
      { label: "More Likely", values: more, format: "pct" },
      { label: "Less Likely", values: less, format: "pct" },
      { label: "Net (More – Less)", values: more.map((m, c) => m - less[c]), format: "net", emphasis: true },
    ]
  }

  // Ballot / horse-race. Require "candidate" so party-ID questions
  // (Republican / Democrat / Independent) don't get a spurious net.
  const isRep = (l: string) => l.includes("republican") && l.includes("candidate")
  const isDem = (l: string) => l.includes("democrat") && l.includes("candidate")
  if (count(isRep) >= 1 && count(isDem) >= 1) {
    const rep = sum(isRep)
    const dem = sum(isDem)
    return [
      { label: "Republican Total", values: rep, format: "pct" },
      { label: "Democrat Total", values: dem, format: "pct" },
      { label: "Net (R+ / D+)", values: dem.map((d, c) => d - rep[c]), format: "margin", emphasis: true },
    ]
  }

  return undefined
}

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
  { key: "income", group: "Income", order: INCOME_BANDS },
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
  { key: "party", group: "Party", order: ["Republican", "Democrat", "Independent"] },
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
    // Never surface an "Unknown" column for a fixed demographic banner — a banner
    // with no real data (e.g. Income/Party absent from the CSV) collapses to [].
    const extras = Array.from(counts.keys()).filter((v) => !dim.order.includes(v) && v !== "Unknown").sort()
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

interface RankingGroup {
  base: string // shared prompt before "::"
  members: string[] // one column key per ranked item
  items: string[] // display item names, aligned to members
}

// Detect ranking questions: ≥3 columns sharing a base prefix before "::" whose
// values are mostly integer ranks (1..N) AND where each respondent assigns
// DISTINCT values across the items (a ranking is a permutation). The distinctness
// test is what separates a true ranking from a numeric-coded Likert/approval grid
// (which shares a "::" prefix and small integers but repeats codes across items).
function detectRankingGroups(rows: Record<string, string>[], derived: DerivedRespondent[], keys: string[]): RankingGroup[] {
  const groups = new Map<string, { key: string; item: string }[]>()
  for (const k of keys) {
    const sep = k.indexOf("::")
    if (sep < 0) continue
    const base = k.slice(0, sep).trim()
    const item = k.slice(sep + 2).replace(/[:\s]+$/, "").trim() || k.slice(sep + 2).trim()
    const arr = groups.get(base) ?? []
    arr.push({ key: k, item })
    groups.set(base, arr)
  }
  const out: RankingGroup[] = []
  for (const [base, members] of groups) {
    if (members.length < 3) continue
    const maxRank = members.length * 1.5 + 2
    let ints = 0
    let total = 0
    let permLike = 0
    let respondents = 0
    for (const d of derived) {
      const vals: string[] = []
      for (const m of members) {
        const v = (rows[d.i][m.key] ?? "").trim()
        if (!v) continue
        total++
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1 && n <= maxRank) ints++
        vals.push(v)
      }
      if (vals.length >= 2) {
        respondents++
        if (new Set(vals).size === vals.length) permLike++
      }
    }
    const integerLike = total > 0 && ints / total >= 0.8
    const permutationLike = respondents > 0 && permLike / respondents >= 0.8
    if (integerLike && permutationLike) out.push({ base, members: members.map((m) => m.key), items: members.map((m) => m.item) })
  }
  return out
}

// Two ranking blocks (mean rank, then % ranked #1), each crosstabbed across the
// banner columns — mirrors the Wisconsin Q7 layout.
function buildRankingBlocks(
  g: RankingGroup,
  rows: Record<string, string>[],
  derived: DerivedRespondent[],
  weights: number[],
  columns: TabbookColumn[],
  memberCols: number[][],
): TabbookQuestion[] {
  const ncol = columns.length
  const mean: { item: string; vals: number[]; base: number }[] = []
  const top1: { item: string; vals: number[] }[] = []

  g.members.forEach((ki, mi) => {
    const sumW = new Array(ncol).fill(0)
    const sumWR = new Array(ncol).fill(0)
    const firstW = new Array(ncol).fill(0)
    const add = (ci: number, w: number, r: number) => {
      sumW[ci] += w
      sumWR[ci] += w * r
      if (r === 1) firstW[ci] += w
    }
    derived.forEach((d, k) => {
      const v = (rows[d.i][ki] ?? "").trim()
      const r = Number(v)
      if (!v || !Number.isFinite(r)) return
      const w = weights[k]
      add(0, w, r)
      for (const cols of memberCols) {
        const ci = cols[k]
        if (ci >= 0) add(ci, w, r)
      }
    })
    mean.push({ item: g.items[mi], vals: sumW.map((s, c) => (s ? sumWR[c] / s : 0)), base: sumW[0] })
    top1.push({ item: g.items[mi], vals: sumW.map((s, c) => (s ? (firstW[c] / s) * 100 : 0)) })
  })

  // Ascending (1 = most important), but items nobody ranked (Total base 0, mean
  // shown as 0) go last instead of sorting to the top as "most important".
  mean.sort((a, b) => {
    if ((a.base > 0) !== (b.base > 0)) return a.base > 0 ? -1 : 1
    return a.vals[0] - b.vals[0]
  })
  top1.sort((a, b) => b.vals[0] - a.vals[0]) // descending: most #1s first

  return [
    {
      key: `${g.base} :: __mean_rank__`,
      prompt: `${g.base} (Mean rank; 1 = most important)`,
      type: "numeric",
      valueFormat: "rank",
      rows: mean.map((r) => ({ label: r.item, pct: r.vals, significant: new Array(ncol).fill(false) })),
    },
    {
      key: `${g.base} :: __ranked_first__`,
      prompt: `${g.base} — % ranked #1`,
      type: "categorical",
      rows: top1.map((r) => ({ label: r.item, pct: r.vals, significant: new Array(ncol).fill(false) })),
    },
  ]
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
  // Ranking questions (Q7-style) become two grouped blocks instead of N numerics.
  const ranking = detectRankingGroups(rows, derived, substantiveKeys)
  const rankingFirst = new Map(ranking.map((g) => [g.members[0], g]))
  const consumedByRanking = new Set(ranking.flatMap((g) => g.members))

  for (const key of substantiveKeys) {
    const rg = rankingFirst.get(key)
    if (rg) {
      questions.push(...buildRankingBlocks(rg, rows, derived, weights, columns, memberCols))
      continue
    }
    if (consumedByRanking.has(key)) continue // a non-first member of a ranking group
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

    questions.push({ key, prompt: key, type: total.type, rows: outRows, summary: summaryRowsFor(outRows, columns.length) })
  }

  return { name, universe, groups, columns, questions }
}
