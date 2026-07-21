"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { QUIZ_BANK, type QuizQuestion } from "@/lib/hq/motivation-quiz";
import type { DialResult, MotivationStats } from "@/lib/hq/motivation-stats";
import {
  Brain, CalendarCheck2, CheckCircle2, Loader2, Phone, PhoneMissed,
  RotateCcw, Voicemail, Volume2, VolumeX, X, XCircle,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   Tiny synth — dopamine sounds with zero audio assets
═══════════════════════════════════════════════════════════════════════════ */
let audioCtx: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur);
}
const sfx = {
  click:   () => tone(660, 0, 0.08, "triangle", 0.1),
  ding:    () => { tone(880, 0, 0.15); tone(1320, 0.1, 0.25); },
  wrong:   () => tone(180, 0, 0.25, "square", 0.05),
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, "triangle", 0.1)); },
  mega:    () => { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.35, "triangle", 0.11)); },
};

/* ═══════════════════════════════════════════════════════════════════════════
   Confetti — dependency-free canvas particles
═══════════════════════════════════════════════════════════════════════════ */
type Particle = {
  x: number; y: number; vx: number; vy: number;
  rot: number; vrot: number; size: number; color: string; life: number;
};
const BRAND_COLORS = ["#6c4bf1", "#b09dff", "#4c2dd3", "#f59e0b", "#10b981", "#ffffff"];
const GOLD_COLORS  = ["#f59e0b", "#fbbf24", "#fde68a", "#6c4bf1", "#ffffff"];

function useConfetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number>(0);

  const loop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const g = canvas.getContext("2d"); if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    particles.current = particles.current.filter((p) => p.life > 0 && p.y < canvas.height + 40);
    for (const p of particles.current) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.rot += p.vrot; p.life -= 1;
      g.save();
      g.translate(p.x, p.y); g.rotate(p.rot);
      g.globalAlpha = Math.min(1, p.life / 40);
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      g.restore();
    }
    if (particles.current.length > 0) raf.current = requestAnimationFrame(loop);
  }, []);

  const burst = useCallback((opts: { xFrac: number; yFrac: number; count: number; colors?: string[]; power?: number }) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const colors = opts.colors ?? BRAND_COLORS;
    const power = opts.power ?? 1;
    for (let i = 0; i < opts.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 7) * power;
      particles.current.push({
        x: canvas.width * opts.xFrac, y: canvas.height * opts.yFrac,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 4 * power,
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.3,
        size: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 90 + Math.random() * 60,
      });
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { canvasRef, burst };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Local persistence helpers (goal, sound, milestones, drill score)
═══════════════════════════════════════════════════════════════════════════ */
function todayKeyAU(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}
function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; }
  catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

const TIER_LINES: [number, string][] = [
  [100, "Goal smashed. Everything from here is compound interest."],
  [75,  "Almost there. Every call ends with a locked next step or a clean exit."],
  [50,  "Halfway. Process shows up every day whether you feel like it or not."],
  [25,  "The enemy is the unanswered call. Keep dialling."],
  [1,   "Volume solves what talent cannot. Reps build the belief."],
  [0,   "Evidence before pitch. Calendar before proposal. Make the first dial."],
];

const QUIZ_CHANCE = 0.25;

type Celebration = { title: string; line: string; gold?: boolean } | null;

