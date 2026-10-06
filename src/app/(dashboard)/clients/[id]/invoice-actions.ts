"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient, INVOICE_BUCKET } from "@/lib/hq/supabase-admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return supabase;
}

function refresh(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");           // the Revenue chart + Earnings table live on home
}

/** paidOn = a YYYY-MM-DD date marks it paid on that day; null puts it back to outstanding. */
export async function setInvoicePaid(invoiceId: string, clientId: string, paidOn: string | null) {
  const supabase = await requireUser();
  if (paidOn !== null && !DATE_RE.test(paidOn)) throw new Error("Invalid date");

  const { error } = await supabase
    .from("client_invoices")
    .update(paidOn ? { status: "paid", paid_on: paidOn } : { status: "outstanding", paid_on: null })
    .eq("id", invoiceId);
  if (error) throw new Error(error.message);

  refresh(clientId);
}

export async function deleteInvoice(invoiceId: string, clientId: string) {
  const supabase = await requireUser();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("file_path")
    .eq("id", invoiceId)
    .maybeSingle();

  const { error } = await supabase.from("client_invoices").delete().eq("id", invoiceId);
  if (error) throw new Error(error.message);

  // Row gone — now remove the PDF too (best effort; the record is the source of truth)
  if (invoice?.file_path) {
    await adminClient().storage.from(INVOICE_BUCKET).remove([invoice.file_path as string]);
  }

  refresh(clientId);
}
