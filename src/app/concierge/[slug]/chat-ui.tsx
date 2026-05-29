"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, Volume2, VolumeX, Loader2, X, UtensilsCrossed, Coffee, Beer, Eye, Trees, Clock, MapPin, Navigation, Share2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type LocalRec = {
  name:        string;
  category:    string | null;
  distance:    string | null;
  hours:       string | null;
  description: string | null;
  tags:        string[];
};

type Props = {
  hotelSlug:      string;
  hotelName:      string;
  tagline:        string | null;
  brandColor:     string;
  logoUrl:        string | null;
  hotelAddress:   string | null;
  greeting:       string;
  starterPrompts: string[];
  localRecs:      LocalRec[];
};

// Categories surfaced as quick-tap icons. Each has a matcher run against
// every local rec to build its filtered list. Order = display order.
const CATEGORIES: {
  id:     string;
  label:  string;
  icon:   typeof UtensilsCrossed;
  match:  (r: LocalRec) => boolean;
}[] = [
  {
    id: "food",   label: "Food",        icon: UtensilsCrossed,
    match: (r) => r.category === "restaurant"
               || r.tags.includes("dinner") || r.tags.includes("lunch"),
  },
  {
    id: "coffee", label: "Coffee",      icon: Coffee,
    match: (r) => r.category === "cafe"
               || r.tags.includes("coffee") || r.tags.includes("breakfast"),
  },
  {
    id: "drinks", label: "Drinks",      icon: Beer,
    match: (r) => r.category === "pub" || r.category === "rooftop bar"
               || r.tags.includes("drinks") || r.tags.includes("beer"),
  },
  {
    id: "sights", label: "Sightseeing", icon: Eye,
    match: (r) => r.category === "attraction"
               || r.tags.includes("sightseeing") || r.tags.includes("view"),
  },
  {
    id: "outdoor", label: "Outdoor",    icon: Trees,
    match: (r) => r.tags.includes("outdoor") || r.tags.includes("walk")
               || r.tags.includes("rooftop"),
  },
];

