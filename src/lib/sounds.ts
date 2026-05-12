/**
 * Tiny sound effects synthesised via Web Audio API.
 *
 * Why generated, not files: no asset hosting needed, no network round-trip,
 * works offline, very small bytecost. Also makes it trivial to tweak.
 *
 * IMPORTANT: browser autoplay policy requires a user gesture before audio
 * can be unlocked. Call `unlockAudio()` inside a click/keypress handler at
 * least once before scheduled sounds (e.g. reminder dings) will play.
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Call from any user click to "unlock" audio for the session. Safe to call repeatedly. */
export function unlockAudio() {
  ctx();
}

/**
 * Two-note rising chime (C5 → G5). Plays when a task completes.
 * Sounds like a satisfying little "ding-dong" up.
 */
export function playSuccessChime() {
  const c = ctx();
  if (!c) return;

  const notes = [523.25, 783.99]; // C5, G5
  for (let i = 0; i < notes.length; i++) {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = notes[i];
    osc.connect(gain).connect(c.destination);

    const start = c.currentTime + i * 0.09;
    osc.start(start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
    osc.stop(start + 0.4);
  }
}

/**
 * Single bright ding (A5). Plays 10 min before a task is due.
 * Slightly more attention-grabbing than the success chime.
 */
export function playReminderDing() {
  const c = ctx();
  if (!c) return;

  // Two-tone "bell" — A5 then E5 for a gentle but noticeable alert
  const notes = [880, 659.25];
  for (let i = 0; i < notes.length; i++) {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = notes[i];
    osc.connect(gain).connect(c.destination);

    const start = c.currentTime + i * 0.15;
    osc.start(start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    osc.stop(start + 0.6);
  }
}
