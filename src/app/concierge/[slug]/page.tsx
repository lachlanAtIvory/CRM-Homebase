import { notFound } from "next/navigation";
import type { Viewport } from "next";
import { createClient } from "@supabase/supabase-js";
import { ConciergeChat } from "./chat-ui";

// iOS Safari zooms when focusing an input <16px. Pin scale + cover the
// notch so the chat fills the screen properly on phones.
export const viewport: Viewport = {
  width:        "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit:  "cover",
  themeColor:   "#6c4bf1",
};

/**
 * Public guest-facing concierge page. No auth — anyone with the QR can scan.
 * Server component loads hotel + a few quick-tap prompts to seed the UI.
 */
export default async function ConciergePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Use the public anon client — RLS allows SELECT on these tables for anon.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: hotel } = await supabase
    .from("concierge_hotels")
    .select("id, slug, name, tagline, brand_color, logo_url, greeting, is_active")
    .eq("slug", slug)
    .single();

  if (!hotel || !hotel.is_active) notFound();

  // Pull local recs so the chat UI can show category quick-tap chips
  const { data: local } = await supabase
    .from("concierge_local")
    .select("name, category, distance, hours, description, tags")
    .eq("hotel_id", hotel.id as string)
    .order("sort_order", { ascending: true });

  const recs = (local ?? []).map((r) => ({
    name:        r.name as string,
    category:    (r.category as string | null) ?? null,
    distance:    (r.distance as string | null) ?? null,
    hours:       (r.hours as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    tags:        Array.isArray(r.tags) ? (r.tags as string[]) : [],
  }));

  return (
    <ConciergeChat
      hotelSlug={hotel.slug as string}
      hotelName={hotel.name as string}
      tagline={(hotel.tagline as string | null) ?? null}
      brandColor={(hotel.brand_color as string) || "#6c4bf1"}
      logoUrl={(hotel.logo_url as string | null) ?? null}
      greeting={(hotel.greeting as string | null) ?? "Hi! I'm Ivory. Ask me anything about the hotel or the area."}
      localRecs={recs}
    />
  );
}

// No global CRM layout for this route — page handles its own chrome
export const dynamic = "force-dynamic";
