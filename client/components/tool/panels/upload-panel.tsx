"use client"

import { useRef, useState } from "react"
import { FileUp, Loader2, Sparkles, Upload } from "lucide-react"

export function UploadPanel({
  onData,
  onLoadSample,
  loading,
  error,
}: {
  onData: (csvText: string, name: string) => void
  onLoadSample: () => void
  loading: boolean
  error: string | null
}) {
  const [drag, setDrag] = useState(false)
  const [paste, setPaste] = useState(false)
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => onData(String(reader.result || ""), file.name.replace(/\.(csv|tsv|txt)$/i, ""))
    reader.readAsText(file)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files?.[0]
          if (f) readFile(f)
        }}
        className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          drag ? "border-primary bg-primary/[0.04]" : "border-foreground/15 bg-foreground/[0.02]"
        }`}
      >
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {loading ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
        </span>
        <div>
          <h2 className="text-h3 font-semibold">Upload a polling CSV</h2>
          <p className="mx-auto mt-1 max-w-sm text-small text-foreground/60">
            Respondent-level data in, a weighted dual-universe report out. Processed in your browser session —
            never stored.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Upload a respondent-level survey CSV from your field platform"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90"
          >
            <FileUp size={15} /> Choose CSV
          </button>
          <button
            type="button"
            onClick={onLoadSample}
            title="Load a sample dataset and see the report it produces"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-4 text-small font-medium text-primary hover:bg-primary/10"
          >
            <Sparkles size={15} /> See an example report
          </button>
          <button
            type="button"
            onClick={() => setPaste((v) => !v)}
            title="Paste CSV text instead of uploading a file"
            className="inline-flex h-10 items-center rounded-md border border-foreground/15 px-4 text-small font-medium text-foreground/70 hover:bg-foreground/5"
          >
            Paste CSV
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) readFile(f)
          }}
        />
      </div>

      {paste && (
        <div className="mt-3 flex flex-col gap-2 text-left">
          <p className="text-tiny text-foreground/60">
            Paste your survey as <span className="font-medium text-foreground/75">CSV</span>: a header row, then one row
            per respondent. Include the likely-voter questions (Q2 vote history, Q3 motivation, Q4 preparedness, Q5
            social) and demographics (age, sex, education, race, state, 2024 vote) — column names are auto-detected.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={
              "respondent_id,age,sex,education,race,state,Q2_vote_history,Q3_motivation,Q4_preparedness,Q5_social,who_did_you_vote_for_2024,<your question…>\n" +
              "1,54,Female,Bachelor's degree,White,FL,2024 General; 2022 General,I am certain to vote and highly motivated to do so,In person on Election Day — I know my polling location,Most of them plan to vote,Donald Trump,Republican candidate"
            }
            className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 font-mono text-tiny outline-none focus:border-primary/50"
          />
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => onData(text, "Pasted survey")}
            className="inline-flex h-9 w-fit items-center rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Build report
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
    </div>
  )
}
