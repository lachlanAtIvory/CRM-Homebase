import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { looksLikePdf, MAX_INVOICE_BYTES } from "@/lib/hq/invoice-pdf";
import { adminClient, INVOICE_BUCKET, isSetupError } from "@/lib/hq/supabase-admin";

/**
 * Invoice upload, step 2 — store the PDF and record the invoice.
 *
 * The PDF goes into the private 'invoices' bucket under a server-chosen
 * path (never the uploaded file name), then a client_invoices row is
 * inserted. If the insert fails the uploaded file is removed again so
 * nothing is orphaned. Session-authed.
 */
export const runtime = "nodejs";

const KINDS = new Set(["setup", "retainer", "other"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

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

  // ── Validate ──────────────────────────────────────────────────────────────
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

  const clientId      = str(form.get("client_id"));
  const invoiceNumber = str(form.get("invoice_number"));
  const kind          = str(form.get("kind"));
  const issuedOn      = str(form.get("issued_on"));
  const paidOn        = str(form.get("paid_on"));
  const notes         = str(form.get("notes"));
  const amount        = Number(str(form.get("amount_aud")));

  if (!UUID_RE.test(clientId))                     return NextResponse.json({ error: "Missing client." }, { status: 400 });
  if (!invoiceNumber || invoiceNumber.length > 60) return NextResponse.json({ error: "Enter the invoice number." }, { status: 400 });
  if (!KINDS.has(kind))                            return NextResponse.json({ error: "Pick the invoice type." }, { status: 400 });
  if (!validDate(issuedOn))                        return NextResponse.json({ error: "Enter a valid issue date." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0)     return NextResponse.json({ error: "Enter the invoice total." }, { status: 400 });
  if (paidOn && !validDate(paidOn))                return NextResponse.json({ error: "Enter a valid paid date." }, { status: 400 });

  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "That client doesn't exist." }, { status: 404 });

  // ── Store the PDF (private bucket, server-chosen path) ────────────────────
  const admin = adminClient();
  const path = `${clientId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(INVOICE_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("Invoice upload failed:", uploadError);
    const setup = isSetupError({ message: uploadError.message });
    return NextResponse.json(
      { error: setup ? "Invoice storage isn't set up yet — run the invoices migration in Supabase." : "Couldn't store the PDF. Try again." },
      { status: setup ? 503 : 500 },
    );
  }

  // ── Record it ─────────────────────────────────────────────────────────────
  const fileName = (file.name || "invoice.pdf").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  const { data: row, error: insertError } = await supabase
    .from("client_invoices")
    .insert({
      client_id:      clientId,
      invoice_number: invoiceNumber,
      kind,
      issued_on:      issuedOn,
      amount_aud:     amount,
      status:         paidOn ? "paid" : "outstanding",
      paid_on:        paidOn || null,
      file_path:      path,
      file_name:      fileName,
      notes:          notes || null,
      uploaded_by:    user.email ?? user.id,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    await admin.storage.from(INVOICE_BUCKET).remove([path]);   // don't leave an orphan
    if (insertError?.code === "23505") {
      return NextResponse.json({ error: `Invoice ${invoiceNumber} is already recorded.` }, { status: 409 });
    }
    if (isSetupError(insertError)) {
      return NextResponse.json({ error: "Invoices aren't set up yet — run the invoices migration in Supabase." }, { status: 503 });
    }
    console.error("Invoice insert failed:", insertError);
    return NextResponse.json({ error: "Couldn't save the invoice. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: row.id });
}
