import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorFromEmail, fetchMotivationStats } from "@/lib/hq/motivation-stats";

/**
 * Motivation dashboard — book a sales call.
 *
 * Creates the lead for real: a clients row + a deals row at the pipeline's
 * "call_booked" stage (exactly how the app creates deals elsewhere), plus a
 * prospect_events "demo" row so the booking counts on the dashboard and the
 * future scoreboard. Returns fresh stats + the new client id.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = actorFromEmail(user.email);

  let body: {
    business_name?: string;
    contact_name?:  string;
    phone?:         string;
    email?:         string;
    notes?:         string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const businessName = (body.business_name ?? "").trim();
  if (!businessName) {
    return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  }

  // 1. The client record (reuse an existing one on email match — same
  //    dedupe rule the application form uses)
  let clientId: string | null = null;
  const email = (body.email ?? "").trim() || null;
  if (email) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing?.id) clientId = existing.id as string;
  }
  if (!clientId) {
    const { data: created, error } = await supabase
      .from("clients")
      .insert({
        company_name: businessName,
        contact_name: (body.contact_name ?? "").trim() || null,
        phone:        (body.phone ?? "").trim() || null,
        email,
        notes:        (body.notes ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Failed to create client" }, { status: 500 });
    }
    clientId = created.id as string;
  }

  // 2. The pipeline deal — lands in the "Call booked" column
  const { error: dealError } = await supabase
    .from("deals")
    .insert({ client_id: clientId, current_stage: "call_booked" });
  if (dealError) {
    return NextResponse.json({ error: dealError.message }, { status: 500 });
  }

  // 3. The activity event — today's booked count + future scoreboard
  await supabase.from("prospect_events").insert({
    type:   "demo",
    actor,
    detail: {
      source:        "motivation",
      business_name: businessName,
      contact_name:  body.contact_name || null,
      phone:         body.phone || null,
      email,
      notes:         body.notes || null,
      client_id:     clientId,
    },
  });

  const stats = await fetchMotivationStats(supabase, actor);
  return NextResponse.json({ ok: true, clientId, stats });
}
