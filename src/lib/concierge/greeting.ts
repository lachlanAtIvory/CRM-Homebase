/**
 * Builds a time + weather-aware greeting and starter chips for the
 * concierge landing experience. Generated server-side per request so
 * each guest sees something fresh — never the same greeting twice.
 */

type TimeOfDay = "morning" | "midday" | "afternoon" | "evening" | "late";
type WeatherMood = "sunny" | "rainy" | "cool" | "warm" | "neutral";

export type SmartGreeting = {
  greeting: string;    // first thing the guest sees + Maya speaks
  starters: string[];  // pre-canned chip prompts shown before first message
  timeOfDay: TimeOfDay;
  weatherMood: WeatherMood;
};

export function buildSmartGreeting(opts: {
  hotelName: string;
  timezone:  string;
  weather:   string | null;
}): SmartGreeting {
  const { hotelName, timezone, weather } = opts;
  const timeOfDay   = getTimeOfDay(timezone);
  const weatherMood = getWeatherMood(weather);
  const temp        = extractTemp(weather);

  const greeting = composeGreeting({ hotelName, timeOfDay, weatherMood, temp });
  const starters = composeStarters({ timeOfDay, weatherMood });

  return { greeting, starters, timeOfDay, weatherMood };
}

// ─── Compose ────────────────────────────────────────────────────────────

function composeGreeting(opts: {
  hotelName:   string;
  timeOfDay:   TimeOfDay;
  weatherMood: WeatherMood;
  temp:        number | null;
}): string {
  const { hotelName, timeOfDay, weatherMood, temp } = opts;
  const greet = greetingByTime(timeOfDay);
  const tempBit = temp !== null ? ` It's ${temp}°C` : "";
  const weatherBit = weatherDescriptor(weatherMood, timeOfDay);

  // Pick a CTA based on time of day — varies what they can ask
  const ctaByTime: Record<TimeOfDay, string> = {
    morning:   "Looking for somewhere good for breakfast or a plan for the day?",
    midday:    "What can I help you with — lunch spots, things to do nearby?",
    afternoon: "Anything you need — coffee, an activity, dinner plans for later?",
    evening:   "Keen for dinner ideas, a drink somewhere good, or info about the hotel?",
    late:      "Need somewhere still open, the WiFi password, or info about your stay?",
  };

  return [
    `${greet}! I'm Ivory, your concierge at ${hotelName}.`,
    weatherBit ? `${weatherBit}${tempBit}.` : "",
    ctaByTime[timeOfDay],
  ].filter(Boolean).join(" ");
}

function composeStarters(opts: {
  timeOfDay:   TimeOfDay;
  weatherMood: WeatherMood;
}): string[] {
  const { timeOfDay, weatherMood } = opts;

  // Universal staples
  const universal = ["What's the WiFi password?", "What time is checkout?"];

  // Time-of-day specific
  const byTime: Record<TimeOfDay, string[]> = {
    morning:   ["Best brunch nearby", "Great coffee close by", "What's worth doing today?"],
    midday:    ["Where's good for lunch?", "A quick activity nearby", "Best view in town"],
    afternoon: ["Afternoon coffee spot", "Sightseeing within walking distance", "Where for sunset?"],
    evening:   ["Where should I eat tonight?", "Best rooftop bar nearby", "Late dinner option"],
    late:      ["What's still open right now?", "Late-night food nearby", "Quiet drink somewhere?"],
  };

  // Weather-specific add-ins
  let weatherStarter: string | null = null;
  if (weatherMood === "rainy") {
    weatherStarter = "Any good indoor things to do?";
  } else if (weatherMood === "sunny" && (timeOfDay === "morning" || timeOfDay === "midday")) {
    weatherStarter = "Best outdoor activity right now?";
  }

  // Build final list: time-relevant + weather + universal staples, trimmed to 5
  const all = [
    ...(byTime[timeOfDay] ?? []),
    ...(weatherStarter ? [weatherStarter] : []),
    ...universal,
  ];
  return all.slice(0, 5);
}

// ─── Time-of-day helpers ────────────────────────────────────────────────

function getTimeOfDay(timezone: string): TimeOfDay {
  const hourStr = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour:     "numeric",
    hour12:   false,
  }).format(new Date());
  const hour = parseInt(hourStr.replace(/\D+/g, ""), 10);
  if (Number.isNaN(hour))    return "midday";
  if (hour >= 5  && hour < 11)  return "morning";
  if (hour >= 11 && hour < 14)  return "midday";
  if (hour >= 14 && hour < 17)  return "afternoon";
  if (hour >= 17 && hour < 21)  return "evening";
  return "late";
}

function greetingByTime(t: TimeOfDay): string {
  switch (t) {
    case "morning":   return "Good morning";
    case "midday":    return "Hey there";
    case "afternoon": return "Good afternoon";
    case "evening":   return "Good evening";
    case "late":      return "Hey, welcome";
  }
}

// ─── Weather helpers ────────────────────────────────────────────────────

function getWeatherMood(weather: string | null): WeatherMood {
  if (!weather) return "neutral";
  const w = weather.toLowerCase();
  if (/rain|shower|drizzle|thunder/.test(w))  return "rainy";
  if (/clear|sunny|fair/.test(w))             return "sunny";
  if (/snow/.test(w))                          return "cool";
  // Try to infer warm vs cool from extracted temp
  const temp = extractTemp(weather);
  if (temp !== null && temp >= 25) return "warm";
  if (temp !== null && temp <= 12) return "cool";
  return "neutral";
}

function weatherDescriptor(mood: WeatherMood, time: TimeOfDay): string {
  switch (mood) {
    case "sunny":
      return time === "morning"   ? "Beautiful day out there"
           : time === "evening"   ? "Lovely clear evening"
                                  : "Lovely day out";
    case "rainy":
      return "A bit drizzly out at the moment";
    case "warm":
      return time === "evening" ? "Warm evening" : "Warm out today";
    case "cool":
      return "Crisp out today";
    case "neutral":
      return "";
  }
}

function extractTemp(weather: string | null): number | null {
  if (!weather) return null;
  // weather text looks like: "Now: 22°C, partly cloudy. Today: 17–24°C ..."
  const match = weather.match(/(-?\d+)\s*°/);
  return match ? parseInt(match[1], 10) : null;
}
