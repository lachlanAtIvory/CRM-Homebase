import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Google Places nearby search for Concierge.
 *
 * Takes a query (e.g. "Italian restaurants", "coffee near me") and hotel location,
 * returns a list of nearby places from Google Places API.
 *
 * Public endpoint, no auth required. Rate-limited by API quota.
 */
export const runtime = "edge";

type PlaceResult = {
  name: string;
  type: string;
  distance: string;
  rating?: number;
  address?: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    const hotelSlug = searchParams.get("slug");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (!query || !hotelSlug || !lat || !lng) {
      return new Response("Missing required parameters: q, slug, lat, lng", {
        status: 400,
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return new Response("Invalid latitude/longitude", { status: 400 });
    }

    // Get API key from environment
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return new Response("Google Maps API key not configured", { status: 500 });
    }

    // Call Google Places Nearby Search API
    // This searches within 2000m radius (radius param in meters)
    const placesUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    );
    placesUrl.searchParams.set("location", `${latitude},${longitude}`);
    placesUrl.searchParams.set("radius", "2000"); // 2km radius
    placesUrl.searchParams.set("keyword", query);
    placesUrl.searchParams.set("key", apiKey);

    const placesRes = await fetch(placesUrl.toString());
    const placesData = (await placesRes.json()) as {
      results?: Array<{
        name: string;
        types: string[];
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        vicinity?: string;
      }>;
      status: string;
    };

    if (placesData.status !== "OK" && placesData.status !== "ZERO_RESULTS") {
      console.error("Google Places API error:", placesData.status);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Transform results: distance, type, name, rating
    const results: PlaceResult[] = (placesData.results || [])
      .slice(0, 5) // Top 5 results
      .map((place) => {
        // Calculate distance from hotel
        const dx = place.geometry.location.lng - longitude;
        const dy = place.geometry.location.lat - latitude;
        const distKm = Math.sqrt(dx * dx + dy * dy) * 111; // rough conversion
        const distStr =
          distKm < 0.1 ? "< 100m" : `${distKm.toFixed(1)}km`;

        // Extract category from types (e.g. "restaurant", "cafe", "museum")
        const category =
          place.types
            ?.find((t) => !t.startsWith("point_of_interest"))
            ?.replace(/_/g, " ") || "place";

        return {
          name: place.name,
          type: category,
          distance: distStr,
          rating: place.rating,
          address: place.vicinity,
        };
      });

    return new Response(JSON.stringify({ results }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Places API error:", error);
    return new Response(JSON.stringify({ error: "Search failed", results: [] }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
