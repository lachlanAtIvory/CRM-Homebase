"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, Volume2, VolumeX, Loader2 } from "lucide-react";

type Props = {
  hotelSlug:  string;
  hotelName:  string;
  tagline:    string | null;
  brandColor: string;
  logoUrl:    string | null;
  greeting:   string;
};

// Quick-tap chips guests see before typing. Chosen to showcase the bot's strengths.
const QUICK_PROMPTS = [
  "What time is checkout?",
  "What's the WiFi password?",
  "Where should I eat tonight?",
  "Is the gym open right now?",
  "How do I get to the harbour?",
  "Recommend a coffee spot",
] as const;

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ConciergeChat({
  hotelSlug, hotelName, tagline, brandColor, logoUrl, greeting,
}: Props) {
  // Per-browser identifiers so we can attribute conversations to a session
  const [sessionId,  setSessionId]  = useState<string>("");
  const [visitorId,  setVisitorId]  = useState<string>("");
  const [voiceMode,  setVoiceMode]  = useState(false);   // auto-listen + auto-speak
  const [speakReplies, setSpeakReplies] = useState(false); // speak responses aloud
  const [listening,  setListening]  = useState(false);
  const [speaking,   setSpeaking]   = useState(false);   // Maya is currently generating/playing
  const [input,      setInput]      = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenMsgIdRef = useRef<string | null>(null);
  const spokenAbortRef = useRef<AbortController | null>(null);

  // useChat (AI SDK v6) — handles streaming + message state.
  //
  // IMPORTANT: we read sessionId / visitorId directly from sessionStorage
  // inside the prepareSendMessagesRequest callback rather than closing over
  // React state. The transport is created on first render where those state
  // values are still "" (they're populated by the useEffect below), and the
  // captured closure was sending empty strings → API returned 400 → UI
  // showed "Something went wrong" on every message. Reading from storage
  // at request time guarantees we always have the latest values.
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/concierge/chat",
      prepareSendMessagesRequest: ({ messages, body }) => {
        let sid = "";
        let vid = "";
        try {
          sid = sessionStorage.getItem(`ivory-sid:${hotelSlug}`) || "";
          vid = localStorage.getItem(`ivory-vid:${hotelSlug}`)    || "";
        } catch { /* private mode etc */ }
        return {
          body: {
            messages,
            hotelSlug,
            sessionId: sid,
            visitorId: vid,
            ...body,
          },
        };
      },
    }),
  });

  // Initialise session + visitor IDs from storage
  useEffect(() => {
    try {
      let sid = sessionStorage.getItem(`ivory-sid:${hotelSlug}`);
      if (!sid) { sid = randomId(); sessionStorage.setItem(`ivory-sid:${hotelSlug}`, sid); }
      setSessionId(sid);

      let vid = localStorage.getItem(`ivory-vid:${hotelSlug}`);
      if (!vid) { vid = randomId(); localStorage.setItem(`ivory-vid:${hotelSlug}`, vid); }
      setVisitorId(vid);
    } catch { /* private mode etc — generate ephemeral IDs */
      setSessionId(randomId());
      setVisitorId(randomId());
    }
  }, [hotelSlug]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Speak assistant replies in Maya's voice (ElevenLabs) when speaker is on.
  // Fires once per assistant message — guarded by `lastSpokenMsgIdRef` so
  // re-renders during streaming don't trigger duplicate audio.
  useEffect(() => {
    if (!speakReplies) return;
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenMsgIdRef.current === last.id) return;
    const text = messageToText(last);
    if (!text.trim()) return;

    lastSpokenMsgIdRef.current = last.id;

    // Cancel any in-flight TTS + currently-playing audio
    spokenAbortRef.current?.abort();
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch { /* noop */ }
      audioRef.current = null;
    }

    const controller = new AbortController();
    spokenAbortRef.current = controller;

    (async () => {
      try {
        setSpeaking(true);
        const res = await fetch("/api/concierge/speak", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ text }),
          signal:  controller.signal,
        });
        if (!res.ok) { setSpeaking(false); return; }

        const blob = await res.blob();
        if (controller.signal.aborted) { setSpeaking(false); return; }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audioRef.current = audio;
        await audio.play().catch(() => { setSpeaking(false); });
      } catch {
        setSpeaking(false);
      }
    })();

    return () => { controller.abort(); };
  }, [messages, status, speakReplies]);

  // Toggling the speaker OFF cuts whatever Maya is saying mid-sentence
  useEffect(() => {
    if (speakReplies) return;
    spokenAbortRef.current?.abort();
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch { /* noop */ }
      audioRef.current = null;
    }
    setSpeaking(false);
  }, [speakReplies]);

  // ── Voice input via browser SpeechRecognition ──────────────────────────────
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supportsVoice  = typeof window !== "undefined" &&
    !!(window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const startListening = useCallback(() => {
    if (!supportsVoice || listening) return;
    try {
      const SR = (window.SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition: new () => SpeechRecognitionLike }).webkitSpeechRecognition) as new () => SpeechRecognitionLike;
      const recognition = new SR();
      recognition.lang = "en-AU";
      recognition.continuous = false;
      recognition.interimResults = true;

      let transcript = "";
      recognition.onresult = (e: SpeechRecognitionEventLike) => {
        transcript = Array.from(e.results)
          .map((r) => r[0].transcript)
          .join("");
        setInput(transcript);
      };
      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        const final = transcript.trim();
        if (voiceMode && final) {
          // Voice mode = auto-send when the user stops speaking
          sendMessage({ text: final });
          setInput("");
        }
      };
      recognition.onerror = () => {
        setListening(false);
        recognitionRef.current = null;
      };
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [supportsVoice, listening, voiceMode, sendMessage]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  // ── Submit handlers ────────────────────────────────────────────────────────
  function submit() {
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  function submitChip(text: string) {
    setInput("");
    sendMessage({ text });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const ready = status === "ready" || status === "submitted";
  const streaming = status === "streaming";

  return (
    <div
      className="flex h-dvh flex-col bg-gradient-to-b from-background to-muted/20"
      style={{ ["--brand" as string]: brandColor }}
    >
      {/* ── Header ─── */}
      <header className="flex shrink-0 items-center justify-between border-b bg-card/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={hotelName} className="h-8 w-auto shrink-0" />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              {hotelName.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{hotelName}</div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles size={9} style={{ color: "var(--brand)" }} />
              Ivory Concierge
              {tagline && <span className="hidden sm:inline">· {tagline}</span>}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSpeakReplies((s) => !s)}
          className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={speakReplies ? "Stop reading replies aloud" : "Hear replies in Maya's voice"}
          aria-label={speakReplies ? "Mute" : "Unmute"}
        >
          {speaking && (
            <span
              className="absolute inset-0 animate-ping rounded-full opacity-40"
              style={{ background: "var(--brand)" }}
            />
          )}
          {speakReplies ? (
            <Volume2 size={16} className="relative" style={{ color: "var(--brand)" }} />
          ) : (
            <VolumeX size={16} className="relative" />
          )}
        </button>
      </header>

      {/* ── Messages ─── */}
      <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {/* Greeting */}
          <AssistantBubble brandColor={brandColor} text={greeting} fresh={messages.length === 0} />

          {messages.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} brandColor={brandColor} text={messageToText(m)} />
            ) : (
              <AssistantBubble key={m.id} brandColor={brandColor} text={messageToText(m)} />
            ),
          )}

          {streaming && (
            <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2">
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
              </span>
              Ivory is typing
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Something went wrong. Try again, or press 0 on your room phone for reception.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Quick chips (only when no conversation yet) ─── */}
      {messages.length === 0 && (
        <div className="shrink-0 overflow-x-auto border-t bg-card/60 px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => submitChip(p)}
                disabled={!ready || !sessionId}
                className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:border-foreground/20 hover:bg-muted/40 active:scale-[0.97] disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input ─── */}
      <footer className="shrink-0 border-t bg-card/80 px-3 py-3 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          {supportsVoice && (
            <button
              type="button"
              onClick={() => {
                if (listening) stopListening();
                else { setVoiceMode(true); startListening(); }
              }}
              disabled={!ready || !sessionId}
              title={listening ? "Stop listening" : "Tap to speak"}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.95] disabled:opacity-50"
              style={{
                background: listening ? "var(--brand)" : "transparent",
                color:      listening ? "white"         : "var(--brand)",
                border:     listening ? "none"          : "1px solid color-mix(in oklch, var(--brand) 30%, transparent)",
              }}
            >
              {listening && (
                <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: "var(--brand)" }} />
              )}
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setVoiceMode(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={listening ? "Listening…" : "Ask me anything…"}
            disabled={!ready || !sessionId}
            rows={1}
            className="max-h-24 min-h-[44px] flex-1 resize-none rounded-2xl border bg-background px-4 py-3 text-sm outline-none ring-1 ring-transparent transition-all placeholder:text-muted-foreground focus:ring-2"
            style={{
              boxShadow: "inset 0 1px 0 rgba(0,0,0,0.02)",
              ["--tw-ring-color" as string]: "color-mix(in oklch, var(--brand) 40%, transparent)",
            }}
          />

          <button
            type="button"
            onClick={submit}
            disabled={!ready || !sessionId || !input.trim()}
            title="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-all active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--brand)" }}
          >
            {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-muted-foreground">
          Powered by <span style={{ color: "var(--brand)" }} className="font-medium">Agent Ivory</span> · Replies generated by AI — for emergencies dial 000
        </p>
      </footer>
    </div>
  );
}

// ─── Bubbles ────────────────────────────────────────────────────────────────
function UserBubble({ brandColor, text }: { brandColor: string; text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white shadow-sm animate-in fade-in slide-in-from-right-2 duration-200"
        style={{ background: brandColor }}
      >
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ brandColor, text, fresh }: { brandColor: string; text: string; fresh?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
        style={{ background: brandColor }}
      >
        <Sparkles size={12} />
      </div>
      <div className={`max-w-[85%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm ${fresh ? "" : "animate-in fade-in slide-in-from-left-2 duration-200"}`}>
        {text}
      </div>
    </div>
  );
}

// ─── Helpers / SpeechRecognition shims ──────────────────────────────────────
type UIMessageLike = {
  role: string;
  content?: string;
  parts?: Array<{ type: string; text?: string }>;
};

function messageToText(m: UIMessageLike): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

// Minimal SpeechRecognition typings (browser API isn't in lib.dom.d.ts everywhere)
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
