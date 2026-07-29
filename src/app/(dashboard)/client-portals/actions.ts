"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Regenerate a client's portal token — instantly invalidates the old
 * /client/[token] link. Use when a link may have leaked, or just to
 * rotate it on a schedule.
 */
export async function regeneratePortalToken(clientId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // 24 random bytes, hex-encoded — same scheme as the migration's default.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { error } = await supabase
    .from("hq_clients")
    .update({ portal_token: token })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/client-portals");
  return token;
}
