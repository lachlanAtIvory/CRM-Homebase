import { createClient } from "@/lib/supabase/server";
import { resolveAccess, ensureFounderRecord, recordLogin } from "@/lib/hq/access-server";
import { landingPath } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { NextResponse } from "next/server";

/**
 * Where Google sends people back after they sign in.
 *
 * Who may come in:
 *   - Ryan and Lachlan (the ALLOWED_EMAILS list), always.
 *   - Anyone added in Settings > Team with the email they sign in with. This
 *     works BEFORE their first sign-in: the row is waiting, they sign in with
 *     Google, they're in. Their row flips from "invited" to "active".
 * Everyone else is signed straight back out.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`,
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Look the person up with the server's own key, so a brand-new invite is found
  // regardless of any row-level rules.
  let admin: ReturnType<typeof adminClient> | null = null;
  try { admin = adminClient(); } catch { admin = null; }
  const result = await resolveAccess(admin ?? supabase, user?.email);

  if (!result.ok) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  if (admin && user?.email) {
    try {
      if (result.access.source === "env") await ensureFounderRecord(admin, result.access);
      else await recordLogin(admin, user.email);
    } catch { /* bookkeeping only: never stop someone signing in */ }
  }

  return NextResponse.redirect(`${origin}${landingPath(result.access)}`);
}
