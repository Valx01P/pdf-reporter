# Toplines

Turn a respondent-level polling CSV into a publication-ready report. Toplines
implements the **Public Sentiment Institute — Pathway 3 (Dual Universe)**
methodology: a three-question likely-voter propensity model, independently
weighted Registered-Voter and Likely-Voter universes, crosstabs with
significance testing, and PDF / Excel / CSV exports. A standalone Next.js 16 app
— everything runs in server route handlers; the uploaded CSV never leaves the
session except to the app's own API.

## Run it

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY for the AI executive summary (optional)
npm run dev                  # http://localhost:3000
```

The AI summary degrades to a deterministic template when no key is set; every
other feature works offline.

Try it instantly: open `/?demo=1` to auto-load a synthetic PSI-instrument
dataset. `/?demo=1&tab=results` jumps straight to a module.

## Methodology pipeline (`lib/psi/`)

The engine is pure TypeScript, executed only inside route handlers.

| Phase | File | What it does |
| --- | --- | --- |
| Constants | `constants.ts` | PSI Q3/Q4/Q5 weight maps, Set A targets, FEC/CPS anchors, state→region map |
| 1 — Foundation | `derive.ts` | Parse, fuzzy column auto-detect, quality screen (speeders/straightliners), demographic derivation, Q2 history buckets |
| 1/3b — LV model | `lv.ts` | Geometric LV_raw, logistic P(vote) with Q2-modulated k and a numerically solved midpoint |
| 0/2 — Targets | `socal.ts` | SOCAL 70/30 credibility update, independent per universe; LV prior adjustments |
| 3a/3b — Weighting | `rake.ts` | Cell-collapse safeguard, 4-round capped IPF raking, two-stage FEC/CPS recall calibration, DEFF/Kish/SMD diagnostics |
| Orchestration | `pipeline.ts` | Runs both universes + RV→LV shift decomposition |
| Tabulation | `tabulate.ts` | Weighted toplines + crosstabs (significance flagged) per universe |
| Service | `service.ts` | Assembles config + the client payload used by every route |

**Disclosed approximations (hardening-pass items, not yet applied):** entropy
balancing initialization, the 9-scenario / 5,000-simulation Monte Carlo
uncertainty envelope, and bootstrap standard errors. The PDF methodology page
states this explicitly. Everything else (LV propensity, SOCAL targets, raking,
recall calibration, DEFF/effective-N/SMD) is computed to spec.

## Routes (`app/api/`)

- `POST /api/run` — full pipeline → display payload
- `POST /api/crosstab` — one crosstab (RV / LV / both)
- `POST /api/ai/summary` — AI executive summary
- `POST /api/report` — Pathway-3 PDF (pdfkit)
- `POST /api/export` — `csv` toplines / `xlsx` workbook / `respondents` weighted CSV
- `GET  /api/sample` — synthetic demo dataset

## UI (`components/tool/`)

A single-page workspace whose tabs map to the spec's 8 modules: **Data** (upload,
quality, mapping, composition), **Likely Voter** (distribution + editable weight
maps + calibration), **Benchmarks & Weighting** (set, diagnostics, convergence
log, SOCAL audit), **Results** (dual toplines + shift), **Crosstabs**, **Report**.

## Conventions

Inherits the CentPoll design system — no semicolons, custom `text-*` typography
utilities only, colors via the three `--background` / `--foreground` / `--primary`
CSS variables (never raw Tailwind colors), brand color for active/interactive
state, no warm colors except rose for errors. `pdfkit` and `exceljs` are kept
out of the bundle via `serverExternalPackages`.
