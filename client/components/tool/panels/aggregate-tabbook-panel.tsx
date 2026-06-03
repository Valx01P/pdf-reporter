"use client"

import { Download, FileText, Info } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { fetchExportFile, fetchReportFile, type RunConfig } from "@/lib/client-api"
import { ExportConfirmButton } from "../export-confirm"
import { TabbookGrid } from "./crosstab-panel"
import type { Tabbook } from "@/lib/types"

// Shown when the upload is an already-processed export (tabbook or tidy
// toplines) rather than respondent-level data. The numbers are read straight
// from the file; the methodology pipeline (weighting, P(vote), DEFF) doesn't
// apply because there are no respondents to model.
export function AggregateTabbookPanel({
  tabbook,
  kind = "tabbook",
  csvText,
  name,
  config,
}: {
  tabbook: Tabbook
  kind?: "tabbook" | "toplines"
  csvText: string
  name: string
  config: RunConfig
}) {
  const colCount = Math.max(0, tabbook.columns.length - 1) // minus the Total column
  const isToplines = kind === "toplines"

  return (
    <Card>
      <CardHeader
        title={isToplines ? "Toplines" : "Tabbook"}
        hint={
          isToplines
            ? `${tabbook.questions.length} questions · ${tabbook.columns.map((c) => c.label).join(" / ")}`
            : `${tabbook.universe} · ${tabbook.questions.length} questions · ${colCount} banner columns`
        }
        action={
          <div className="flex items-center gap-2">
            <ExportConfirmButton
              variant="compact"
              label="PDF"
              icon={FileText}
              title="Preview the grid as a PDF, then confirm to download"
              fetchFile={() => fetchReportFile({ csvText, name, ...config })}
            />
            <ExportConfirmButton
              variant="compact"
              label={isToplines ? "Toplines CSV" : "Tabbook CSV"}
              icon={Download}
              title="Preview the normalized CSV, then confirm to download"
              fetchFile={() =>
                fetchExportFile({ csvText, name, ...config, format: isToplines ? "csv" : tabbook.universe === "LV" ? "tabbook-lv" : "tabbook-rv" })
              }
            />
          </div>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/[0.05] px-3 py-2.5 text-tiny text-foreground/70">
          <Info size={14} className="mt-0.5 shrink-0 text-primary" />
          {isToplines ? (
            <span>
              This file is an <span className="font-semibold">already-processed toplines export</span> — final results, not
              respondent-level survey data. Every percentage below is read directly from your file (each universe shown side by
              side). The Pathway 3 weighting/turnout model needs the raw respondent CSV (one row per person) and isn&rsquo;t
              applied here.
            </span>
          ) : (
            <span>
              This file is an <span className="font-semibold">already-processed tabbook</span> — aggregate crosstab output, not
              respondent-level survey data. Every percentage below is read directly from your file; the significance flags are
              re-derived from those numbers and each column&rsquo;s (unweighted n). The Pathway 3 weighting/turnout model needs
              the raw respondent CSV (one row per person) and isn&rsquo;t applied here.
            </span>
          )}
        </div>
        {!isToplines && (
          <div className="text-tiny text-foreground/45">
            Each cell is the column-% within that group. <span className="font-semibold text-primary">Bold colored</span> cells
            diverge from the Total beyond the 95% confidence interval. The Total column is shaded.
          </div>
        )}
        <TabbookGrid tb={tabbook} />
      </CardBody>
    </Card>
  )
}
