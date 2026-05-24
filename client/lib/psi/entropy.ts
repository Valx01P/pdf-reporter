// Phase 3a-2 / 3b-3 — entropy balancing (Hainmueller 2012). Finds weights that
// minimize KL divergence from a base distribution q (uniform for RV, normalized
// P(vote) for LV) subject to the marginal cell-share constraints, so the
// starting weight vector already satisfies every target moment exactly before
// raking begins. Solved by dual Newton; falls back to the base weights if the
// optimizer fails to converge. Raw weights are capped at 3.5× the mean.

import type { DerivedRespondent, DimensionTargets } from "./types"
import { cellOf } from "./cells"

const EB_CAP = 3.5
const MAX_ITERS = 60
const TOL = 1e-9

// Solve A x = b by Gaussian elimination with partial pivoting. Returns null if
// the system is singular.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / d
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  // Fully reduced to diagonal form above, so x_i = M[i][n] / M[i][i].
  return M.map((row, i) => row[n] / row[i])
}

export function entropyBalance(
  derived: DerivedRespondent[],
  targets: DimensionTargets,
  activeDims: (keyof DimensionTargets)[],
  base: number[],
): number[] {
  const n = derived.length
  if (!n) return base
  // base normalised to mean 1
  const bsum = base.reduce((s, x) => s + x, 0) || n
  const q = base.map((x) => (x * n) / bsum)

  // Build moment columns: one per (dimension, cell) dropping a reference cell.
  // moment value = indicator(resp in cell) - target_share.
  type Moment = { col: Float64Array; target: number }
  const moments: Moment[] = []
  for (const dim of activeDims) {
    const t = targets[dim]
    if (!t) continue
    const cells = Object.keys(t).filter((c) => t[c] > 0)
    if (cells.length < 2) continue
    // drop the largest-target cell as reference for identifiability
    const ref = cells.reduce((a, b) => (t[a] >= t[b] ? a : b))
    for (const cell of cells) {
      if (cell === ref) continue
      const share = t[cell] / 100
      const col = new Float64Array(n)
      let present = 0
      for (let i = 0; i < n; i++) {
        const ind = cellOf(derived[i], dim) === cell ? 1 : 0
        present += ind
        col[i] = ind - share
      }
      // A target cell with no respondents can't be balanced to — skip it
      // (raking's cell-collapse handles the unmet marginal instead).
      if (present === 0) continue
      moments.push({ col, target: share })
    }
  }
  const K = moments.length
  if (K === 0) return capWeights(q, n)

  const lambda = new Array(K).fill(0)
  let weights = [...q]

  const recompute = (lam: number[]): { w: number[]; g: number[]; norm: number } => {
    // p_i ∝ q_i exp(-Z_i·λ)
    const raw = new Array(n)
    let denom = 0
    for (let i = 0; i < n; i++) {
      let dot = 0
      for (let k = 0; k < K; k++) dot += moments[k].col[i] * lam[k]
      const e = q[i] * Math.exp(-dot)
      raw[i] = Number.isFinite(e) ? e : 0
      denom += raw[i]
    }
    if (denom <= 0 || !Number.isFinite(denom)) return { w: q, g: new Array(K).fill(Infinity), norm: Infinity }
    const p = raw.map((x) => x / denom)
    // gradient g_k = Σ p_i Z_i,k  (want 0)
    const g = new Array(K).fill(0)
    for (let k = 0; k < K; k++) {
      let s = 0
      const col = moments[k].col
      for (let i = 0; i < n; i++) s += p[i] * col[i]
      g[k] = s
    }
    const norm = Math.sqrt(g.reduce((s, x) => s + x * x, 0))
    return { w: p.map((x) => x * n), g, norm }
  }

  let { g, norm } = recompute(lambda)
  for (let it = 0; it < MAX_ITERS && norm > TOL; it++) {
    // weighted covariance of moments under current p (Hessian = -Cov)
    const raw = new Array(n)
    let denom = 0
    for (let i = 0; i < n; i++) {
      let dot = 0
      for (let k = 0; k < K; k++) dot += moments[k].col[i] * lambda[k]
      const e = q[i] * Math.exp(-dot)
      raw[i] = Number.isFinite(e) ? e : 0
      denom += raw[i]
    }
    if (denom <= 0) break
    const p = raw.map((x) => x / denom)
    const H: number[][] = Array.from({ length: K }, () => new Array(K).fill(0))
    for (let a = 0; a < K; a++) {
      for (let b = a; b < K; b++) {
        let s = 0
        const ca = moments[a].col
        const cb = moments[b].col
        for (let i = 0; i < n; i++) s += p[i] * ca[i] * cb[i]
        const cov = s - g[a] * g[b]
        H[a][b] = cov + (a === b ? 1e-8 : 0) // ridge
        H[b][a] = H[a][b]
      }
    }
    const step = solve(H, g)
    if (!step) break
    // Newton: λ_new = λ + H^{-1} g  (descent on the convex dual)
    const next = lambda.map((l, k) => l + step[k])
    const trial = recompute(next)
    if (!Number.isFinite(trial.norm)) break
    for (let k = 0; k < K; k++) lambda[k] = next[k]
    weights = trial.w
    g = trial.g
    if (trial.norm >= norm - 1e-15 && it > 2) {
      norm = trial.norm
      break
    }
    norm = trial.norm
  }

  if (!weights.every((w) => Number.isFinite(w) && w >= 0)) return capWeights(q, n)
  return capWeights(weights, n)
}

function capWeights(w: number[], n: number): number[] {
  const capped = w.map((x) => Math.min(x, EB_CAP))
  const sum = capped.reduce((s, x) => s + x, 0) || n
  return capped.map((x) => (x * n) / sum)
}
