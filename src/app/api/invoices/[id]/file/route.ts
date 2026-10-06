import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient, INVOICE_BUCKET } from "@/lib/hq/supabase-admin";

/**
 * Open an invoice PDF. Checks the session, then redirects to a signed URL
 * that expires after 60 seconds — the bucket itself is private, so the PDF
 * (which contains bank details) is never reachable by a plain link.
 */
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const { data, error } = await adminClient()
    .storage.from(INVOICE_BUCKET)
    .createSignedUrl(invoice.file_path as string, 60);
  if (error || !data?.signedUrl) {
    console.error("Signed URL failed:", error);
    return NextResponse.json({ error: "Couldn't open that file." }, { status: 500 });
  }

  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
