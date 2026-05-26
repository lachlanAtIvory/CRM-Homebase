import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

/**
 * Printable QR-code card for a hotel. URL: /concierge/{slug}/qr
 *
 * Looks like an in-room display card — print to A5 or A6 and stick it on
 * the bedside table or behind the bathroom door.
 */
export default async function ConciergeQrPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: hotel } = await supabase
    .from("concierge_hotels")
    .select("slug, name, brand_color, tagline")
    .eq("slug", slug)
    .single();

  if (!hotel) notFound();

  // Build the URL guests will land on after scanning
  const h    = await headers();
  const host = h.get("host") ?? "crm-homebase.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const targetUrl = `${proto}://${host}/concierge/${hotel.slug}`;

  // Generate the QR as a data URI server-side (no client-side dep)
  const qrDataUri = await QRCode.toDataURL(targetUrl, {
    margin: 1,
    width:  640,
    color: { dark: "#111827", light: "#ffffff" },
  });

  const brand = (hotel.brand_color as string) || "#6c4bf1";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-6 print:bg-white print:p-0">
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border bg-white shadow-xl print:border-none print:shadow-none"
        style={{ borderTop: `8px solid ${brand}` }}
      >
        <div className="p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500">In-room AI Concierge</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{hotel.name as string}</h1>
          {hotel.tagline && (
            <p className="mt-1 text-xs text-gray-500">{hotel.tagline as string}</p>
          )}

          <div className="my-7 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUri} alt="QR code" className="h-56 w-56 rounded-lg" />
          </div>

          <p className="text-base font-semibold text-gray-900">📱 Scan to chat</p>
          <p className="mt-1 text-xs text-gray-500">
            Ask anything — checkout time, restaurants, the gym, the area.
            <br />
            Powered by <span className="font-semibold" style={{ color: brand }}>Agent Ivory</span>.
          </p>

          <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[10px] font-mono text-gray-600">
            {targetUrl.replace(/^https?:\/\//, "")}
          </div>
        </div>

        <div
          className="px-8 py-3 text-center text-[10px] text-white"
          style={{ background: brand }}
        >
          Available 24/7 · Voice or type · Speaks your language
        </div>
      </div>

      {/* Hide the surrounding page chrome when printing */}
      <style>{`
        @media print {
          body { background: white !important; }
          @page  { margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
