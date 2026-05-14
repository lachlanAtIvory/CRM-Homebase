"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Delete one application row. Used by the trash icon in the Applications
 * section on the client detail page.
 */
export async function deleteApplicationAction(
  applicationId: string,
  clientId:      string,
): Promise<DeleteResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId);

  if (error) return { ok: false, error: error.message };

  // Re-fetch the client detail page so the list updates without a full reload
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

/**
 * Delete a whole client. The applications FK uses ON DELETE SET NULL, so we
 * explicitly nuke applications first to avoid orphaned rows. Tasks and deals
 * have ON DELETE CASCADE and disappear automatically.
 *
 * Redirects back to /clients on success — the page we were on no longer exists.
 */
export async function deleteClientAction(clientId: string): Promise<DeleteResult> {
  const supabase = await createClient();

  await supabase.from("applications").delete().eq("client_id", clientId);

  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  redirect("/clients");
}
