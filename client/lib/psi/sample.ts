// Deterministic synthetic dataset conforming to the PSI Pathway 3 instrument:
// Q2 vote history, Q3/Q4/Q5 likely-voter questions (exact PSI option wording),
// the standard demographics + 2024 recall, and a few substantive questions
// (generic ballot, Trump approval, right/wrong track, economy). Correlations are
// baked in (older + consistent voters skew higher P(vote) and more Republican on
// recall) so the RV and LV universes diverge the way the methodology expects.

import {
  Q3_MOTIVATION,
  Q4_PREPAREDNESS,
  Q5_SOCIAL,
} from "./constants"

export const PSI_SAMPLE_NAME = "2026 Generic Ballot — National Wave"

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function pick<T>(rng: () => number, weighted: [T, number][]): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [v, w] of weighted) if ((r -= w) <= 0) return v
  return weighted[weighted.length - 1][0]
}

const Q3_OPTS = Object.keys(Q3_MOTIVATION)
const Q4_OPTS = Object.keys(Q4_PREPAREDNESS)
const Q5_OPTS = Object.keys(Q5_SOCIAL)

const STATES = [
  ["FL", 0.07], ["CA", 0.11], ["TX", 0.09], ["NY", 0.06], ["PA", 0.05], ["OH", 0.04],
  ["GA", 0.04], ["NC", 0.04], ["MI", 0.04], ["IL", 0.04], ["WI", 0.03], ["AZ", 0.03],
  ["NV", 0.02], ["MN", 0.02], ["VA", 0.03], ["WA", 0.03], ["CO", 0.02], ["MA", 0.02],
  ["TN", 0.02], ["MO", 0.02], ["AL", 0.02], ["LA", 0.02], ["KY", 0.02], ["OR", 0.02],
  ["SC", 0.02], ["IA", 0.01], ["KS", 0.01], ["UT", 0.01], ["NM", 0.01], ["WV", 0.01],
] as [string, number][]

