// Public Sentiment Institute — Pathway 3 (Dual Universe) constants, transcribed
// from the PSI reference. These are the locked methodology numbers: the
// Q3/Q4/Q5 likely-voter weight maps, the Set A demographic targets for the 2026
// midterm universe, FEC/CPS recall anchors, and the state→region map. Every
// value here is user-overridable in the Benchmark Setup module.

// ── Likely-voter three-question weight maps ─────────────────────────────────
// response option (canonical wording) -> [0,1] weight. Real survey data is
// fuzzy-matched against these; the user can edit any weight in the LV panel.

export const Q3_MOTIVATION: Record<string, number> = {
  "I am certain to vote and highly motivated to do so": 1.0,
  "I am very likely to vote and feel motivated": 0.9,
  "I am somewhat likely to vote but not strongly motivated": 0.668,
  "I am motivated but unsure if I will actually vote": 0.332,
  "I am not very likely to vote and feel little motivation": 0.109,
  "I am certain not to vote": 0.029,
}

export const Q4_PREPAREDNESS: Record<string, number> = {
  "In person on Election Day — I know my polling location": 1.0,
  "Early in-person voting — I know when and where early voting is available": 0.937,
  "Mail-in or absentee ballot — I have already requested or received my ballot": 0.973,
  "In person on Election Day — I still need to confirm my polling location": 0.711,
  "Early in-person voting — I still need to look up early voting details": 0.5,
  "Mail-in or absentee ballot — I plan to request one but haven't yet": 0.5,
  "I haven't decided how I will vote yet": 0.289,
  "I do not plan to vote": 0.063,
}

export const Q5_SOCIAL: Record<string, number> = {
  "All or nearly all of them plan to vote": 0.891,
  "Most of them plan to vote": 0.95,
  "About half of them plan to vote": 0.5,
  "A few of them plan to vote": 0.015,
  "Not sure": 0.269,
  "None of them plan to vote": 0.119,
}

// ── Q2 vote-history → logistic steepness (k) ────────────────────────────────
export const HISTORY_K: Record<"consistent" | "occasional" | "new", number> = {
  consistent: 14, // 3+ elections — stated intent most credible
  occasional: 12, // 1–2 elections — default
  new: 8, // 0 / never — aspirational intent discounted hardest
}

// ── Turnout / recall anchors ────────────────────────────────────────────────
export const PROJECTED_VOTERS = 117_000_000
export const REGISTERED_VOTERS = 173_800_000
export const PROJECTED_TURNOUT = PROJECTED_VOTERS / REGISTERED_VOTERS // 0.6732

// FEC certified 2024 popular vote (used for recall calibration of actual voters)
export const FEC_2024 = { Trump: 49.91, Harris: 48.39, Third: 1.7 }
// CPS 2024 ASEC non-voter share (RV recall Stage 2 anchor only)
export const CPS_DNV_SHARE = 35.0
// Monte Carlo turnout grid (Phase 4)
export const TURNOUT_GRID = { low: 105_000_000, base: 117_000_000, high: 128_000_000 }

// ── Demographic buckets ─────────────────────────────────────────────────────
export const AGE_BUCKETS = ["18-29", "30-44", "45-64", "65+"] as const
export const SEX_VALUES = ["Male", "Female"] as const
export const EDU4 = ["HS or less", "Some college", "College grad", "Postgrad"] as const
export const RACE_EDU5 = [
  "White No College",
  "White College",
  "Black",
  "Hispanic",
  "Asian/Other",
] as const
export const REGION8 = [
  "Northeast",
  "Mid-Atlantic",
  "Southeast Atlantic",
  "Appalachia",
  "Great Lakes",
  "Lower Midwest/Plains",
  "Southwest",
  "West",
] as const
export const RECALL4 = ["Trump", "Harris", "Third", "DNV"] as const

// ── Set A RV targets (2026 midterm), percentages ────────────────────────────
// Keys must match the derived cell labels exactly.

export const SET_A_TARGETS = {
  ageSex: {
    "18-29 · Male": 7.9,
    "18-29 · Female": 8.1,
    "30-44 · Male": 12.3,
    "30-44 · Female": 13.3,
    "45-64 · Male": 15.1,
    "45-64 · Female": 16.2,
    "65+ · Male": 12.8,
    "65+ · Female": 14.3,
  },
  eduSex: {
    "Male · No College": 26.5,
    "Male · College": 21.7,
    "Female · No College": 24.9,
    "Female · College": 26.9,
  },
  raceEdu: {
    "White No College": 34.5,
    "White College": 32.5,
    Black: 11.0,
    Hispanic: 11.5,
    "Asian/Other": 10.5,
  },
  region: {
    Northeast: 4.8,
    "Mid-Atlantic": 15.3,
    "Southeast Atlantic": 15.8,
    Appalachia: 7.7,
    "Great Lakes": 16.7,
    "Lower Midwest/Plains": 5.7,
    Southwest: 12.2,
    West: 21.8,
  },
  recall2024: {
    Trump: 40.35,
    Harris: 39.69,
    Third: 1.44,
    DNV: 18.52,
  },
} as const

export type TargetSet = {
  ageSex: Record<string, number>
  eduSex: Record<string, number>
  raceEdu: Record<string, number>
  region: Record<string, number>
  recall2024: Record<string, number>
}

// The named raking dimensions and their min-n collapse thresholds (Phase 3a-1).
export const DIMENSIONS = [
  { key: "ageSex", label: "Age × Sex", joint: true, minN: 20 },
  { key: "eduSex", label: "Education × Sex", joint: true, minN: 20 },
  { key: "raceEdu", label: "Race × Education", joint: true, minN: 20 },
  { key: "region", label: "Region", joint: false, minN: 15 },
  { key: "recall2024", label: "2024 recall", joint: false, minN: 15 },
] as const

// ── State → 8-region map (FIPS-style assignment) ────────────────────────────
// Accepts 2-letter codes; full names normalised separately.
export const STATE_TO_REGION: Record<string, (typeof REGION8)[number]> = {
  ME: "Northeast", NH: "Northeast", VT: "Northeast", MA: "Northeast", RI: "Northeast", CT: "Northeast",
  NY: "Mid-Atlantic", NJ: "Mid-Atlantic", PA: "Mid-Atlantic", DE: "Mid-Atlantic", MD: "Mid-Atlantic", DC: "Mid-Atlantic",
  VA: "Southeast Atlantic", NC: "Southeast Atlantic", SC: "Southeast Atlantic", GA: "Southeast Atlantic", FL: "Southeast Atlantic",
  WV: "Appalachia", KY: "Appalachia", TN: "Appalachia", AL: "Appalachia", MS: "Appalachia",
  OH: "Great Lakes", MI: "Great Lakes", IN: "Great Lakes", IL: "Great Lakes", WI: "Great Lakes", MN: "Great Lakes",
  IA: "Lower Midwest/Plains", MO: "Lower Midwest/Plains", KS: "Lower Midwest/Plains", NE: "Lower Midwest/Plains",
  ND: "Lower Midwest/Plains", SD: "Lower Midwest/Plains", OK: "Lower Midwest/Plains", AR: "Lower Midwest/Plains", LA: "Lower Midwest/Plains",
  TX: "Southwest", AZ: "Southwest", NM: "Southwest", NV: "Southwest",
  CA: "West", OR: "West", WA: "West", CO: "West", UT: "West", ID: "West", MT: "West", WY: "West", AK: "West", HI: "West",
}
