// Display formatting for tabbook net/summary rows. Pure + dependency-free so it
// is shared by the client grid and the server CSV/xlsx exporters.

import type { TabbookSummaryRow } from "./types"

export function formatSummaryValue(value: number, format: TabbookSummaryRow["format"]): string {
  if (format === "margin") {
    // Horse-race margin: positive = Democrat lead, negative = Republican lead.
    // A margin that rounds to 0.0 is a tie — don't attribute it to a side.
    if (Math.abs(value) < 0.05) return "EVEN"
    return value > 0 ? `D+${value.toFixed(1)}` : `R+${(-value).toFixed(1)}`
  }
  if (format === "net") return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
  return `${value.toFixed(1)}%`
}