function buildCsv(): string {
  const rng = mulberry32(987654321)
  const headers = [
    "respondent_id",
    "duration_sec",
    "age",
    "sex",
    "education",
    "race",
    "state",
    "income",
    "Q2_vote_history",
    "Q3_motivation",
    "Q4_preparedness",
    "Q5_social",
    "who_did_you_vote_for_2024",
    "If the election were held today, which party's candidate would you support for Congress?",
    "Do you approve or disapprove of the job Donald Trump is doing as president?",
    "Generally speaking, do you think things in the country are headed in the right direction or are on the wrong track?",
    "How would you rate the condition of the national economy today?",
  ]

  const rows: string[][] = []
  const N = 1240
  for (let i = 0; i < N; i++) {
    const id = `P${100000 + i}`
    const age = pick(rng, [
      [22, 0.16], [33, 0.2], [41, 0.13], [52, 0.18], [61, 0.15], [70, 0.18],
    ]) + Math.floor(rng() * 7) - 3
    const ageClamped = Math.max(18, Math.min(85, age))
    const older = ageClamped >= 50

    const sex = pick(rng, [["Female", 0.52], ["Male", 0.48]])
    const education = pick(rng, [
      ["High school or less", 0.32],
      ["Some college", 0.26],
      ["Bachelor's degree", 0.27],
      ["Postgraduate degree", 0.15],
    ])
    const race = pick(rng, [
      ["White", 0.66], ["Black", 0.12], ["Hispanic", 0.13], ["Asian", 0.05], ["Other", 0.04],
    ])
    const state = pick(rng, STATES)
    const income = pick(rng, [
      ["Under $25k", 0.14], ["$25k-$50k", 0.2], ["$50k-$75k", 0.18], ["$75k-$100k", 0.16],
      ["$100k-$150k", 0.16], ["$150k-$200k", 0.09], ["Over $200k", 0.07],
    ])

    // Vote history — older voters vote more often
    const electionsVoted = older
      ? pick(rng, [[5, 0.34], [4, 0.22], [3, 0.16], [2, 0.13], [1, 0.09], [0, 0.06]])
      : pick(rng, [[5, 0.1], [4, 0.12], [3, 0.16], [2, 0.2], [1, 0.22], [0, 0.2]])
    const ELECTION_LIST = ["2024 General", "2022 General", "2020 General", "2018 General", "2016 General", "2014 General"]
    const q2 = electionsVoted === 0 ? "I have never voted" : ELECTION_LIST.slice(0, electionsVoted).join("; ")
    const consistent = electionsVoted >= 3

    // Q3/Q4/Q5 — consistent voters skew toward high-propensity options
    const q3 = consistent
      ? pick(rng, [[Q3_OPTS[0], 0.5], [Q3_OPTS[1], 0.3], [Q3_OPTS[2], 0.12], [Q3_OPTS[3], 0.05], [Q3_OPTS[4], 0.02], [Q3_OPTS[5], 0.01]])
      : pick(rng, [[Q3_OPTS[0], 0.12], [Q3_OPTS[1], 0.2], [Q3_OPTS[2], 0.26], [Q3_OPTS[3], 0.22], [Q3_OPTS[4], 0.14], [Q3_OPTS[5], 0.06]])
    const q4 = consistent
      ? pick(rng, [[Q4_OPTS[0], 0.34], [Q4_OPTS[1], 0.16], [Q4_OPTS[2], 0.22], [Q4_OPTS[3], 0.12], [Q4_OPTS[4], 0.06], [Q4_OPTS[5], 0.05], [Q4_OPTS[6], 0.04], [Q4_OPTS[7], 0.01]])
      : pick(rng, [[Q4_OPTS[0], 0.12], [Q4_OPTS[1], 0.08], [Q4_OPTS[2], 0.1], [Q4_OPTS[3], 0.16], [Q4_OPTS[4], 0.12], [Q4_OPTS[5], 0.12], [Q4_OPTS[6], 0.2], [Q4_OPTS[7], 0.1]])
    const q5 = consistent
      ? pick(rng, [[Q5_OPTS[1], 0.4], [Q5_OPTS[0], 0.3], [Q5_OPTS[2], 0.18], [Q5_OPTS[4], 0.06], [Q5_OPTS[5], 0.03], [Q5_OPTS[3], 0.03]])
      : pick(rng, [[Q5_OPTS[1], 0.16], [Q5_OPTS[0], 0.16], [Q5_OPTS[2], 0.3], [Q5_OPTS[4], 0.16], [Q5_OPTS[5], 0.1], [Q5_OPTS[3], 0.12]])

    // 2024 recall — older lean a bit more Trump; non-voters concentrate among new voters
    const recall = electionsVoted === 0
      ? pick(rng, [["Did not vote", 0.7], ["Donald Trump", 0.13], ["Kamala Harris", 0.14], ["Another candidate", 0.03]])
      : older
        ? pick(rng, [["Donald Trump", 0.47], ["Kamala Harris", 0.44], ["Another candidate", 0.03], ["Did not vote", 0.06]])
        : pick(rng, [["Donald Trump", 0.4], ["Kamala Harris", 0.46], ["Another candidate", 0.04], ["Did not vote", 0.1]])
    const votedTrump = recall === "Donald Trump"
    const votedHarris = recall === "Kamala Harris"

    // Substantive — correlated with 2024 vote
    const ballot = votedTrump
      ? pick(rng, [["Republican candidate", 0.84], ["Democratic candidate", 0.06], ["Undecided", 0.1]])
      : votedHarris
        ? pick(rng, [["Republican candidate", 0.06], ["Democratic candidate", 0.84], ["Undecided", 0.1]])
        : pick(rng, [["Republican candidate", 0.36], ["Democratic candidate", 0.38], ["Undecided", 0.26]])
    const approval = votedTrump
      ? pick(rng, [["Strongly approve", 0.5], ["Somewhat approve", 0.32], ["Neither approve nor disapprove", 0.1], ["Somewhat disapprove", 0.05], ["Strongly disapprove", 0.03]])
      : votedHarris
        ? pick(rng, [["Strongly approve", 0.03], ["Somewhat approve", 0.07], ["Neither approve nor disapprove", 0.1], ["Somewhat disapprove", 0.2], ["Strongly disapprove", 0.6]])
        : pick(rng, [["Strongly approve", 0.14], ["Somewhat approve", 0.22], ["Neither approve nor disapprove", 0.22], ["Somewhat disapprove", 0.2], ["Strongly disapprove", 0.22]])
    const track = votedTrump
      ? pick(rng, [["Right direction", 0.62], ["Wrong track", 0.38]])
      : votedHarris
        ? pick(rng, [["Right direction", 0.16], ["Wrong track", 0.84]])
        : pick(rng, [["Right direction", 0.34], ["Wrong track", 0.66]])
    const economy = pick(rng, [["Excellent", 0.07], ["Good", 0.27], ["Fair", 0.34], ["Poor", 0.22], ["Very poor", 0.1]])

    // duration: ~8% speeders (well below median ~240s)
    const duration = rng() < 0.08 ? 30 + Math.floor(rng() * 40) : 160 + Math.floor(rng() * 220)

    rows.push([
      id, String(duration), String(ageClamped), sex, education, race, state, income,
      q2, q3, q4, q5, recall, ballot, approval, track, economy,
    ])
  }

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [headers.map(esc).join(",")]
  for (const r of rows) lines.push(r.map(esc).join(","))
  return lines.join("\n")
}

export const PSI_SAMPLE_CSV = buildCsv()
