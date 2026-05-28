/**
 * Builds the system prompt for Ivory Concierge.
 *
 * The model is locked to ONLY answer from the supplied hotel facts and local
 * recommendations. That makes it impossible (well, very hard) for the model
 * to hallucinate restaurant hours or invent a WiFi password.
 *
 * Current time is injected so "is the gym still open?" / "what's open now?"
 * questions work without external tool calls.
 */

export type Hotel = {
  name:     string;
  address:  string | null;
  timezone: string;
  greeting: string | null;
};

export type Fact = {
  category: string | null;
  question: string | null;
  answer:   string;
};

export type LocalRec = {
  name:        string;
  category:    string | null;
  distance:    string | null;
  hours:       string | null;
  description: string | null;
  tags:        string[];
};

export function buildSystemPrompt(opts: {
  hotel:   Hotel;
  facts:   Fact[];
  local:   LocalRec[];
  weather?: string | null;
}): string {
  const { hotel, facts, local, weather } = opts;

  // Current local time in the hotel's timezone — drives "what's open now"
  const now = new Date();
  const nowLabel = now.toLocaleString("en-AU", {
    timeZone:    hotel.timezone || "Australia/Sydney",
    weekday:     "long",
    day:         "numeric",
    month:       "long",
    hour:        "2-digit",
    minute:      "2-digit",
    hour12:      true,
  });

  const factsBlock = facts.map((f) =>
    `- ${f.category ? `[${f.category}] ` : ""}${f.question ? `Q: ${f.question}\n  A: ` : ""}${f.answer}`,
  ).join("\n");

  // Filter out closed places — only include open or hours-unknown recommendations
  const openNow = local.filter((r) => isOpenNow(r.hours, now, hotel.timezone));

  const localBlock = openNow.map((r) => {
    const bits = [
      r.category && `(${r.category})`,
      r.distance,
      r.hours,
    ].filter(Boolean).join(" · ");
    return `- ${r.name}${bits ? ` — ${bits}` : ""}${r.description ? `\n  "${r.description}"` : ""}${r.tags.length > 0 ? `\n  tags: ${r.tags.join(", ")}` : ""}`;
  }).join("\n");

  return `You are Ivory, the AI concierge for ${hotel.name}${hotel.address ? ` (${hotel.address})` : ""}.

Right now it is: ${nowLabel} (${hotel.timezone || "Australia/Sydney"})
${weather ? `Local weather — ${weather}\n` : ""}
## How to respond
- Be warm, conversational and concise. Aim for 2-4 sentences unless the guest asks for more detail.
- Sound Australian (the hotel is in Sydney) — but not over-the-top. Avoid "G'day mate" parodies.
- Always answer in the guest's language — if they message in another language, reply in that language.
- **CRITICAL: NEVER use markdown formatting.** No asterisks (**bold** or *italic*), no underscores, no backticks, no headings, no code blocks, no tables. Your responses are spoken aloud and these characters break the voice. Plain natural prose only. If you want to emphasise something, do it with word choice or order, not formatting.
- Short bullet lists with "- " are OK only when listing 3+ items; otherwise prose.
- Never invent information. If something isn't in the facts below, say so honestly and suggest they ring reception (press 0 from their room phone).
- When recommending something nearby, ALWAYS mention the walking time + whether it's open now (compare hours to current time above).
- If the guest asks for "the best" or "your favourite", pick ONE from the recommendations and back it with the editorial blurb provided. Don't list everything.
- For sensitive requests (medical, emergency, fire), direct them to dial 000 immediately and then call reception.

## Hotel facts
${factsBlock}

## Nearby recommendations (within walking distance)
${localBlock}

## Things you DON'T know
- You don't have access to the guest's booking details, room number, or charge account. If they ask, direct them to reception.
- You can't make bookings or place orders — direct them to reception to action anything.
- You don't have live traffic data. Give general advice for transit timing.${weather ? "\n- You DO have the current local weather + 2-day forecast above; use it when relevant (e.g. \"is it warm enough for the rooftop?\", \"should I take an umbrella?\", \"any indoor activities if it rains?\")." : ""}

Stay helpful. If you don't know, say so.`;
}

/**
 * Check if a place is open right now based on its hours string.
 * Supports formats like "10am-7pm", "9am-5:30pm", "24 hours", or "Closed".
 * If hours can't be parsed, assume it's open (to avoid filtering out unknowns).
 */
function isOpenNow(hoursStr: string | null, now: Date, timezone: string): boolean {
  if (!hoursStr) return true; // No hours data — assume open
  if (/closed|never open|by appointment/i.test(hoursStr)) return false;
  if (/24\s*(?:hours|hr)/i.test(hoursStr)) return true;

  // Get current hour in the hotel's timezone
  const timeStr = now.toLocaleString("en-AU", {
    timeZone:   timezone,
    hour:       "2-digit",
    minute:     "2-digit",
    hour12:     false,
  });
  const [hourStr, minStr] = timeStr.split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const nowMin = hour * 60 + min;

  // Parse "10am-7pm" or "10:30am-7:30pm" style hours
  const match = hoursStr.match(
    /(\d{1,2}):?(\d{0,2})\s*(am|pm)?[\s\-–]+(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i
  );
  if (!match) return true; // Can't parse — assume open

  const [, openH, openM = "0", openAMPM, closeH, closeM = "0", closeAMPM] = match;
  let openHour = parseInt(openH, 10);
  let closeHour = parseInt(closeH, 10);
  const openMin = parseInt(openM, 10);
  const closeMin = parseInt(closeM, 10);

  // Convert to 24-hour time
  if (openAMPM?.toLowerCase() === "pm" && openHour !== 12) openHour += 12;
  if (openAMPM?.toLowerCase() === "am" && openHour === 12) openHour = 0;
  if (closeAMPM?.toLowerCase() === "pm" && closeHour !== 12) closeHour += 12;
  if (closeAMPM?.toLowerCase() === "am" && closeHour === 12) closeHour = 0;

  const openMin24 = openHour * 60 + openMin;
  const closeMin24 = closeHour * 60 + closeMin;

  // Handle overnight hours (e.g., 11pm-2am next day)
  if (openMin24 > closeMin24) {
    return nowMin >= openMin24 || nowMin < closeMin24;
  }

  return nowMin >= openMin24 && nowMin < closeMin24;
}
