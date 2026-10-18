import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorFromEmail, fetchMotivationStats } from "@/lib/hq/motivation-stats";
import { bookSalesCall } from "@/lib/hq/book-sales-call";
import { adminClient } from "@/lib/hq/supabase-admin";

/**
 * Motivation dashboard — book a sales call.
 *
 * Creates the lead for real: a clients row + a deals row at the pipeline's
 * "call_booked" stage, a REAL event on the shared Ivory Google Calendar, and
 * a prospect_events "demo" row so the booking counts on the dashboard and
 * scoreboard. The work happens in bookSalesCall (src/lib/hq/book-sales-call.ts),
 * shared with the Call List. Returns fresh stats + the new client id.
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
    when?:          string;   // ISO — the locked sales-call time
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
  const when = new Date(body.when ?? "");
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "when must be a valid date/time — no booking without a locked time" }, { status: 400 });
  }

  // The route has already checked this person has the Motivation section; the
  // server's own client does the writes (clients, deals, calendar) on their behalf.
  const booking = await bookSalesCall(
    adminClient(),
    { actor, userEmail: user.email ?? null },
    {
      businessName,
      contactName: body.contact_name,
      phone:       body.phone,
      email:       body.email,
      notes:       body.notes,
      when,
    },
  );
  if (!booking.ok) {
    return NextResponse.json({ error: booking.error }, { status: booking.status });
  }

  const stats = await fetchMotivationStats(supabase, actor);
  return NextResponse.json({ ok: true, clientId: booking.clientId, stats });
}
