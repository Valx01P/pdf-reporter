"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, X } from "lucide-react"
import { saveBlob, type FetchedFile } from "@/lib/client-api"
import { parseCsv, stripBom } from "@/lib/csv-preview"

type Icon = typeof Download

export interface ExportConfirmProps {
  /** Button + dialog label, e.g. "Topline report (PDF)". */
  label: string
  /** Sub-text under the label on the tile variant. */
  hint?: string
  icon: Icon
  /** Native tooltip on the trigger. */
  title?: string
  /** "tile" = large left-aligned card button; "compact" = small pill button. */
  variant?: "tile" | "compact"
  disabled?: boolean
  /** Fetch the real file to save. Also previewed directly for PDF/CSV. */
  fetchFile: () => Promise<FetchedFile>
  /** For binary files (xlsx): CSV text to render as a stand-in table preview. */
  tablePreview?: () => Promise<string>
  /** For binary files: a short list of what the file contains (e.g. sheet names). */
  manifest?: string[]
}

type Kind = "pdf" | "csv" | "xlsx"

function kindOf(filename: string): Kind {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return "pdf"
  if (ext === "xlsx") return "xlsx"
  return "csv"
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const MAX_PREVIEW_ROWS = 200

export function ExportConfirmButton({ label, hint, icon: IconCmp, title, variant = "tile", disabled, fetchFile, tablePreview, manifest }: ExportConfirmProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<FetchedFile | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [table, setTable] = useState<string[][] | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const urlRef = useRef<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const revoke = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  const close = useCallback(() => {
    setOpen(false)
    setFile(null)
    setTable(null)
    setPdfUrl(null)
    setError(null)
    revoke()
  }, [])

  // Fetch (and parse) the artifact when the dialog opens.
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const f = await fetchFile()
        if (!active) return
        setFile(f)
        const kind = kindOf(f.filename)
        if (kind === "pdf") {
          const u = URL.createObjectURL(f.blob)
          urlRef.current = u
          setPdfUrl(u)
        } else if (kind === "csv") {
          setTable(parseCsv(stripBom(await f.blob.text())))
        } else if (tablePreview) {
          setTable(parseCsv(stripBom(await tablePreview())))
        }
      } catch (e) {
        if (active) setError((e as Error).message || "Could not build the file.")
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Escape to close; focus the confirm button once the file is ready.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, close])

  useEffect(() => {
    if (file && !loading) confirmRef.current?.focus()
  }, [file, loading])

  useEffect(() => () => {
    revoke()
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const confirm = () => {
    if (!file) return
    setSaving(true)
    try {
      saveBlob(file)
      setToast(`Downloaded ${file.filename}`)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 3500)
      close()
    } finally {
      setSaving(false)
    }
  }

  const kind = file ? kindOf(file.filename) : "csv"

  return (
    <>
      {variant === "tile" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={title}
          className="group flex items-center gap-3 rounded-lg border border-foreground/10 px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] disabled:opacity-50"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] text-foreground/60 group-hover:text-primary">
            <IconCmp size={16} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-small font-medium group-hover:text-primary">
              {label} <Download size={12} className="text-foreground/35" />
            </span>
            {hint && <span className="block truncate text-tiny text-foreground/50">{hint}</span>}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={title}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 text-tiny font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          <Download size={12} /> {label}
        </button>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview and download ${label}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <button type="button" aria-label="Close preview" onClick={close} className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-sm" />
          <div className="animate-fade-up relative flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <IconCmp size={15} className="shrink-0 text-primary" />
                <div className="flex min-w-0 flex-col">
                  <h3 className="truncate text-small font-semibold">{label}</h3>
                  <span className="truncate text-tiny text-foreground/50">
                    {file ? `${file.filename} · ${formatBytes(file.blob.size)}` : "Building preview…"}
                  </span>
                </div>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/55 hover:bg-foreground/5 hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-foreground/[0.02] p-4">
              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : loading || !file ? (
                <div className="flex h-[40dvh] flex-col items-center justify-center gap-2">
                  <Loader2 size={22} className="animate-spin text-primary" />
                  <span className="text-small text-foreground/60">Building the file to preview…</span>
                </div>
              ) : kind === "pdf" && pdfUrl ? (
                <iframe src={`${pdfUrl}#toolbar=1&view=FitH`} title={`${label} preview`} className="h-[60dvh] w-full rounded-md border border-foreground/10 bg-white" />
              ) : (
                <div className="flex flex-col gap-3">
                  {kind === "xlsx" && (
                    <div className="flex items-start gap-2 rounded-md border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-tiny text-foreground/60">
                      <FileSpreadsheet size={14} className="mt-0.5 shrink-0 text-foreground/45" />
                      <span>
                        Excel workbooks don&apos;t render in the browser.
                        {manifest?.length ? ` The .xlsx contains: ${manifest.join(", ")}.` : ""}
                        {table ? " A preview of the toplines sheet is shown below." : ""}
                      </span>
                    </div>
                  )}
                  {table ? <PreviewTable rows={table} /> : <p className="text-small text-foreground/55">No tabular preview available — confirm to download.</p>}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-4 py-3">
              <span className="hidden text-tiny text-foreground/45 sm:block">Review the file above, then confirm to save it to your computer.</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={close} className="inline-flex h-9 items-center rounded-md border border-foreground/15 px-3.5 text-small font-medium text-foreground/70 hover:bg-foreground/5">
                  Cancel
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={confirm}
                  disabled={!file || loading || saving || !!error}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Confirm download
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {toast && typeof document !== "undefined" && createPortal(
        <div className="animate-fade-up fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-background px-4 py-2 text-small font-medium text-foreground shadow-lg">
            <Check size={15} className="text-primary" />
            {toast}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function PreviewTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return null
  const [header, ...body] = rows
  const shown = body.slice(0, MAX_PREVIEW_ROWS)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-lg border border-foreground/10 bg-background">
        <table className="w-full text-tiny">
          <thead>
            <tr className="bg-foreground/[0.04] text-left text-foreground/60">
              {header.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-semibold uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/[0.06]">
            {shown.map((r, ri) => (
              <tr key={ri} className="hover:bg-foreground/[0.02]">
                {header.map((_, ci) => (
                  <td key={ci} className={`px-2.5 py-1.5 ${ci === 0 ? "max-w-[280px] text-foreground/75" : "whitespace-nowrap font-mono tabular-nums text-foreground/65"}`}>
                    {r[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > shown.length && (
        <span className="text-tiny text-foreground/45">Showing first {shown.length} of {body.length} rows — the download includes all of them.</span>
      )}
    </div>
  )
}
