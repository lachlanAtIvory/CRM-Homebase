import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/hq/supabase-admin";
import { handleWebhook } from "@/lib/hq/dialsheet-events";

/**
 * DialSheet webhook receiver.
 *
 * Add this URL in DialSheet: Settings > Webhooks (Pro plan). It must be added from the account of the
 * person making the calls, because a webhook only sends that person's calls. Public (DialSheet isn't
 * signed in), but every request is verified against the webhook's signing secret
 * (DIALSHEET_WEBHOOK_SECRET) before anything is read. See src/lib/hq/dialsheet-events.ts for the rules.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();          // the signature covers these exact bytes: don't re-serialise
  const result = await handleWebhook(adminClient(), {
    rawBody,
    signature: req.headers.get("x-dialsheet-signature"),
    secret: process.env.DIALSHEET_WEBHOOK_SECRET,
  });
  return NextResponse.json(result.json, { status: result.status });
}
