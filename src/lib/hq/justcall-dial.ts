/**
 * Click-to-dial for JustCall. Safe to import in the browser.
 *
 * The dialer opens in a small window (JustCall recommends 385 x 665) already
 * filled in with the number. The agent must be signed in to JustCall in the
 * same browser. We also attach the lead's id as call metadata: JustCall hands
 * it back in the webhook, so the call is matched to the right lead even when
 * several leads share a phone number.
 */

/** Set NEXT_PUBLIC_JUSTCALL_DIALER=true in Vercel (and redeploy) to show the Call buttons. */
export const JUSTCALL_DIALER_ENABLED = process.env.NEXT_PUBLIC_JUSTCALL_DIALER === "true";

export const DIALER_WINDOW = "justcall-dialer";
export const DIALER_FEATURES = "width=385,height=665,location=no,menubar=no,toolbar=no";

/** The dialer link for a number. Pass the +E.164 number where there is one. */
export function dialerUrl(number: string, leadId?: string): string {
  const params = [`numbers=${encodeURIComponent(number)}`];   // "+" must be sent as %2B or it reads as a space
  if (leadId) {
    params.push("medium=custom", `metadata=${encodeURIComponent(JSON.stringify({ lead_id: leadId }))}`, "metadata_type=json");
  }
  return `https://app.justcall.io/dialer?${params.join("&")}`;
}

/** Open (or re-use) the dialer window. Returns false if the browser blocked the pop-up. */
export function openDialer(number: string, leadId?: string): boolean {
  const win = window.open(dialerUrl(number, leadId), DIALER_WINDOW, DIALER_FEATURES);
  if (!win) return false;
  try { win.focus(); } catch { /* ignore */ }
  return true;
}
