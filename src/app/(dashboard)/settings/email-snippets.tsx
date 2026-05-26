"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Check, Calendar } from "lucide-react";

const STORAGE_KEY  = "agentivory.email-snippet";
const DEFAULT_URL  = "https://calendly.com/agentivory";
const DEFAULT_TEXT = "📅 Book a Call";

/** Email-safe HTML — inline styles, table layout, works in Gmail / Outlook / Apple Mail / etc. */
function buildButtonHtml(url: string, text: string): string {
  const safeUrl  = escapeHtml(url);
  const safeText = escapeHtml(text);
  return `<table border="0" cellspacing="0" cellpadding="0" role="presentation" style="margin:16px 0;">
  <tr>
    <td align="center" bgcolor="#6c4bf1" style="border-radius:8px;">
      <a href="${safeUrl}" target="_blank" rel="noopener" style="display:inline-block; padding:14px 28px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:600; line-height:1; color:#ffffff; text-decoration:none; border-radius:8px;">${safeText}</a>
    </td>
  </tr>
</table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function EmailSnippets() {
  const [url,    setUrl]    = useState(DEFAULT_URL);
  const [text,   setText]   = useState(DEFAULT_TEXT);
  const [copied, setCopied] = useState(false);

  // Persist + restore from localStorage (per-browser, doesn't sync between team members)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.url  === "string") setUrl(parsed.url);
        if (typeof parsed.text === "string") setText(parsed.text);
      }
    } catch { /* fresh defaults */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, text })); } catch { /* noop */ }
  }, [url, text]);

  const html = buildButtonHtml(url, text);

  async function copyButton() {
    try {
      // Modern approach: write both text/html + text/plain to the clipboard.
      // When the user pastes into Gmail's compose, Gmail honours the HTML
      // and renders the actual button. Other apps fall back to plain text.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          "text/html":  new Blob([html], { type: "text/html"  }),
          "text/plain": new Blob([url],  { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        // Fallback (older Firefox etc): copy raw HTML as text
        await navigator.clipboard.writeText(html);
      }
      setCopied(true);
      toast.success("Button copied", {
        description: "Paste into Gmail / Outlook with Cmd+V — it'll render as a real button.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", {
        description: "Use 'Copy HTML source' below and paste manually.",
      });
    }
  }

  async function copyHtmlSource() {
    try {
      await navigator.clipboard.writeText(html);
      toast.success("HTML source copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Calendar size={16} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Book a Call — email button</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Branded button you paste into emails (under your Loom video, beside an outreach
            message, etc.) so prospects can book a call in one click.
          </p>
        </div>
      </div>

      {/* Configuration */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Calendly URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendly.com/agentivory"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Button text
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="📅 Book a Call"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Live preview — renders the exact same HTML the clipboard receives */}
      <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 p-6">
        <p className="mb-3 text-[11px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyButton}
          disabled={!url.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy button"}
        </button>
        <button
          type="button"
          onClick={copyHtmlSource}
          disabled={!url.trim()}
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy size={14} />
          Copy HTML source
        </button>
        {url.trim() && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <ExternalLink size={14} />
            Test link
          </a>
        )}
      </div>

      {/* HTML source viewer */}
      <details className="rounded-lg border bg-muted/30">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          View HTML source
        </summary>
        <pre className="overflow-x-auto rounded-b-lg border-t bg-background p-3 text-[11px] leading-relaxed">
{html}
        </pre>
      </details>

      {/* How-to */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs">
        <p className="mb-2 font-semibold">How to use it</p>
        <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
          <li>Click <span className="font-medium text-foreground">Copy button</span> above.</li>
          <li>Compose a new email (Gmail, Outlook, Apple Mail).</li>
          <li>Write your message + paste your Loom link.</li>
          <li>Press <kbd className="rounded border bg-background px-1 text-[10px]">Cmd</kbd>+<kbd className="rounded border bg-background px-1 text-[10px]">V</kbd> below it — the button renders, clickable.</li>
          <li>Send. Recipient clicks → opens your Calendly in a new tab.</li>
        </ol>
        <p className="mt-3 text-muted-foreground">
          <span className="font-medium text-foreground">Tip:</span> the URL + text you set above
          save automatically in this browser, so tomorrow you can just hit Copy.
        </p>
      </div>
    </div>
  );
}
