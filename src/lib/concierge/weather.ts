/**
 * Fetches a compact weather snapshot for the hotel's location from
 * Open-Meteo (free, no API key, no rate limit for our volumes).
 *
 * Returns a short human-readable string that gets injected into the
 * concierge system prompt — so "is it warm enough for the rooftop?" /
 * "what's the weather tomorrow?" actually work.
 *
 * Fails silently if the fetch errors — bot just won't have weather context.
 */

const WMO_CODES: Record<number, string> = {
  0:  "clear sky",
  1:  "mainly clear",
  2:  "partly cloudy",
  3:  "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light showers",
  81: "showers",
  82: "violent showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "severe thunderstorm",
};

export async function fetchWeatherBlurb(
  lat: number,
  lng: number,
  timezone: string,
): Promise<string | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",  lat.toString());
    url.searchParams.set("longitude", lng.toString());
    url.searchParams.set("current",   "temperature_2m,weather_code,precipitation,wind_speed_10m");
    url.searchParams.set("daily",     "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code");
    url.searchParams.set("timezone",  timezone || "Australia/Sydney");
    url.searchParams.set("forecast_days", "2");

    const res = await fetch(url.toString(), {
      // Edge runtime — cache for 10 min so we don't hammer Open-Meteo on
      // every guest message
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      current?: { temperature_2m?: number; weather_code?: number; precipitation?: number; wind_speed_10m?: number };
      daily?:   {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?:  number[];
        weather_code?:       number[];
      };
    };

    const cur     = data.current;
    const day0    = pickDay(data.daily, 0);
    const day1    = pickDay(data.daily, 1);

    const lines: string[] = [];
    if (cur && cur.temperature_2m !== undefined) {
      const cond = cur.weather_code !== undefined ? WMO_CODES[cur.weather_code] ?? "unsettled" : "clear";
      lines.push(`Now: ${Math.round(cur.temperature_2m)}°C, ${cond}${cur.precipitation && cur.precipitation > 0 ? `, ${cur.precipitation}mm rain` : ""}.`);
    }
    if (day0) {
      lines.push(`Today: ${day0.min}°C – ${day0.max}°C, ${day0.cond}${day0.rain > 0 ? ` (${day0.rain}mm rain expected)` : ""}.`);
    }
    if (day1) {
      lines.push(`Tomorrow: ${day1.min}°C – ${day1.max}°C, ${day1.cond}${day1.rain > 0 ? ` (${day1.rain}mm rain expected)` : ""}.`);
    }
    return lines.join(" ");
  } catch {
    return null;
  }
}

function pickDay(daily: {
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?:  number[];
  weather_code?:       number[];
} | undefined, i: number): { min: number; max: number; rain: number; cond: string } | null {
  if (!daily) return null;
  const min  = daily.temperature_2m_min?.[i];
  const max  = daily.temperature_2m_max?.[i];
  const rain = daily.precipitation_sum?.[i] ?? 0;
  const code = daily.weather_code?.[i];
  if (min === undefined || max === undefined) return null;
  return {
    min:  Math.round(min),
    max:  Math.round(max),
    rain: Math.round(rain * 10) / 10,
    cond: code !== undefined ? (WMO_CODES[code] ?? "unsettled") : "—",
  };
}
