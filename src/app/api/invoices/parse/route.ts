import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractPdfText, looksLikePdf, MAX_INVOICE_BYTES } from "@/lib/hq/invoice-pdf";
import { parseInvoiceText, type ParsedInvoice } from "@/lib/hq/invoice-parse";

/**
 * Invoice upload, step 1 — read a PDF and suggest the fields.
 *
 * Nothing is stored here. The browser shows the suggestions for the user
 * to confirm/correct, then POSTs the file again to /api/invoices to save.
 * Session-authed. Returns only the parsed fields, never the PDF's text.
 */
export const runtime = "nodejs";

const NOT_FOUND: ParsedInvoice = {
  invoice_number: null, issued_on: null, amount_aud: null, kind: "other", client_match: null,
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload must be multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a PDF to upload." }, { status: 400 });
  }
  if (file.size > MAX_INVOICE_BYTES) {
    return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return NextResponse.json({ error: "That doesn't look like a PDF." }, { status: 400 });
  }

  // Client name lets us warn if the PDF is for someone else
  let clientName: string | null = null;
  const clientId = form.get("client_id");
  if (typeof clientId === "string" && clientId) {
    const { data } = await supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle();
    clientName = (data?.company_name as string | undefined) ?? null;
  }

  // An unreadable or scanned (image-only) PDF isn't an error — the user just
  // fills the fields in by hand.
  let text = "";
  try {
    text = await extractPdfText(bytes);
  } catch (e) {
    console.error("Invoice PDF read failed:", e);
  }

  const readable = text.trim().length > 0;
  return NextResponse.json({
    ok: true,
    readable,
    parsed: readable ? parseInvoiceText(text, clientName) : NOT_FOUND,
  });
}
