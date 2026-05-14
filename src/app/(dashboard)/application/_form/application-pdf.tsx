"use client";

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { TeamMember, Service } from "./actions";

// ─── Types ──────────────────────────────────────────────────────────────────
export type PdfProduct = {
  key:              string;
  label:            string;
  upfront_cost_aud: number;
  monthly_cost_aud: number;
};

export type PdfData = {
  // Client
  company_name:    string;
  owner_name:      string;
  contact_email:   string;
  contact_phone:   string;
  // Business
  abn:             string;
  trading_address: string;
  // Services offered
  services:        Service[];
  // Team
  uses_single_calendar: boolean | null;
  team_members:        TeamMember[];
  // Booking platform
  booking_platform_name:  string;
  booking_platform_url:   string;
  booking_platform_notes: string;
  // Products (full info, not just keys)
  selected_products:  PdfProduct[];
  upfront_total_aud:  number;
  monthly_total_aud:  number;
  // Discount (0 percent = none)
  discount_percent:   number;
  discount_reason:    string;
  // Goals
  goals:        string;
  requirements: string;
  // Meta
  generated_at: string;
};

// ─── Styles ─────────────────────────────────────────────────────────────────
const PURPLE      = "#6c4bf1";
const PURPLE_SOFT = "#f1edff";
const TEXT_DIM    = "#6b7280";
const TEXT_DARK   = "#111827";
const BORDER      = "#e5e7eb";