/* ═══════════════════════════════════════════════════════════════════════════
   The dashboard
═══════════════════════════════════════════════════════════════════════════ */
export function MotivationDashboard({
  initialStats, actor,
}: {
  initialStats: MotivationStats;
  actor: string;
}) {
  const [stats, setStats]   = useState(initialStats);
  const [goal, setGoal]     = useState(50);
  const [soundOn, setSound] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [quiz, setQuiz]         = useState<QuizQuestion | null>(null);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [drill, setDrill]       = useState({ right: 0, wrong: 0 });
  const [showBooked, setShowBooked] = useState(false);
  const [celebration, setCelebration] = useState<Celebration>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { canvasRef, burst } = useConfetti();
  const statsRef = useRef(stats);
  statsRef.current = stats;

  // Restore persisted bits after mount
  useEffect(() => {
    setGoal(lsGet("motivation.goal.v1", 50));
    setSound(lsGet("motivation.sound.v1", true));
    const d = lsGet<{ date: string; right: number; wrong: number }>("motivation.drill.v1", { date: "", right: 0, wrong: 0 });
    if (d.date === todayKeyAU()) setDrill({ right: d.right, wrong: d.wrong });
  }, []);

  const play = useCallback((fn: keyof typeof sfx) => { if (soundOn) sfx[fn](); }, [soundOn]);
  const haptic = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* noop */ } };

  /* ── Milestones ─────────────────────────────────────────────────────────── */
  const checkMilestones = useCallback((calls: number, g: number) => {
    const key = "motivation.milestones.v1";
    const state = lsGet<{ date: string; hit: number[] }>(key, { date: "", hit: [] });
    const hit = state.date === todayKeyAU() ? state.hit : [];
    const pct = (calls / g) * 100;
    for (const m of [25, 50, 75, 100]) {
      if (pct >= m && !hit.includes(m)) {
        hit.push(m);
        lsSet(key, { date: todayKeyAU(), hit });
        if (m === 100) {
          play("mega"); haptic(200);
          burst({ xFrac: 0.5, yFrac: 0.6, count: 260, power: 1.6 });
          burst({ xFrac: 0.2, yFrac: 0.4, count: 120, power: 1.2 });
          burst({ xFrac: 0.8, yFrac: 0.4, count: 120, power: 1.2 });
          setCelebration({ title: `${g} CALLS. GOAL SMASHED.`, line: "Volume solves what talent cannot — and you just proved it." });
        } else {
          play("fanfare"); haptic(60);
          burst({ xFrac: 0.5, yFrac: 0.5, count: 90 + m });
          setFlash(m === 25 ? "Quarter down. Momentum is real." : m === 50 ? "HALFWAY. Keep the streak." : "75%. Finish the set.");
          setTimeout(() => setFlash(null), 2200);
        }
        return;
      }
    }
  }, [burst, play]);

  /* ── Log a dial ─────────────────────────────────────────────────────────── */
  const logDial = useCallback(async (result: DialResult, xFrac: number) => {
    if (busy) return;
    play("click"); haptic(12);
    burst({ xFrac, yFrac: 0.45, count: 14, power: 0.5 });

    // Optimistic bump
    const prev = statsRef.current;
    const next = {
      ...prev,
      calls: prev.calls + 1, weekCalls: prev.weekCalls + 1,
      dialed:    prev.dialed    + (result === "dialed"    ? 1 : 0),
      voicemail: prev.voicemail + (result === "voicemail" ? 1 : 0),
      noAnswer:  prev.noAnswer  + (result === "no_answer" ? 1 : 0),
    };
    setStats(next);
    checkMilestones(next.calls, goal);

    // Maybe pop a drill (only when no other modal is up)
    if (!quiz && !showBooked && Math.random() < QUIZ_CHANCE) {
      setQuiz(QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)]);
      setQuizPick(null);
    }

    try {
      const res = await fetch("/api/motivation/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const out = (await res.json()) as { stats?: MotivationStats; error?: string };
      if (res.ok && out.stats) setStats(out.stats);
      else { setStats(prev); setFlash(out.error ?? "Save failed — click not counted."); setTimeout(() => setFlash(null), 2500); }
    } catch {
      setStats(prev);
      setFlash("Offline? Click not counted."); setTimeout(() => setFlash(null), 2500);
    }
  }, [busy, burst, checkMilestones, goal, play, quiz, showBooked]);

  const undoDial = useCallback(async (result: DialResult) => {
    play("wrong");
    try {
      const res = await fetch("/api/motivation/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result, undo: true }),
      });
      const out = (await res.json()) as { stats?: MotivationStats };
      if (out.stats) setStats(out.stats);
    } catch { /* leave as-is */ }
  }, [play]);

  /* ── Keyboard shortcuts ─────────────────────────────────────────────────── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (quiz || showBooked || celebration) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "c") logDial("dialed", 0.5);
      else if (k === "v") logDial("voicemail", 0.25);
      else if (k === "n") logDial("no_answer", 0.75);
      else if (k === "b") setShowBooked(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logDial, quiz, showBooked, celebration]);

  /* ── Quiz answer ────────────────────────────────────────────────────────── */
  function answerQuiz(i: number) {
    if (!quiz || quizPick !== null) return;
    setQuizPick(i);
    const correct = i === quiz.right;
    const next = { right: drill.right + (correct ? 1 : 0), wrong: drill.wrong + (correct ? 0 : 1) };
    setDrill(next);
    lsSet("motivation.drill.v1", { date: todayKeyAU(), ...next });
    if (correct) { play("ding"); burst({ xFrac: 0.5, yFrac: 0.4, count: 40 }); }
    else play("wrong");
  }

  const pct = Math.min(100, Math.round((stats.calls / Math.max(1, goal)) * 100));
  const tierLine = TIER_LINES.find(([t]) => pct >= t)?.[1] ?? TIER_LINES[5][1];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[70]" />

      {/* ── Header: ring + stats ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-6 rounded-2xl border bg-card p-6 ring-1 ring-foreground/5 sm:flex-row">
        <ProgressRing pct={pct} calls={stats.calls} goal={goal} onGoalChange={(g) => { setGoal(g); lsSet("motivation.goal.v1", g); }} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-lg font-bold leading-snug">{tierLine}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dialling as <span className="font-semibold capitalize text-foreground">{actor}</span> · every click feeds the scoreboard
            {drill.right + drill.wrong > 0 && <> · drills {drill.right}/{drill.right + drill.wrong}</>}
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Tile label="Booked today" value={stats.booked} gold />
            <Tile label="Voicemails" value={stats.voicemail} />
            <Tile label="No answers" value={stats.noAnswer} />
            <Tile label="Week calls" value={stats.weekCalls} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => { const v = !soundOn; setSound(v); lsSet("motivation.sound.v1", v); }}
          className="self-start rounded-full border p-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          title={soundOn ? "Mute sounds" : "Unmute sounds"}
        >
          {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      </div>

      {flash && (
        <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-center text-sm font-bold text-primary animate-in fade-in zoom-in-95 duration-200">
          {flash}
        </div>
      )}

      {/* ── The buttons ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <BigButton
          className="col-span-2 bg-[linear-gradient(145deg,var(--brand),var(--brand-strong))] text-white shadow-[0_10px_32px_rgba(108,75,241,.35)]"
          icon={<Phone size={26} />}
          label="CALL MADE"
          sub="every dial counts"
          keyHint="C"
          count={stats.calls}
          onClick={() => logDial("dialed", 0.5)}
        />
        <BigButton
          className="border bg-card"
          icon={<Voicemail size={22} className="text-primary" />}
          label="Voicemail"
          sub="left one · counts as a dial"
          keyHint="V"
          count={stats.voicemail}
          onClick={() => logDial("voicemail", 0.25)}
        />
        <BigButton
          className="border bg-card"
          icon={<PhoneMissed size={22} className="text-primary" />}
          label="No answer"
          sub="rang out · counts as a dial"
          keyHint="N"
          count={stats.noAnswer}
          onClick={() => logDial("no_answer", 0.75)}
        />
        <BigButton
          className="col-span-2 bg-[linear-gradient(145deg,#f59e0b,#d97706)] text-white shadow-[0_10px_32px_rgba(245,158,11,.35)]"
          icon={<CalendarCheck2 size={26} />}
          label="SALES CALL BOOKED"
          sub="the money button — creates the lead in your pipeline"
          keyHint="B"
          count={stats.booked}
          onClick={() => { play("click"); setShowBooked(true); }}
        />
      </div>

      {/* ── Undo row ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        <RotateCcw size={12} />
        Misclick? Undo last:
        <button type="button" onClick={() => undoDial("dialed")}    className="rounded-full border px-2.5 py-1 font-medium transition-colors hover:bg-muted/40 hover:text-foreground">call</button>
        <button type="button" onClick={() => undoDial("voicemail")} className="rounded-full border px-2.5 py-1 font-medium transition-colors hover:bg-muted/40 hover:text-foreground">voicemail</button>
        <button type="button" onClick={() => undoDial("no_answer")} className="rounded-full border px-2.5 py-1 font-medium transition-colors hover:bg-muted/40 hover:text-foreground">no answer</button>
      </div>

      {/* ── Objection drill modal ────────────────────────────────────────── */}
      {quiz && (
        <Modal>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
            <Brain size={14} /> Pop drill — keep the brain hot
          </div>
          <p className="text-[15px] font-bold leading-snug">{quiz.prompt}</p>
          <div className="mt-4 space-y-2">
            {quiz.options.map((opt, i) => {
              const answered = quizPick !== null;
              const isRight = i === quiz.right;
              const isPick = i === quizPick;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => answerQuiz(i)}
                  disabled={answered}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13px] font-medium leading-snug transition-all",
                    !answered && "hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99]",
                    answered && isRight && "border-emerald-500 bg-emerald-500/10",
                    answered && isPick && !isRight && "border-destructive bg-destructive/10",
                    answered && !isPick && !isRight && "opacity-50",
                  )}
                >
                  {answered && isRight && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />}
                  {answered && isPick && !isRight && <XCircle size={16} className="mt-0.5 shrink-0 text-destructive" />}
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          {quizPick !== null && (
            <div className="mt-4 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <p className="rounded-xl bg-muted/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground/85">
                <span className={cn("font-bold", quizPick === quiz.right ? "text-emerald-500" : "text-destructive")}>
                  {quizPick === quiz.right ? "Correct. " : "Not quite. "}
                </span>
                {quiz.why}
              </p>
              <button
                type="button"
                onClick={() => setQuiz(null)}
                className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Back to dialling
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* ── Booked modal ─────────────────────────────────────────────────── */}
      {showBooked && (
        <BookedModal
          busy={busy}
          onClose={() => { if (!busy) setShowBooked(false); }}
          onSubmit={async (lead) => {
            setBusy(true);
            try {
              const res = await fetch("/api/motivation/booked", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(lead),
              });
              const out = (await res.json()) as { stats?: MotivationStats; error?: string };
              if (!res.ok || !out.stats) {
                setFlash(out.error ?? "Booking failed — try again."); setTimeout(() => setFlash(null), 3000);
                return;
              }
              setStats(out.stats);
              setShowBooked(false);
              play("mega"); haptic(300);
              burst({ xFrac: 0.5, yFrac: 0.55, count: 300, colors: GOLD_COLORS, power: 1.7 });
              burst({ xFrac: 0.15, yFrac: 0.35, count: 130, colors: GOLD_COLORS, power: 1.2 });
              burst({ xFrac: 0.85, yFrac: 0.35, count: 130, colors: GOLD_COLORS, power: 1.2 });
              setCelebration({
                title: "BOOKED. GET IN. 🏆",
                line: `${lead.business_name} is now in your pipeline at Call Booked. Calendar before proposal. Always.`,
                gold: true,
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {/* ── Full-screen celebration ──────────────────────────────────────── */}
      {celebration && (
        <div
          className="fixed inset-0 z-[65] grid place-items-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setCelebration(null)}
        >
          <div className="mx-4 max-w-lg text-center animate-in zoom-in-90 duration-300">
            <div className={cn(
              "text-4xl font-black tracking-tight sm:text-5xl",
              celebration.gold ? "text-amber-500" : "text-primary",
            )}>
              {celebration.title}
            </div>
            <p className="mt-4 text-base font-medium text-foreground/85">{celebration.line}</p>
            <button
              type="button"
              className="mt-8 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Back to the phones
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pieces
═══════════════════════════════════════════════════════════════════════════ */
function ProgressRing({
  pct, calls, goal, onGoalChange,
}: {
  pct: number; calls: number; goal: number; onGoalChange: (g: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const r = 64, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-40 w-40 shrink-0 place-items-center">
      <svg viewBox="0 0 160 160" className="absolute inset-0 -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" strokeWidth="11" className="stroke-muted" />
        <circle
          cx="80" cy="80" r={r} fill="none" strokeWidth="11" strokeLinecap="round"
          stroke={pct >= 100 ? "#f59e0b" : "var(--brand)"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1), stroke 300ms" }}
        />
      </svg>
      <div className="text-center">
        <div key={calls} className="text-4xl font-black tabular-nums tracking-tight animate-in zoom-in-75 duration-200">
          {calls}
        </div>
        {editing ? (
          <input
            autoFocus
            type="number"
            defaultValue={goal}
            min={1}
            onBlur={(e) => { onGoalChange(Math.max(1, parseInt(e.target.value) || goal)); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="mt-0.5 w-16 rounded border bg-background text-center text-xs outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            title="Tap to change the daily goal"
          >
            / {goal} goal
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <div className="rounded-xl border bg-background/40 px-2 py-2 text-center">
      <div key={value} className={cn(
        "text-xl font-black tabular-nums animate-in zoom-in-75 duration-200",
        gold && value > 0 && "text-amber-500",
      )}>
        {value}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function BigButton({
  className, icon, label, sub, keyHint, count, onClick,
}: {
  className?: string; icon: React.ReactNode; label: string; sub: string;
  keyHint: string; count: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center justify-between gap-4 rounded-2xl px-6 py-6 text-left ring-1 ring-foreground/5 transition-transform duration-100 hover:scale-[1.01] active:scale-[0.97]",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {icon}
        <div>
          <div className="text-base font-black tracking-tight">{label}</div>
          <div className="text-xs opacity-75">{sub}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div key={count} className="text-4xl font-black tabular-nums animate-in zoom-in-75 duration-200">
          {count}
        </div>
        <kbd className="hidden rounded-md border border-current/30 px-1.5 py-0.5 text-[10px] font-bold opacity-50 sm:block">
          {keyHint}
        </kbd>
      </div>
    </button>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl ring-1 ring-foreground/5 animate-in zoom-in-95 slide-in-from-bottom-2 duration-200">
        {children}
      </div>
    </div>
  );
}

function BookedModal({
  busy, onClose, onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (lead: { business_name: string; contact_name: string; phone: string; email: string; notes: string }) => void;
}) {
  const [lead, setLead] = useState({ business_name: "", contact_name: "", phone: "", email: "", notes: "" });
  const set = (k: keyof typeof lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setLead((s) => ({ ...s, [k]: e.target.value }));
  const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

  return (
    <Modal>
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-500">
          <CalendarCheck2 size={14} /> Lock the win
        </div>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40">
          <X size={15} />
        </button>
      </div>
      <p className="text-[15px] font-bold">Sales call booked — capture what you got</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Submits straight into the pipeline as a new lead at Call Booked.</p>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => { e.preventDefault(); if (lead.business_name.trim()) onSubmit(lead); }}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-foreground/80">Business name <span className="text-destructive">*</span></span>
          <input required autoFocus className={input} value={lead.business_name} onChange={set("business_name")} placeholder="Breeze Dental Helensvale" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground/80">Contact name</span>
            <input className={input} value={lead.contact_name} onChange={set("contact_name")} placeholder="Dr Sarah…" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground/80">Phone</span>
            <input className={input} value={lead.phone} onChange={set("phone")} placeholder="+61 …" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-foreground/80">Email</span>
          <input type="email" className={input} value={lead.email} onChange={set("email")} placeholder="front.desk@…" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-foreground/80">What you gathered <span className="font-normal text-muted-foreground">(booked time, pains, PMS, who attends)</span></span>
          <textarea className={cn(input, "min-h-20 resize-y")} value={lead.notes} onChange={set("notes")} placeholder="Thursday 2pm. Cliniko. Missing after-hours calls, front desk flat out…" />
        </label>
        <button
          type="submit"
          disabled={busy || !lead.business_name.trim()}
          className="w-full rounded-xl bg-[linear-gradient(145deg,#f59e0b,#d97706)] px-4 py-3 text-sm font-black text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {busy
            ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Creating the lead…</span>
            : "LOCK IT IN → PIPELINE"}
        </button>
      </form>
    </Modal>
  );
}