// Generic follow-up chips that surface after every assistant reply — keeps
// the conversation flowing without having to think of the next question.
const FOLLOWUP_CHIPS = [
  "What else is nearby?",
  "Something cheaper?",
  "What's open right now?",
  "Best for tonight?",
] as const;

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ConciergeChat({
  hotelSlug, hotelName, tagline, brandColor, logoUrl, hotelAddress, greeting, starterPrompts, localRecs,
}: Props) {
  // Splash → chat handshake. Required for iOS audio unlock; doubles as a
  // moment of polish that makes the bot feel like a real product loading.
  const [started, setStarted] = useState(false);
  // Per-browser identifiers so we can attribute conversations to a session
  const [sessionId,  setSessionId]  = useState<string>("");
  const [visitorId,  setVisitorId]  = useState<string>("");
  const [voiceMode,  setVoiceMode]  = useState(false);   // auto-listen + auto-speak
  const [speakReplies, setSpeakReplies] = useState(false); // speak responses aloud
  const [listening,  setListening]  = useState(false);
  const [speaking,   setSpeaking]   = useState(false);   // Maya is currently generating/playing
  const [pendingAudio, setPendingAudio] = useState<{ url: string; messageId: string } | null>(null); // tap-to-play fallback
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [input,      setInput]      = useState("");
  const [showExportConfirm, setShowExportConfirm] = useState(false); // Export confirmation screen
  const [showExportModal, setShowExportModal] = useState(false); // Export chat modal (message selection)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set()); // Messages to export

  // Pre-compute which categories actually have matching recs — empty ones
  // are hidden so we don't show, say, "Outdoor" if there's nothing tagged.
  const visibleCategories = CATEGORIES
    .map((cat) => ({ ...cat, recs: localRecs.filter(cat.match) }))
    .filter((cat) => cat.recs.length > 0);

  const activeCategoryRecs = activeCategory
    ? (visibleCategories.find((c) => c.id === activeCategory)?.recs ?? [])
    : [];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Persistent <audio> element — we "unlock" it on the speaker-toggle click
  // so iOS Safari lets us play() it later from outside a user-gesture window
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);
  const lastSpokenMsgIdRef = useRef<string | null>(null);
  const spokenAbortRef = useRef<AbortController | null>(null);
  // SYNCHRONOUS guard so double-tapping the splash CTA can't fire the
  // greeting fetch + audio play twice (was the cause of layered Maya audio).
  // We use a ref not state because state updates aren't applied within the
  // same event handler — two rapid taps see the same `started === false`.
  const splashStartedRef = useRef<boolean>(false);

  // useChat (AI SDK v6) — handles streaming + message state.
  //
  // IMPORTANT: we read sessionId / visitorId directly from localStorage
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
          sid = localStorage.getItem(`ivory-sid:${hotelSlug}`) || "";
          vid = localStorage.getItem(`ivory-vid:${hotelSlug}`)  || "";
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
  // Sessions persist on the device for 24 hours, allowing guests to resume conversations
  // If they close the browser and come back within 24h, they get the same session ID
  useEffect(() => {
    try {
      // Use localStorage (persists across browser closures) for session ID + timestamp
      const sidKey = `ivory-sid:${hotelSlug}`;
      const tsKey = `ivory-sid-ts:${hotelSlug}`;
      const storedSid = localStorage.getItem(sidKey);
      const storedTs = localStorage.getItem(tsKey);

      let sid: string = storedSid || randomId();
      const now = Date.now();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

      // If session exists and is < 24 hours old, reuse it; otherwise create new
      if (storedSid && storedTs) {
        const age = now - parseInt(storedTs, 10);
        if (age >= TWENTY_FOUR_HOURS) {
          // Session expired — create new one
          sid = randomId();
        }
      }

      localStorage.setItem(sidKey, sid);
      localStorage.setItem(tsKey, now.toString());
      setSessionId(sid);

      let vid = localStorage.getItem(`ivory-vid:${hotelSlug}`);
      if (!vid) { vid = randomId(); localStorage.setItem(`ivory-vid:${hotelSlug}`, vid); }
      setVisitorId(vid);
    } catch { /* private mode etc — generate ephemeral IDs */
      setSessionId(randomId());
      setVisitorId(randomId());
    }
  }, [hotelSlug]);

  // Load chat history from the database for returning guests
  const [history, setHistory] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!sessionId || historyLoaded) return;

    (async () => {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) return;

        const response = await fetch(
          `${supabaseUrl}/rest/v1/concierge_messages?session_id=eq.${sessionId}&order=created_at.asc&limit=100`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          }
        );

        if (!response.ok) return;

        const dbMessages = (await response.json()) as Array<{
          role: "user" | "assistant";
          content: string;
        }>;

        const historyMsgs = dbMessages.map((m, i) => ({
          id: `history-${i}`,
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        setHistory(historyMsgs);
      } catch (e) {
        console.error("Failed to load history:", e);
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [sessionId, historyLoaded]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Tiny haptic when a streamed text reply finishes (separate from Maya audio)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      try { navigator.vibrate?.(4); } catch { /* noop */ }
    }
    prevStatusRef.current = status;
  }, [status]);

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
    }
    setPendingAudio(null);

    const controller = new AbortController();
    spokenAbortRef.current = controller;
    const messageId = last.id;

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

        // Reuse the persistent (unlocked) audio element if we have one.
        // Critical for iOS Safari — a fresh `new Audio()` is treated as
        // outside the user-gesture window and play() rejects silently.
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          // Tiny haptic tick when Maya finishes — closes the loop
          try { navigator.vibrate?.(5); } catch { /* noop */ }
        };
        audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };

        try {
          await audio.play();
          // success — autoplay went through
        } catch {
          // iOS blocked autoplay (or user revoked permission). Stash the
          // audio URL so we can render a "tap to hear" chip the user can
          // click — that satisfies the gesture requirement.
          setSpeaking(false);
          setPendingAudio({ url, messageId });
        }
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
    }
    setPendingAudio(null);
    setSpeaking(false);
  }, [speakReplies]);

  /**
   * Called when the user taps the speaker icon — this happens INSIDE a
   * user-gesture, so we use it to "unlock" the persistent audio element
   * (iOS Safari). After this, future play() calls work even from outside
   * gesture windows.
   */
  function handleSpeakerToggle() {
    const turningOn = !speakReplies;
    setSpeakReplies(turningOn);

    if (turningOn && !audioUnlockedRef.current) {
      try {
        // 0.1s of silence — tiny WAV. Plays + immediately ends, which
        // counts as a user-initiated audio play and unlocks the element.
        const audio = new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=",
        );
        audio.volume = 0;
        audio.play().then(() => {
          audio.pause();
          audioRef.current = audio;
          audioUnlockedRef.current = true;
        }).catch(() => { /* unlock failed — tap-to-play fallback will kick in */ });
      } catch { /* noop */ }
    }
  }

  /** Tap-to-play fallback — user gesture lets us play the queued audio */
  function playPendingAudio() {
    if (!pendingAudio) return;
    const { url } = pendingAudio;
    setPendingAudio(null);
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = url;
    audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
    audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
    setSpeaking(true);
    audio.play().catch(() => setSpeaking(false));
  }

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
    haptic(8);                // micro-tactile send confirmation
    sendMessage({ text });
    setInput("");
  }

  function submitChip(text: string) {
    haptic(8);
    setInput("");
    sendMessage({ text });
  }

  /**
   * Splash-screen "Start chatting" — three things in one tap:
   *   1. Unlock the audio context (iOS won't let us play() without a gesture)
   *   2. Auto-speak the greeting in Maya's voice (the demo wow moment)
   *   3. Reveal the chat
   *
   * CRITICAL behaviour:
   * - Returns IMMEDIATELY (no awaited work in the click path) so the
   *   splash → chat transition is instant. Slow iOS Audio.play() unlocks
   *   used to make this feel frozen → user tapped again → audio layered.
   * - Synchronous ref guard prevents double-tap from firing the TTS twice.
   */
  function handleSplashStart() {
    if (splashStartedRef.current) return;  // synchronous dedupe
    splashStartedRef.current = true;

    haptic(15);
    setStarted(true);          // → reveal chat on the next render, FIRST
    setSpeakReplies(true);     // speaker on by default (they tapped, they want voice)
    audioUnlockedRef.current = true;

    // All audio work runs off the critical path so the UI updates instantly.
    (async () => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      // 1. Unlock with a silent buffer (iOS requires a play() in the same
      //    tick as the user gesture; we're still in the post-click microtask).
      try {
        audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=";
        audio.volume = 0;
        await audio.play();
        audio.pause();
      } catch { /* unlock failed — tap-to-play fallback covers us */ }

      // 2. Fetch Maya's voice for the greeting + play through the SAME
      //    audio element (which is now unlocked). Using one element
      //    means even if something race-conditions, we can't get layered
      //    playback — a new `.src` assignment supersedes the old stream.
      try {
        setSpeaking(true);
        const res = await fetch("/api/concierge/speak", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ text: greeting }),
        });
        if (!res.ok) { setSpeaking(false); return; }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);

        // Stop whatever the unlock audio is doing first
        try { audio.pause(); } catch { /* noop */ }
        audio.src    = url;
        audio.volume = 1;
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          haptic(5);
        };
        audio.onerror = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        await audio.play();
        // Mark this greeting as already-spoken so the speak effect doesn't re-fire
        lastSpokenMsgIdRef.current = "splash-greeting";
      } catch {
        setSpeaking(false);
      }
    })();
  }

  /** Wrap navigator.vibrate so it fails silently on browsers without it (most desktops) */
  function haptic(ms: number) {
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(ms);
      }
    } catch { /* noop */ }
  }

  /** Build a Google/Apple Maps directions URL from the hotel to a place */
  function directionsUrl(placeName: string): string {
    const dest = [placeName, hotelAddress].filter(Boolean).join(", ");
    return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(dest)}`;
  }

  /** Trigger the native share sheet (or fall back to copying the URL) */
  async function sharePlace(placeName: string) {
    haptic(8);
    const url  = directionsUrl(placeName);
    const text = `${placeName} — recommended by Ivory at ${hotelName}`;
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ title: placeName, text, url });
        return;
      }
    } catch { /* user dismissed — that's fine */ }
    // Fallback — copy
    try { await navigator.clipboard.writeText(`${text}\n${url}`); } catch { /* noop */ }
  }

  /** Find local-rec names mentioned in an assistant message (case-insensitive) */
  function findMentionedPlaces(text: string): LocalRec[] {
    if (!text || localRecs.length === 0) return [];
    const lower = text.toLowerCase();
    return localRecs.filter((r) => lower.includes(r.name.toLowerCase()));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const ready = status === "ready" || status === "submitted";
  const streaming = status === "streaming";

  // ── SPLASH ────────────────────────────────────────────────────────────────
  // Shown until the guest taps to start. Resolves the iOS-autoplay problem
  // (we get a real user gesture) AND gives the bot a polished launch moment.
  if (!started) {
    return (
      <div
        className="flex h-dvh flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 px-6"
        style={{ ["--brand" as string]: brandColor }}
      >
        <div className="flex w-full max-w-sm flex-col items-center text-center animate-in fade-in duration-500">
          {/* Logo / initial */}
          <div className="relative mb-6 animate-in zoom-in-50 duration-700">
            <span
              className="absolute inset-0 animate-ping rounded-full opacity-40"
              style={{ background: "var(--brand)", animationDuration: "2.4s" }}
            />
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={hotelName}
                className="relative h-20 w-20 rounded-3xl object-cover shadow-2xl"
                style={{ boxShadow: "0 16px 48px -12px color-mix(in oklch, var(--brand) 50%, transparent)" }}
              />
            ) : (
              <div
                className="relative flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-2xl"
                style={{
                  background: "var(--brand)",
                  boxShadow:  "0 16px 48px -12px color-mix(in oklch, var(--brand) 50%, transparent)",
                }}
              >
                {hotelName.charAt(0)}
              </div>
            )}
          </div>

          <h1 className="mb-2 text-xl font-semibold tracking-tight animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: "200ms", animationFillMode: "backwards" }}>
            {hotelName}
          </h1>
          {tagline && (
            <p className="mb-1 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: "280ms", animationFillMode: "backwards" }}>
              {tagline}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground animate-in fade-in duration-500" style={{ animationDelay: "360ms", animationFillMode: "backwards" }}>
            <Sparkles size={10} style={{ color: "var(--brand)" }} />
            Ivory Concierge
          </div>

          <p className="mt-8 max-w-xs text-sm text-foreground/80 animate-in fade-in slide-in-from-bottom-3 duration-500" style={{ animationDelay: "440ms", animationFillMode: "backwards" }}>
            Your 24/7 in-room concierge. Ask anything — opening hours, food, things to do.
          </p>

          <button
            type="button"
            onClick={handleSplashStart}
            className="group mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.97] animate-in fade-in slide-in-from-bottom-4 duration-500"
            style={{
              background: "var(--brand)",
              boxShadow:  "0 16px 40px -8px color-mix(in oklch, var(--brand) 60%, transparent)",
              animationDelay:   "560ms",
              animationFillMode: "backwards",
            }}
          >
            <Sparkles size={14} className="transition-transform duration-300 group-hover:rotate-12" />
            Tap to start chatting
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>

          <p className="mt-6 text-[10px] text-muted-foreground/70 animate-in fade-in duration-500" style={{ animationDelay: "700ms", animationFillMode: "backwards" }}>
            Powered by{" "}
            <a
              href="https://agentivory.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--brand)" }}
            >
              Agent Ivory
            </a>
          </p>
        </div>
      </div>
    );
  }

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
          onClick={handleSpeakerToggle}
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

        {/* Export chat button */}
        <button
          type="button"
          onClick={() => setShowExportConfirm(true)}
          disabled={messages.length === 0}
          className="rounded-full p-2 transition-all hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            color: messages.length > 0 ? "var(--brand)" : "var(--muted-foreground)",
            fontWeight: "600",
          }}
          title="Export this conversation"
          aria-label="Export chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </header>

      {/* ── Messages ─── */}
      <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {/* Greeting — only show if no history and no current messages */}
          {history.length === 0 && messages.length === 0 && (
            <AssistantBubble brandColor={brandColor} text={greeting} fresh />
          )}

          {/* Render restored history + current messages together */}
          {[...history, ...messages].map((m, i) => {
            if (m.role === "user") {
              return <UserBubble key={m.id} brandColor={brandColor} text={messageToText(m)} />;
            }
            const text = messageToText(m);
            const allMsgs = [...history, ...messages];
            const isLastAssistant = i === allMsgs.length - 1;
            const stillStreaming  = isLastAssistant && streaming;
            const places = !stillStreaming ? findMentionedPlaces(text) : [];
            return (
              <div key={m.id} className="space-y-2">
                <AssistantBubble brandColor={brandColor} text={text} />
                {/* Action buttons for each mentioned local rec */}
                {places.length > 0 && (
                  <div className="ml-9 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-left-1 duration-300">
                    {places.map((place) => (
                      <div
                        key={place.name}
                        className="inline-flex items-center gap-1 rounded-full border bg-background pr-1 shadow-sm"
                      >
                        <span className="px-2.5 py-1 text-[11px] font-medium">
                          {place.name}
                        </span>
                        <a
                          href={directionsUrl(place.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => haptic(8)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Get directions"
                          aria-label={`Directions to ${place.name}`}
                        >
                          <Navigation size={12} />
                        </a>
                        <button
                          type="button"
                          onClick={() => sharePlace(place.name)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Share"
                          aria-label={`Share ${place.name}`}
                        >
                          <Share2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Follow-up chips on the LAST finished assistant message */}
                {isLastAssistant && !stillStreaming && (
                  <div className="ml-9 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-left-1 duration-500" style={{ animationDelay: "200ms", animationFillMode: "backwards" }}>
                    {FOLLOWUP_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => submitChip(chip)}
                        disabled={!ready || !sessionId}
                        className="rounded-full border bg-background/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground active:scale-[0.97] disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

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

          {pendingAudio && (
            <button
              type="button"
              onClick={playPendingAudio}
              className="flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-md transition-all hover:opacity-90 active:scale-[0.97] animate-in fade-in slide-in-from-left-1"
              style={{ background: "var(--brand)" }}
            >
              <Volume2 size={12} />
              Tap to hear reply
            </button>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Smart starter chips — only shown before the first message.
            Generated server-side based on current time of day + weather. ── */}
      {messages.length === 0 && history.length === 0 && starterPrompts.length > 0 && (
        <div className="shrink-0 overflow-x-auto border-t bg-card/60 px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
            {starterPrompts.map((p) => (
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

      {/* ── Category icon bar (always visible, opens a sheet of curated picks) ── */}
      {visibleCategories.length > 0 && (
        <div className="shrink-0 border-t bg-card/60 px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-2xl items-center justify-around gap-1 sm:gap-2">
            {visibleCategories.map((cat) => {
              const Icon = cat.icon;
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(active ? null : cat.id)}
                  disabled={!ready || !sessionId}
                  className={cn(
                    "group flex flex-1 flex-col items-center gap-1 rounded-xl p-2 transition-all duration-150 active:scale-[0.95] disabled:opacity-50",
                    active && "scale-[1.05]",
                  )}
                  title={`${cat.label} — ${cat.recs.length} pick${cat.recs.length === 1 ? "" : "s"}`}
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full transition-all"
                    style={{
                      background: active ? "var(--brand)" : "color-mix(in oklch, var(--brand) 12%, transparent)",
                      color:      active ? "white"        : "var(--brand)",
                    }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Category sheet — bottom-sheet pattern (mobile-first) ── */}
      {activeCategory && activeCategoryRecs.length > 0 && (
        <div
          className="fixed inset-0 z-30 flex flex-col bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setActiveCategory(null)}
        >
          <div className="mt-auto" onClick={(e) => e.stopPropagation()}>
            <div className="max-h-[75dvh] overflow-y-auto rounded-t-3xl border-t bg-card shadow-2xl animate-in slide-in-from-bottom duration-200">
              {/* Sheet handle + header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-3 backdrop-blur">
                <div className="flex items-center gap-2">
                  {(() => {
                    const cat = visibleCategories.find((c) => c.id === activeCategory);
                    if (!cat) return null;
                    const Icon = cat.icon;
                    return (
                      <>
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                          style={{ background: "var(--brand)" }}
                        >
                          <Icon size={14} />
                        </span>
                        <h3 className="text-sm font-semibold">{cat.label} nearby</h3>
                        <span className="text-xs text-muted-foreground">
                          ({cat.recs.length} pick{cat.recs.length === 1 ? "" : "s"})
                        </span>
                      </>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* List of curated picks */}
              <div className="p-4 space-y-2">
                {activeCategoryRecs.map((rec) => (
                  <button
                    key={rec.name}
                    type="button"
                    onClick={() => {
                      submitChip(`Tell me about ${rec.name}`);
                      setActiveCategory(null);
                    }}
                    className="group flex w-full flex-col gap-1 rounded-xl border bg-background p-4 text-left transition-all duration-150 hover:border-foreground/20 hover:bg-muted/30 hover:shadow-md active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-tight">{rec.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {rec.distance && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={10} />
                              {rec.distance}
                            </span>
                          )}
                          {rec.hours && (
                            <span className="inline-flex items-center gap-1">
                              <Clock size={10} />
                              {rec.hours}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white transition-transform group-hover:translate-x-0.5"
                        style={{ background: "var(--brand)" }}
                      >
                        Ask Ivory →
                      </span>
                    </div>
                    {rec.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        &ldquo;{rec.description}&rdquo;
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
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
            // text-base (16px) prevents iOS Safari zoom-on-focus. NEVER drop
            // this below 16px on a mobile input.
            className="max-h-24 min-h-[44px] flex-1 resize-none rounded-2xl border bg-background px-4 py-3 text-base outline-none ring-1 ring-transparent transition-all placeholder:text-muted-foreground focus:ring-2"
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
          Powered by{" "}
          <a
            href="https://agentivory.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 transition-all hover:underline"
            style={{ color: "var(--brand)" }}
          >
            Agent Ivory
          </a>
          {" "}· Replies generated by AI — for emergencies dial 000
        </p>
      </footer>

      {/* ── Export Confirmation Screen ─── */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full sm:w-96 rounded-2xl bg-background border shadow-lg animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">Export Conversation</h2>
              <button
                onClick={() => setShowExportConfirm(false)}
                className="rounded-full p-1.5 hover:bg-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              <div className="space-y-3">
                <p className="text-sm leading-relaxed">
                  <strong>Privacy Notice:</strong> Your conversations with Ivory are <strong>not automatically saved</strong> on our servers. Each time you refresh or close this page, your chat history is cleared.
                </p>

                <p className="text-sm leading-relaxed">
                  The export feature allows you to <strong>manually download your conversation</strong> to your device so you can keep it for future reference.
                </p>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  By exporting, you are choosing to save this conversation locally on your device. Ivory Concierge will not retain a copy.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 border-t px-6 py-4">
              <button
                onClick={() => setShowExportConfirm(false)}
                className="flex-1 px-4 py-2 rounded-lg border hover:bg-muted transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowExportConfirm(false);
                  setShowExportModal(true);
                }}
                className="flex-1 px-4 py-2 rounded-lg text-white transition-colors text-sm font-medium"
                style={{ background: "var(--brand)" }}
              >
                I Agree, Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export Modal (Message Selection) ─── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full sm:w-96 max-h-[80vh] overflow-y-auto rounded-2xl bg-background border shadow-lg animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
            {/* Modal header */}
            <div className="sticky top-0 flex items-center justify-between border-b bg-background/95 px-6 py-4">
              <h2 className="font-semibold">Export Conversation</h2>
              <button
                onClick={() => setShowExportModal(false)}
                className="rounded-full p-1.5 hover:bg-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Message selection */}
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Select messages to save and download to your device
              </p>

              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No messages yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {messages.map((msg) => (
                    <label key={msg.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedMsgIds.has(msg.id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedMsgIds);
                          if (e.target.checked) {
                            newSelected.add(msg.id);
                          } else {
                            newSelected.delete(msg.id);
                          }
                          setSelectedMsgIds(newSelected);
                        }}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm line-clamp-2 ${msg.role === "user" ? "font-medium" : ""}`}>
                          {messageToText(msg)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {msg.role === "user" ? "You" : "Maya"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="sticky bottom-0 flex gap-2 border-t bg-background/95 px-6 py-4">
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border hover:bg-muted transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Generate PDF from selected messages
                  const selectedMsgs = messages.filter((m) => selectedMsgIds.has((m as any).id));
                  const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                      <meta charset="UTF-8">
                      <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        html, body {
                          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;
                          background: white;
                          color: #1f2937;
                          line-height: 1.5;
                        }
                        body {
                          padding: 48px 40px;
                          max-width: 800px;
                          margin: 0 auto;
                        }
                        .header {
                          text-align: center;
                          margin-bottom: 40px;
                          padding-bottom: 24px;
                          border-bottom: 3px solid ${brandColor};
                        }
                        .header-brand {
                          font-size: 14px;
                          font-weight: 600;
                          letter-spacing: 0.5px;
                          color: ${brandColor};
                          margin-bottom: 8px;
                          text-transform: uppercase;
                        }
                        .header h1 {
                          font-size: 32px;
                          font-weight: 700;
                          margin-bottom: 12px;
                          color: #1f2937;
                        }
                        .header-meta {
                          display: flex;
                          justify-content: center;
                          gap: 20px;
                          font-size: 13px;
                          color: #6b7280;
                          margin-top: 16px;
                        }
                        .messages {
                          margin-top: 40px;
                          display: flex;
                          flex-direction: column;
                          gap: 16px;
                        }
                        .message {
                          display: flex;
                          width: 100%;
                          margin-bottom: 12px;
                        }
                        .message.user {
                          justify-content: flex-end;
                        }
                        .message.assistant {
                          justify-content: flex-start;
                        }
                        .message-wrapper {
                          max-width: 85%;
                          display: flex;
                          flex-direction: column;
                          gap: 4px;
                        }
                        .message.user .message-wrapper {
                          align-items: flex-end;
                        }
                        .speaker-label {
                          font-size: 11px;
                          font-weight: 600;
                          color: #9ca3af;
                          text-transform: uppercase;
                          letter-spacing: 0.3px;
                          padding: 0 8px;
                        }
                        .bubble {
                          padding: 12px 16px;
                          border-radius: 16px;
                          word-wrap: break-word;
                          white-space: pre-wrap;
                          font-size: 15px;
                          line-height: 1.5;
                          box-shadow: 0 1px 2px rgba(0,0,0,0.08);
                        }
                        .message.user .bubble {
                          background: ${brandColor};
                          color: white;
                          border-bottom-right-radius: 4px;
                        }
                        .message.assistant .bubble {
                          background: #f3f4f6;
                          color: #1f2937;
                          border-bottom-left-radius: 4px;
                        }
                        .divider {
                          height: 1px;
                          background: #e5e7eb;
                          margin: 20px 0;
                        }
                        .footer {
                          margin-top: 48px;
                          padding-top: 24px;
                          border-top: 1px solid #e5e7eb;
                          text-align: center;
                        }
                        .footer-title {
                          font-size: 13px;
                          font-weight: 600;
                          color: #374151;
                          margin-bottom: 8px;
                        }
                        .footer-text {
                          font-size: 12px;
                          color: #9ca3af;
                          line-height: 1.6;
                        }
                      </style>
                    </head>
                    <body>
                      <div class="header">
                        <div class="header-brand">Ivory Concierge</div>
                        <h1>${hotelName}</h1>
                        <div class="header-meta">
                          <span>📅 ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
                          <span>🕐 ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>

                      <div class="messages">
                        ${selectedMsgs.map((msg) => {
                          const text = messageToText(msg);
                          const isUser = msg.role === "user";
                          const speaker = isUser ? "You" : "Maya";
                          const escapedText = text
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");
                          return `
                            <div class="message ${isUser ? "user" : "assistant"}">
                              <div class="message-wrapper">
                                <div class="speaker-label">${speaker}</div>
                                <div class="bubble">${escapedText}</div>
                              </div>
                            </div>
                          `;
                        }).join("")}
                      </div>

                      <div class="divider"></div>

                      <div class="footer">
                        <div class="footer-title">Ivory Concierge</div>
                        <div class="footer-text">
                          This conversation was exported for your personal reference.<br>
                          For more information, visit agentivory.com
                        </div>
                      </div>
                    </body>
                    </html>
                  `;

                  // Load html2pdf and generate PDF
                  console.log("Starting PDF export...");
                  const script = document.createElement("script");
                  script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
                  script.onerror = () => {
                    console.error("Failed to load html2pdf library from CDN");
                  };
                  script.onload = () => {
                    try {
                      console.log("html2pdf library loaded, html2pdf available:", typeof (window as any).html2pdf);
                      const element = document.createElement("div");
                      element.innerHTML = htmlContent;
                      const filename = `Ivory-${hotelName.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.pdf`;
                      const opt = {
                        margin: [12, 10, 12, 10], // mm: top, left, bottom, right
                        filename,
                        image: { type: "jpeg", quality: 0.98 },
                        html2canvas: { scale: 2, logging: false },
                        jsPDF: { orientation: "portrait", unit: "mm", format: "a4" },
                      };
                      console.log("Calling html2pdf with options:", opt);
                      (window as any).html2pdf().set(opt).fromElement(element).save();
                      console.log("PDF generation initiated");
                    } catch (err) {
                      console.error("Error in PDF generation:", err);
                    }
                  };
                  document.head.appendChild(script);

                  setShowExportModal(false);
                  setSelectedMsgIds(new Set());
                }}
                disabled={selectedMsgIds.size === 0}
                className="flex-1 px-4 py-2 rounded-lg text-white transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--brand)" }}
              >
                Export as PDF
              </button>
            </div>
          </div>
        </div>
      )}
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
