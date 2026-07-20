"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BookOpen, Search, X } from "lucide-react";

/**
 * Sales Bible reader — sticky table of contents, instant search, and a
 * compact markdown renderer tuned for the bible's structure (# chapters,
 * ## sections, ### sub-heads, - lists, > script blockquotes).
 */

type Section = { id: string; title: string; body: string };
type Chapter = { id: string; title: string; sections: Section[] };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function parseBible(md: string): Chapter[] {
  const chapters: Chapter[] = [];
  let chapter: Chapter | null = null;
  let section: Section | null = null;
  const seen = new Map<string, number>();
  const uniq = (s: string) => {
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    return n > 1 ? `${s}-${n}` : s;
  };

  for (const line of md.split("\n")) {
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      chapter = { id: uniq(slug(title)), title, sections: [] };
      chapters.push(chapter);
      section = null;
    } else if (line.startsWith("## ") && chapter) {
      const title = line.slice(3).trim();
      section = { id: uniq(slug(title)), title, body: "" };
      chapter.sections.push(section);
    } else if (chapter) {
      if (!section) {
        section = { id: uniq(`${chapter.id}-intro`), title: "", body: "" };
        chapter.sections.push(section);
      }
      section.body += line + "\n";
    }
  }
  return chapters;
}

export function BibleReader({ markdown }: { markdown: string }) {
  const chapters = useMemo(() => parseBible(markdown), [markdown]);
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return chapters;
    return chapters
      .map((c) => ({
        ...c,
        sections: c.sections.filter(
          (s) => s.title.toLowerCase().includes(query) || s.body.toLowerCase().includes(query),
        ),
      }))
      .filter((c) => c.sections.length > 0 || c.title.toLowerCase().includes(query));
  }, [chapters, query]);

  const matchCount = query ? filtered.reduce((n, c) => n + c.sections.length, 0) : 0;

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mx-auto flex max-w-6xl items-start gap-8">
      {/* ── TOC ──────────────────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden w-64 shrink-0 self-start lg:block">
        <div className="max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto pr-2">
          {chapters.map((c) => (
            <div key={c.id}>
              <button
                type="button"
                onClick={() => jump(c.id)}
                className="text-left text-[12px] font-bold uppercase tracking-wide text-primary transition-colors hover:text-primary/80"
              >
                {c.title}
              </button>
              <div className="mt-1.5 space-y-1 border-l pl-3">
                {c.sections.filter((s) => s.title).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jump(s.id)}
                    className="block text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        {/* Search */}
        <div className="sticky top-0 z-10 -mx-1 bg-muted/20 px-1 pb-3 pt-1 backdrop-blur-sm">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the bible — objections, pricing, scripts…"
              className="w-full rounded-xl border bg-card py-2.5 pl-10 pr-10 text-sm shadow-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {query && (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {matchCount === 0 ? "No sections match — try another word." : `${matchCount} section${matchCount === 1 ? "" : "s"} match`}
            </p>
          )}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-xl border bg-card p-12 text-center ring-1 ring-foreground/5">
            <BookOpen size={28} className="mx-auto opacity-30" />
            <p className="mt-3 text-sm text-muted-foreground">Nothing found for &ldquo;{q}&rdquo;.</p>
          </div>
        )}

        <div className="space-y-10 pb-16">
          {filtered.map((c) => (
            <section key={c.id} id={c.id} className="scroll-mt-16">
              <h1 className="border-b pb-2 text-xl font-extrabold tracking-tight text-primary">
                {c.title}
              </h1>
              <div className="mt-4 space-y-8">
                {c.sections.map((s) => (
                  <div key={s.id} id={s.id} className="scroll-mt-16">
                    {s.title && <h2 className="mb-2.5 text-base font-bold tracking-tight">{s.title}</h2>}
                    <Markdown body={s.body} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Markdown rendering (headings, lists, blockquotes, hr, inline) ───────── */

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**"))     out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{t.slice(1, -1)}</code>);
    else                        out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0, k = 0;

  const para = "text-[13.5px] leading-relaxed text-foreground/85";

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) { i++; continue; }

    if (/^#{3,4}\s/.test(line)) {
      blocks.push(<h3 key={k++} className="mt-5 text-sm font-bold">{inline(line.replace(/^#{3,4}\s/, ""))}</h3>);
      i++; continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push(<hr key={k++} className="my-5" />);
      i++; continue;
    }

    if (line.startsWith("> ") || line === ">") {
      const quote: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith(">") )) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={k++} className="my-3 rounded-r-lg border-l-2 border-primary bg-primary/5 px-4 py-2.5 text-[13.5px] font-medium leading-relaxed">
          {quote.map((ql, qi) => <p key={qi}>{inline(ql)}</p>)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s/, ""));
        i++;
      }
      blocks.push(
        <ul key={k++} className={cn("my-2.5 list-disc space-y-1.5 pl-5", para)}>
          {items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={k++} className={cn("my-2.5 list-decimal space-y-1.5 pl-5", para)}>
          {items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}
        </ol>,
      );
      continue;
    }

    // Paragraph — consume consecutive plain lines
    const p: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || /^([#>-]|\*\s|\d+[.)]\s|\*{3,})/.test(t)) break;
      p.push(t);
      i++;
    }
    blocks.push(<p key={k++} className={cn("my-2.5", para)}>{inline(p.join(" "))}</p>);
  }

  return <>{blocks}</>;
}
