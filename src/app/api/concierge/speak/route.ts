import { NextRequest } from "next/server";

/**
 * Ivory Concierge TTS endpoint — proxies ElevenLabs.
 *
 * Why proxy instead of calling ElevenLabs directly from the browser:
 *   - ElevenLabs API key never touches the client
 *   - Lets us swap providers (ElevenLabs → Cartesia → Retell etc) without
 *     touching the chat UI
 *   - Single place to enforce rate limits / abuse controls later
 *
 * Edge runtime keeps TTFB low so the audio starts playing fast.
 */
export const runtime = "edge";

const ELEVEN_MODEL = "eleven_turbo_v2_5"; // best latency+quality tradeoff

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId: voiceIdOverride } = (await req.json()) as {
      text?:    string;
      voiceId?: string;
    };

    if (!text || !text.trim()) {
      return new Response("Missing text", { status: 400 });
    }

    const apiKey  = process.env.ELEVENLABS_API_KEY;
    const voiceId = voiceIdOverride || process.env.IVORY_VOICE_ID;

    if (!apiKey || !voiceId) {
      return new Response("TTS not configured on server", { status: 503 });
    }

    // Strip markdown BEFORE sending to ElevenLabs. Stray `**` / `_` etc
    // trip the multilingual model's language detection — it sometimes
    // switches mid-sentence to Chinese (or other languages) when it sees
    // unfamiliar tokens. Plain text avoids the whole class of bug.
    const cleaned = stripMarkdown(text);

    // Cap reply length so a runaway reply doesn't burn $5 of TTS quota
    const truncated = cleaned.length > 2000 ? cleaned.slice(0, 2000) : cleaned;

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method:  "POST",
        headers: {
          "xi-api-key":  apiKey,
          "Content-Type": "application/json",
          "Accept":      "audio/mpeg",
        },
        body: JSON.stringify({
          text:        truncated,
          model_id:    ELEVEN_MODEL,
          voice_settings: {
            stability:        0.5,
            similarity_boost: 0.75,
            style:            0.0,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!elevenRes.ok) {
      const errorBody = await elevenRes.text().catch(() => "");
      console.error("ElevenLabs error:", elevenRes.status, errorBody);
      return new Response("TTS provider error", { status: 502 });
    }

    // Pass the audio stream straight through to the browser
    return new Response(elevenRes.body, {
      status:  200,
      headers: {
        "Content-Type":   "audio/mpeg",
        "Cache-Control":  "no-store",
      },
    });
  } catch (e) {
    console.error("/api/concierge/speak failed:", e);
    return new Response("Server error", { status: 500 });
  }
}

/**
 * Strip common markdown syntax so the TTS gets clean spoken prose.
 * Specifically targets the things ElevenLabs' multilingual model trips
 * on — asterisks, underscores, backticks, link syntax, headings, bullets.
 */
function stripMarkdown(input: string): string {
  return input
    // links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // images ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // inline code `text` → text
    .replace(/`([^`]+)`/g, "$1")
    // code fences ```...``` → blank (rare in our context but safe)
    .replace(/```[\s\S]*?```/g, " ")
    // bold/italic combos: ***text*** ** *text* * _text_ __text__
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // strikethrough ~~text~~ → text
    .replace(/~~([^~]+)~~/g, "$1")
    // headings (# Foo) at line start → Foo
    .replace(/^#{1,6}\s+/gm, "")
    // bullet markers at line start
    .replace(/^\s*[-*+]\s+/gm, "")
    // numbered lists at line start ("1. ")
    .replace(/^\s*\d+\.\s+/gm, "")
    // blockquote markers
    .replace(/^\s*>\s?/gm, "")
    // collapse triple+ newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
