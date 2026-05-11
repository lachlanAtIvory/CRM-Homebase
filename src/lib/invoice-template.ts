import { COMPANY_NAME, COMPANY_ABN, BANK_DETAILS } from "./resend";

type LineItem = {
  label:        string;
  upfront_aud:  number;
  monthly_aud:  number;
};

export type InvoiceData = {
  invoice_number:   string;
  issue_date:       string; // formatted date
  due_date:         string; // formatted date
  bill_to_name:     string;
  bill_to_company:  string;
  bill_to_email:    string;
  bill_to_address:  string | null;
  bill_to_abn:      string | null;
  line_items:       LineItem[];
  upfront_subtotal: number;
  monthly_subtotal: number;
  gst_rate:         number; // e.g. 0.10
  gst_amount:       number; // GST on upfront only (one-time payable now)
  total_payable_now: number;
};

function fmtAud(v: number) {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds the HTML body for an invoice email.
 * Email-safe — uses inline styles + table layout.
 */
export function renderInvoiceHTML(d: InvoiceData): string {
  const rows = d.line_items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
          ${escapeHtml(item.label)}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">
          ${fmtAud(item.upfront_aud)}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">
          ${fmtAud(item.monthly_aud)}
        </td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="640" style="background:#ffffff;margin:24px auto;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <!-- Header -->
      <tr>
        <td style="padding:28px 32px 16px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" width="100%"><tr>
            <td>
              <div style="font-size:22px;font-weight:700;color:#111827;">${COMPANY_NAME}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(COMPANY_ABN)}</div>
            </td>
            <td style="text-align:right;">
              <div style="font-size:13px;font-weight:600;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;">Tax Invoice</div>
              <div style="font-size:14px;color:#111827;margin-top:6px;font-weight:600;">${escapeHtml(d.invoice_number)}</div>
            </td>
          </tr></table>
        </td>
      </tr>

      <!-- Bill to + dates -->
      <tr>
        <td style="padding:24px 32px;">
          <table role="presentation" width="100%"><tr>
            <td style="vertical-align:top;width:60%;">
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Billed to</div>
              <div style="font-size:14px;color:#111827;font-weight:600;">${escapeHtml(d.bill_to_company)}</div>
              ${d.bill_to_name ? `<div style="font-size:14px;color:#374151;margin-top:2px;">${escapeHtml(d.bill_to_name)}</div>` : ""}
              <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(d.bill_to_email)}</div>
              ${d.bill_to_address ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(d.bill_to_address)}</div>` : ""}
              ${d.bill_to_abn ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">ABN: ${escapeHtml(d.bill_to_abn)}</div>` : ""}
            </td>
            <td style="vertical-align:top;width:40%;text-align:right;">
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Issue date</div>
              <div style="font-size:14px;color:#111827;">${escapeHtml(d.issue_date)}</div>
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:12px;margin-bottom:6px;">Due date</div>
              <div style="font-size:14px;color:#111827;">${escapeHtml(d.due_date)}</div>
            </td>
          </tr></table>
        </td>
      </tr>

      <!-- Line items -->
      <tr>
        <td style="padding:0 32px 8px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;padding:10px 8px;border-bottom:2px solid #e5e7eb;">Product</th>
                <th style="text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;padding:10px 8px;border-bottom:2px solid #e5e7eb;">Setup (one-off)</th>
                <th style="text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;padding:10px 8px;border-bottom:2px solid #e5e7eb;">Monthly</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </td>
      </tr>

      <!-- Totals -->
      <tr>
        <td style="padding:8px 32px 24px;">
          <table role="presentation" width="100%"><tr>
            <td></td>
            <td style="width:280px;">
              <table role="presentation" width="100%">
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding:4px 0;">Setup subtotal</td>
                  <td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${fmtAud(d.upfront_subtotal)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding:4px 0;">GST (10%)</td>
                  <td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${fmtAud(d.gst_amount)}</td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#111827;font-weight:700;padding:8px 0;border-top:2px solid #111827;">Total payable now</td>
                  <td style="font-size:14px;color:#111827;font-weight:700;text-align:right;padding:8px 0;border-top:2px solid #111827;">${fmtAud(d.total_payable_now)}</td>
                </tr>
                <tr>
                  <td style="font-size:12px;color:#6b7280;padding:8px 0 0;">Recurring monthly</td>
                  <td style="font-size:12px;color:#6b7280;text-align:right;padding:8px 0 0;">${fmtAud(d.monthly_subtotal)} +GST</td>
                </tr>
              </table>
            </td>
          </tr></table>
        </td>
      </tr>

      <!-- Payment details -->
      <tr>
        <td style="padding:24px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Payment details</div>
          <div style="font-size:13px;color:#374151;line-height:1.6;">${escapeHtml(BANK_DETAILS)}</div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:20px 32px;text-align:center;font-size:12px;color:#9ca3af;background:#ffffff;">
          Thanks for choosing ${COMPANY_NAME}. Reply to this email with any questions.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
