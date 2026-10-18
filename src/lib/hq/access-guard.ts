import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { can, PREVIEW_COOKIE, type Access, type Need } from "./access";
import { getCurrentAccess, resolveAccessView, type AccessView } from "./access-server";

/**
 * Checks for route handlers and server actions. The middleware already
 * blocks URLs a person isn't allowed to open; these are the second lock, so
 * a handler is safe even if it's ever reached some other way.
 */

/** For route handlers: resolves to the person's access, or the status and message to answer with. */
export async function requireAccessApi(
  need: Need,
): Promise<{ ok: true; access: Access } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const result = await getCurrentAccess(supabase);
  if (!result.ok) {
    return { ok: false, status: result.reason === "error" ? 503 : 401, error: result.reason === "error" ? "Couldn't check your access." : "Unauthorized" };
  }
  if (!can(result.access, need)) return { ok: false, status: 403, error: "You don't have access to this." };
  return { ok: true, access: result.access };
}

/** For server actions: throws unless the signed-in person has what's needed. */
export async function assertAccess(need: Need): Promise<Access> {
  const check = await requireAccessApi(need);
  if (!check.ok) throw new Error(check.error);
  return check.access;
}

/**
 * For pages and layouts: who is signed in and what they should SEE, honouring a
 * manager's "preview as". Route handlers and server actions keep using the checks
 * above, which always use the real person.
 */
export async function getAccessView(): Promise<AccessView | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const preview = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const result = await resolveAccessView(supabase, user?.email, preview);
  return result.ok ? result.view : null;
}

/** What the signed-in person should see (a manager previewing as someone gets that person's view). */
export async function getEffectiveAccess(): Promise<Access | null> {
  return (await getAccessView())?.effective ?? null;
}
