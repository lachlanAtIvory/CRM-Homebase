"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { GraduationCap, RotateCcw, Send, X } from "lucide-react";

/**
 * The Guru — floating sales-trainer chatbot.
 *
 * Bubble bottom-right on every internal page; hover = gentle pulse +
 * "Ask the Guru" label; click = chat panel. Messages proxy through
 * POST /api/guru → the n8n guru engine (N8N_WEBHOOK_GURU). Conversation
 * persists in localStorage so it survives page navigation.
 */

type Msg = { role: "user" | "guru"; text: string };

const LS_CHAT = "guru.chat.v1";
const HISTORY_SENT = 12;   // how many prior messages travel with each request
const HISTORY_KEPT = 60;   // cap stored history

const STARTERS = [
  "Roleplay a receptionist gatekeeper — I'll try to get past you",
  "Drill me on the top 3 objections",
  "How do I pitch the ROI to a dental practice?",
] as const;

export function GuruWidget() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput]       = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore conversation once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CHAT);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* fresh start */ }
  }, []);

  // Persist + keep scrolled to the latest message
  useEffect(() => {
    try { localStorage.setItem(LS_CHAT, JSON.stringify(messages.slice(-HISTORY_KEPT))); }
    catch { /* noop */ }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || thinking) return;
    setInput("");
    const history = messages.slice(-HISTORY_SENT);
    setMessages((m) => [...m, { role: "user", text: message }]);
    setThinking(true);
    try {
      const res = await fetch("/api/guru", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ message, history }),
      });
      const out = (await res.json()) as { reply?: string; error?: string };
      const reply = res.ok && out.reply
        ? out.reply
        : (out.error ?? "Something went wrong — try again in a moment.");
      setMessages((m) => [...m, { role: "guru", text: reply }]);
    } catch {
      setMessages((m) => [...m, { role: "guru", text: "Couldn't reach the Guru — check your connection and try again." }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      {/* ── Floating bubble ─────────────────────────────────────────────── */}
      {!open && (
        <div className="group fixed bottom-6 right-6 z-50 flex items-center gap-3">
          {/* Hover label */}
          <span className="pointer-events-none translate-x-2 rounded-full border bg-card px-3.5 py-2 text-[13px] font-semibold shadow-lg ring-1 ring-foreground/5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            Ask the Guru ✨
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ask the Guru"
            className="grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(145deg,var(--brand),var(--brand-strong))] text-white shadow-[0_8px_24px_rgba(108,75,241,.45)] transition-shadow hover:animate-[guru-pulse_1.4s_ease-in-out_infinite] hover:shadow-[0_10px_32px_rgba(108,75,241,.6)]"
          >
            <GraduationCap size={24} />
          </button>
        </div>
      )}

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[560px] max-h-[calc(100vh-6rem)] w-[380px] max-w-[calc(100vw-3rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-foreground/5 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 border-b bg-[linear-gradient(145deg,var(--brand),var(--brand-strong))] px-4 py-3.5 text-white">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15">
              <GraduationCap size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold leading-tight">The Guru</div>
              <div className="text-[11px] text-white/75">Sales trainer · always game for a roleplay</div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X size={17} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <GuruBubble text="Gday — I'm the Guru. I know the Ivory playbook inside out. Want to drill objections, sharpen a pitch, or run a roleplay?" />
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border bg-background px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground active:scale-[0.98]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground shadow-sm animate-in fade-in slide-in-from-right-2 duration-200">
                    {m.text}
                  </div>
                </div>
              ) : (
                <GuruBubble key={i} text={m.text} />
              ),
            )}

            {thinking && (
              <div className="flex items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <GuruAvatar />
                <div className="rounded-2xl rounded-tl-md border bg-muted/40 px-3.5 py-2.5" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Guru&apos;s thinking</span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <form
            className="flex items-center gap-2 border-t px-3 py-3"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the Guru anything…"
              className="flex-1 rounded-full border bg-background px-4 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              aria-label="Send"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function GuruAvatar() {
  return (
    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,var(--brand),var(--brand-strong))] text-white shadow-sm">
      <GraduationCap size={13} />
    </div>
  );
}

function GuruBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <GuruAvatar />
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-md border bg-muted/40 px-3.5 py-2.5 text-[13px] leading-relaxed animate-in fade-in slide-in-from-left-2 duration-200">
        {text}
      </div>
    </div>
  );
}
