import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ConciergeChat } from "./chat-ui";

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
    .select("slug, name, tagline, brand_color, logo_url, greeting, is_active")
    .eq("slug", slug)
    .single();

  if (!hotel || !hotel.is_active) notFound();

  return (
    <ConciergeChat
      hotelSlug={hotel.slug as string}
      hotelName={hotel.name as string}
      tagline={(hotel.tagline as string | null) ?? null}
      brandColor={(hotel.brand_color as string) || "#6c4bf1"}
      logoUrl={(hotel.logo_url as string | null) ?? null}
      greeting={(hotel.greeting as string | null) ?? "Hi! I'm Ivory. Ask me anything about the hotel or the area."}
    />
  );
}

// No global CRM layout for this route — page handles its own chrome
export const dynamic = "force-dynamic";
