"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Delete an application from the global Applications list. Revalidates the
 * /applications page so the row disappears immediately.
 */
export async function deleteApplicationFromList(
  applicationId: string,
): Promise<DeleteResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/applications");
  return { ok: true };
}
