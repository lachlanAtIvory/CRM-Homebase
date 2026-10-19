import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { safeRecordingUrl } from "@/lib/hq/justcall";

/**
 * Play a call's recording through the CRM (people with the Call List only).
 *
 * With JUSTCALL_API_KEY + JUSTCALL_API_SECRET set, the audio is fetched from
 * JustCall's API on the server, so the link never expires and the keys never
 * reach the browser. Without them we fall back to the link JustCall sent, which
 * is only followed if it's on JustCall's own domain.
 */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAccessApi("call-list");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: call } = await supabase
    .from("call_activity")
    .select("provider_call_id, recording_url")
    .eq("id", id)
    .maybeSingle();
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = process.env.JUSTCALL_API_KEY, secret = process.env.JUSTCALL_API_SECRET;
  if (key && secret && /^[\w-]+$/.test(String(call.provider_call_id))) {
    try {
      const res = await fetch(`https://api.justcall.io/v2.1/calls/${call.provider_call_id}/recording/download`, {
        headers: { Authorization: `${key}:${secret}`, Accept: "audio/mpeg, audio/*" },
        cache: "no-store",
      });
      if (res.ok && res.body) {
        return new NextResponse(res.body, {
          status: 200,
          headers: {
            "Content-Type": res.headers.get("content-type") ?? "audio/mpeg",
            "Cache-Control": "private, no-store",
            ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
          },
        });
      }
    } catch { /* fall through to the stored link */ }
  }

  const stored = safeRecordingUrl(call.recording_url);
  if (stored) return NextResponse.redirect(stored, 307);
  return NextResponse.json({ error: "The recording isn't available yet. Try again in a minute." }, { status: 404 });
}
