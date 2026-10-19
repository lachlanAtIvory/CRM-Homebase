import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/hq/supabase-admin";
import { handleWebhook } from "@/lib/hq/justcall-events";

/**
 * JustCall webhook receiver.
 *
 * Add this URL in JustCall: profile icon > APIs and Webhooks > Webhook Settings,
 * subscribe it to "Call completed" and "Call updated" (and the Sales Dialer
 * versions if you use that). Public (JustCall isn't signed in), but every
 * request is verified with the account's API secret (JUSTCALL_API_SECRET) before
 * anything is read. See src/lib/hq/justcall-events.ts for the rules.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleWebhook(adminClient(), {
    rawBody,
    headers: {
      signature: req.headers.get("x-justcall-signature"),
      version: req.headers.get("x-justcall-signature-version"),
      timestamp: req.headers.get("x-justcall-request-timestamp"),
    },
    secret: process.env.JUSTCALL_API_SECRET,
  });
  return NextResponse.json(result.json, { status: result.status });
}