const s = StyleSheet.create({
  page: {
    paddingTop:    36,
    paddingBottom: 48,
    paddingLeft:   40,
    paddingRight:  40,
    fontFamily:    "Helvetica",
    fontSize:      10,
    color:         TEXT_DARK,
    lineHeight:    1.45,
  },
  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "flex-start",
    paddingBottom:  16,
    borderBottomWidth: 2,
    borderBottomColor: PURPLE,
    marginBottom:   20,
  },
  brand: {
    fontSize:   18,
    fontWeight: "bold",
    color:      PURPLE,
  },
  brandSub: {
    fontSize: 9,
    color:    TEXT_DIM,
    marginTop: 2,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  docTitle: {
    fontSize:   9,
    color:      TEXT_DIM,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  docId: {
    fontSize:   11,
    fontWeight: "bold",
    color:      TEXT_DARK,
    marginTop:  3,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize:   10,
    fontWeight: "bold",
    color:      PURPLE,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  row: {
    flexDirection: "row",
    marginBottom:  2,
  },
  label: {
    width: 110,
    color: TEXT_DIM,
  },
  value: {
    flex:  1,
    color: TEXT_DARK,
  },
  para: {
    color: TEXT_DARK,
    marginTop: 2,
  },
  paraEmpty: {
    color: TEXT_DIM,
    fontStyle: "italic",
    marginTop: 2,
  },
  // Team
  teamCard: {
    padding: 8,
    backgroundColor: "#fafafa",
    borderLeftWidth: 3,
    borderLeftColor: PURPLE,
    marginBottom: 6,
  },
  teamName: {
    fontWeight: "bold",
    color: TEXT_DARK,
  },
  teamMeta: {
    color: TEXT_DIM,
    fontSize: 9,
    marginTop: 2,
  },
  // Products table
  table: {
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: PURPLE_SOFT,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  tableCol1: { flex: 2,    fontSize: 9, color: TEXT_DARK, fontWeight: "bold" },
  tableCol2: { flex: 1,    fontSize: 9, color: TEXT_DARK, fontWeight: "bold", textAlign: "right" },
  tableCol3: { flex: 1,    fontSize: 9, color: TEXT_DARK, fontWeight: "bold", textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tableCell1: { flex: 2, fontSize: 10 },
  tableCell2: { flex: 1, fontSize: 10, textAlign: "right" },
  tableCell3: { flex: 1, fontSize: 10, textAlign: "right" },
  // Totals
  totalsBlock: {
    marginTop: 8,
    paddingLeft: 8,
    paddingRight: 8,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  totalsLabel: {
    fontSize: 10,
    color: TEXT_DIM,
  },
  totalsValue: {
    fontSize: 10,
    color: TEXT_DARK,
  },
  totalFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 2,
    borderTopColor: TEXT_DARK,
  },
  totalFinalLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: TEXT_DARK,
  },
  totalFinalValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: PURPLE,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: TEXT_DIM,
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function row(label: string, value: string) {
  return (
    <View style={s.row} key={label}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value || "—"}</Text>
    </View>
  );
}

// ─── Document ───────────────────────────────────────────────────────────────
export function ApplicationPDF({ data }: { data: PdfData }) {
  const upfront        = data.upfront_total_aud;
  const monthly        = data.monthly_total_aud;
  const discountPct    = Number(data.discount_percent) || 0;
  const discountUpAmt  = Math.round(upfront * (discountPct / 100) * 100) / 100;
  const discountMoAmt  = Math.round(monthly * (discountPct / 100) * 100) / 100;
  const upfrontAfter   = Math.round((upfront - discountUpAmt) * 100) / 100;
  const monthlyAfter   = Math.round((monthly - discountMoAmt) * 100) / 100;
  const gst            = Math.round(upfrontAfter * 0.10 * 100) / 100;
  const totalNow       = Math.round((upfrontAfter + gst) * 100) / 100;
  const hasDiscount    = discountPct > 0;

  return (
    <Document
      title={`Application — ${data.company_name}`}
      author="Agent Ivory"
    >
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>Agent Ivory</Text>
            <Text style={s.brandSub}>Application Form — Developer Handoff</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>Generated</Text>
            <Text style={s.docId}>{data.generated_at}</Text>
          </View>
        </View>

        {/* Client Details */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Client Details</Text>
          {row("Company",        data.company_name)}
          {row("Owner / Contact",data.owner_name)}
          {row("Email",          data.contact_email)}
          {row("Phone",          data.contact_phone)}
        </View>

        {/* Business Details */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Business Details</Text>
          {row("ABN",             data.abn)}
          {row("Trading Address", data.trading_address)}
        </View>

        {/* Services offered */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Services Offered</Text>
          {data.services.filter((sv) => sv.name.trim().length > 0).length === 0 ? (
            <Text style={s.paraEmpty}>No services listed.</Text>
          ) : (
            <Text style={s.para}>
              {data.services
                .filter((sv) => sv.name.trim().length > 0)
                .map((sv) => sv.name.trim())
                .join(" · ")}
            </Text>
          )}
        </View>

        {/* Team & Calendars */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Team &amp; Calendars</Text>
          {row(
            "Shared calendar?",
            data.uses_single_calendar === null ? "—"
            : data.uses_single_calendar       ? "Yes — single shared calendar"
                                              : "No — separate calendars per person",
          )}
          {data.team_members.length === 0 ? (
            <Text style={s.paraEmpty}>No team members added.</Text>
          ) : (
            data.team_members
              .filter((m) => m.name.trim().length > 0)
              .map((m, i) => {
                // Resolve service_ids → names using the top-level services list
                const memberServiceNames = (m.service_ids ?? [])
                  .map((id) => data.services.find((sv) => sv.id === id)?.name)
                  .filter((n): n is string => !!n && n.trim().length > 0);
                const otherServices = m.other_services?.trim();
                const serviceLine = [
                  memberServiceNames.join(", "),
                  otherServices ? `Other: ${otherServices}` : "",
                ].filter(Boolean).join(" · ");

                return (
                  <View key={i} style={s.teamCard}>
                    <Text style={s.teamName}>
                      {m.name}{m.position ? ` — ${m.position}` : ""}
                    </Text>
                    {serviceLine && (
                      <Text style={s.teamMeta}>Services: {serviceLine}</Text>
                    )}
                    {data.uses_single_calendar === true && m.has_separate_calendar && (
                      <Text style={s.teamMeta}>Also has separate calendar</Text>
                    )}
                    {data.uses_single_calendar === false && m.integrate_calendar !== undefined && (
                      <Text style={s.teamMeta}>
                        Integrate calendar into agent: {m.integrate_calendar ? "Yes" : "No"}
                      </Text>
                    )}
                  </View>
                );
              })
          )}
        </View>

        {/* Booking platform */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Current Booking Platform</Text>
          {!data.booking_platform_name && !data.booking_platform_url && !data.booking_platform_notes ? (
            <Text style={s.paraEmpty}>Not specified.</Text>
          ) : (
            <>
              {row("Platform", data.booking_platform_name)}
              {row("URL",      data.booking_platform_url)}
              {data.booking_platform_notes && (
                <Text style={s.para}>{data.booking_platform_notes}</Text>
              )}
            </>
          )}
        </View>

        {/* Products + Quote */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Products &amp; Quote</Text>
          {data.selected_products.length === 0 ? (
            <Text style={s.paraEmpty}>No products selected.</Text>
          ) : (
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={s.tableCol1}>PRODUCT</Text>
                <Text style={s.tableCol2}>SETUP</Text>
                <Text style={s.tableCol3}>MONTHLY</Text>
              </View>
              {data.selected_products.map((p) => (
                <View style={s.tableRow} key={p.key}>
                  <Text style={s.tableCell1}>{p.label}</Text>
                  <Text style={s.tableCell2}>{fmt(p.upfront_cost_aud)}</Text>
                  <Text style={s.tableCell3}>{fmt(p.monthly_cost_aud)}</Text>
                </View>
              ))}

              <View style={s.totalsBlock}>
                <View style={s.totalsRow}>
                  <Text style={s.totalsLabel}>Setup subtotal</Text>
                  <Text style={s.totalsValue}>{fmt(upfront)}</Text>
                </View>
                {hasDiscount && (
                  <>
                    <View style={s.totalsRow}>
                      <Text style={[s.totalsLabel, { color: PURPLE }]}>
                        Discount ({discountPct}% off setup)
                        {data.discount_reason ? ` — ${data.discount_reason}` : ""}
                      </Text>
                      <Text style={[s.totalsValue, { color: PURPLE }]}>−{fmt(discountUpAmt)}</Text>
                    </View>
                    <View style={s.totalsRow}>
                      <Text style={{ fontSize: 10, color: TEXT_DARK, fontWeight: "bold" }}>Setup after discount</Text>
                      <Text style={{ fontSize: 10, color: TEXT_DARK, fontWeight: "bold" }}>{fmt(upfrontAfter)}</Text>
                    </View>
                  </>
                )}
                <View style={s.totalsRow}>
                  <Text style={s.totalsLabel}>GST (10%)</Text>
                  <Text style={s.totalsValue}>{fmt(gst)}</Text>
                </View>
                <View style={s.totalFinal}>
                  <Text style={s.totalFinalLabel}>Total payable now</Text>
                  <Text style={s.totalFinalValue}>{fmt(totalNow)}</Text>
                </View>
                {hasDiscount ? (
                  <View style={s.totalsRow}>
                    <Text style={s.totalsLabel}>
                      Recurring monthly (was {fmt(monthly)})
                    </Text>
                    <Text style={s.totalsValue}>{fmt(monthlyAfter)} + GST</Text>
                  </View>
                ) : (
                  <View style={s.totalsRow}>
                    <Text style={s.totalsLabel}>Recurring monthly</Text>
                    <Text style={s.totalsValue}>{fmt(monthly)} + GST</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Goals */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Goals</Text>
          <Text style={data.goals ? s.para : s.paraEmpty}>
            {data.goals || "Not provided."}
          </Text>
        </View>

        {/* Requirements */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Requirements</Text>
          <Text style={data.requirements ? s.para : s.paraEmpty}>
            {data.requirements || "Not provided."}
          </Text>
        </View>

        <Text style={s.footer} fixed>
          Agent Ivory — Generated by the CRM application form. Confidential client data.
        </Text>
      </Page>
    </Document>
  );
}
