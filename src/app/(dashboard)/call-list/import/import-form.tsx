"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FIELD_LABEL, type LeadField } from "@/lib/hq/call-lead-import";
import { ArrowLeft, Check, FileUp, Loader2 } from "lucide-react";

type CheckResult = {
  totalRows: number;
  newCount: number;
  alreadyInCrm: number;
  duplicatesInFile: number;
  skippedNoName: number;
  skippedNoPhone: number;
  unreadablePhones: number;
  recognised: { header: string; field: LeadField }[];
  extraHeaders: string[];
  sample: { business_name: string; phone: string; category: string | null }[];
};

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

export function ImportForm() {
  const [text, setText] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"check" | "import" | null>(null);
  const [done, setDone] = useState<{ inserted: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function edit(v: string) {
    setText(v);
    setCheck(null);
    setError("");
    setDone(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 3_000_000) { setError("That file is too big. Split it into batches of a few thousand leads."); return; }
    edit(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  async function run(dryRun: boolean) {
    setWorking(dryRun ? "check" : "import");
    setError("");
    try {
      const res = await fetch("/api/call-leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "That didn't work. Try again."); return; }
      if (dryRun) setCheck(data as CheckResult);
      else { setDone({ inserted: data.inserted as number }); setCheck(null); setText(""); }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setWorking(null);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border bg-card p-8 text-center ring-1 ring-foreground/5">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600"><Check size={20} /></span>
        <p className="mt-3 text-lg font-bold">
          {done.inserted.toLocaleString("en-AU")} new lead{done.inserted === 1 ? "" : "s"} added
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Anything already in the call list was left exactly as it was, notes included.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/call-list" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97]">Go to the call list</Link>
          <button type="button" onClick={() => setDone(null)} className="rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40">Import more</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/call-list" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Back to the call list
      </Link>

      <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Import leads from the Google Sheet</h2>
          <p className="text-xs text-muted-foreground">
            Select the rows in the sheet (include the header row), copy, and paste below. Or download the sheet as a CSV and choose the file.
          </p>
        </div>
        <div className="space-y-3 p-5">
          <textarea
            value={text}
            onChange={(e) => edit(e.target.value)}
            spellCheck={false}
            placeholder={"business_name\tnumber\twebsite\taddress\tcategory\t…\nBreeze Dental Helensvale\t(07) 5555 1234\thttps://…"}
            aria-label="Leads to import"
            className={cn(inputCls, "min-h-[220px] resize-y font-mono text-xs leading-relaxed")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(true)}
              disabled={!text.trim() || working !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
            >
              {working === "check" && <Loader2 size={14} className="animate-spin" />} Check the list
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/40"
            >
              <FileUp size={14} /> Choose a CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); }} />
            <span className="text-xs text-muted-foreground">Nothing is added until you confirm.</span>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">{error}</p>
          )}
        </div>
      </div>

      {check && (
        <div className="rounded-xl border bg-card ring-1 ring-foreground/5 animate-in fade-in slide-in-from-top-1">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">
              {check.newCount > 0
                ? `${check.newCount.toLocaleString("en-AU")} new lead${check.newCount === 1 ? "" : "s"} ready to import`
                : "Nothing new to import"}
            </h2>
            <p className="text-xs text-muted-foreground">{check.totalRows.toLocaleString("en-AU")} rows in what you pasted.</p>
          </div>
          <div className="space-y-4 p-5 text-sm">
            <ul className="space-y-1">
              {check.alreadyInCrm > 0 && <Line>{check.alreadyInCrm.toLocaleString("en-AU")} already in the call list. They stay as they are.</Line>}
              {check.duplicatesInFile > 0 && <Line>{check.duplicatesInFile.toLocaleString("en-AU")} repeated within your paste. Counted once.</Line>}
              {check.skippedNoPhone > 0 && <Line warn>{check.skippedNoPhone.toLocaleString("en-AU")} skipped: no phone number.</Line>}
              {check.skippedNoName > 0 && <Line warn>{check.skippedNoName.toLocaleString("en-AU")} skipped: no business name.</Line>}
              {check.unreadablePhones > 0 && (
                <Line warn>
                  {check.unreadablePhones.toLocaleString("en-AU")} {check.unreadablePhones === 1 ? "phone number doesn't" : "phone numbers don't"} look like a complete Australian number.
                  {check.unreadablePhones === 1 ? " It's" : " They're"} imported and copied exactly as typed.
                </Line>
              )}
            </ul>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-foreground/80">How your columns were read</div>
              <div className="flex flex-wrap gap-1.5">
                {check.recognised.map((r) => (
                  <span key={r.header} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {r.header} → {FIELD_LABEL[r.field]}
                  </span>
                ))}
                {check.extraHeaders.map((h) => (
                  <span key={h} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {h} → kept as extra info
                  </span>
                ))}
              </div>
            </div>

            {check.sample.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold text-foreground/80">First few new leads</div>
                <ul className="divide-y rounded-lg border">
                  {check.sample.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate font-medium">{s.business_name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.phone}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {check.newCount > 0 && (
              <button
                type="button"
                onClick={() => run(false)}
                disabled={working !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
              >
                {working === "import" && <Loader2 size={14} className="animate-spin" />}
                Import {check.newCount.toLocaleString("en-AU")} lead{check.newCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <li className={cn("text-sm", warn ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{children}</li>;
}
