/**
 * HQ Mission Control — agent card config.
 *
 * RYAN: add a new agent by adding an entry here. No component changes needed.
 * Each card renders on /agents with its fields as a form; submitting creates
 * a `jobs` row and POSTs the form data (+ job_id) to the n8n webhook whose
 * URL lives in the env var named by `webhookEnv` (set it in Vercel).
 *
 * Field types: "text" | "date" | "textarea" | "select".
 * Selects use `options` (static list) or `optionsFrom: "hq_clients"`
 * (dropdown of signed clients, value = client uuid).
 *
 * `kind: "status"` renders a status card (no form) with a single run button —
 * used by the Call Monitor.
 */

export type AgentFieldType = "text" | "number" | "date" | "textarea" | "select";

export type AgentField = {
  key:          string;         // property name sent to the webhook
  label:        string;
  type:         AgentFieldType;
  required?:    boolean;
  placeholder?: string;
  options?:     string[];       // static select options
  optionsFrom?: "hq_clients";   // dynamic select — populated from the table
  half?:        boolean;        // render at half width (pair consecutive halves)
};

export type AgentConfig = {
  id:           string;         // slug; stored in jobs.agent
  name:         string;
  description:  string;
  webhookEnv:   string;         // env var NAME holding the n8n webhook URL
  kind:         "form" | "status";
  fields:       AgentField[];
  submitLabel?: string;
  // true = don't wait for the n8n callback; the card confirms "sent" and the
  // job is marked done immediately. Use for workflows that deliver their
  // output elsewhere (Drive, Slack) and don't POST /api/jobs/:id/complete yet.
  fireAndForget?: boolean;
};

export const AGENTS: AgentConfig[] = [
  {
    id:          "slide_deck_creator",
    name:        "Slide Deck Creator",
    description: "Generates a tailored pitch deck for a clinic from its website.",
    webhookEnv:  "N8N_WEBHOOK_DECK",
    kind:        "form",
    fields: [
      { key: "clinic_name", label: "Clinic name", type: "text", required: true, placeholder: "Smile Dental Group" },
      { key: "website_url", label: "Website URL", type: "text", required: true, placeholder: "https://…" },
    ],
    submitLabel: "Create deck",
  },
  {
    id:          "report_generator",
    name:        "Report Generator",
    description: "Add a business to the Leads sheet and generate a fresh report. n8n appends the row and runs the report workflow.",
    webhookEnv:  "N8N_WEBHOOK_REPORT",
    kind:        "form",
    // Field keys mirror the "Agent Ivory - Leads" sheet columns — Ryan's
    // Sheets node maps them 1:1 (and sets Processed itself).
    fields: [
      { key: "business_name",   label: "Business name",   type: "text",   required: true, placeholder: "Breeze Dental Helensvale" },
      { key: "website",         label: "Website",         type: "text",   required: true, placeholder: "https://…" },
      { key: "email",           label: "Email",           type: "text",   half: true, placeholder: "hello@…" },
      { key: "number",          label: "Phone",           type: "text",   half: true, placeholder: "+61 …" },
      { key: "address",         label: "Address",         type: "text",   placeholder: "Street, suburb, state, postcode" },
      { key: "category",        label: "Category",        type: "text",   half: true, placeholder: "Dentist, Physiotherapist…" },
      { key: "rating",          label: "Google rating",   type: "number", half: true, placeholder: "4.8" },
      { key: "reviews",         label: "Review count",    type: "number", half: true, placeholder: "125" },
      { key: "google_maps_url", label: "Google Maps URL", type: "text",   half: true, placeholder: "https://google.com/maps/place/…" },
    ],
    submitLabel: "Add lead + generate report",
    // Flip to false once Ryan's workflow POSTs /api/jobs/:id/complete —
    // the card will then wait and show the finished report as a button.
    fireAndForget: true,
  },
  {
    id:          "linkedin_draft",
    name:        "LinkedIn Draft",
    description: "Drafts a LinkedIn post on a topic in the Agent Ivory voice.",
    webhookEnv:  "N8N_WEBHOOK_LINKEDIN",
    kind:        "form",
    fields: [
      { key: "topic", label: "Topic", type: "textarea", required: true, placeholder: "Why missed calls cost clinics more than they think…" },
    ],
    submitLabel: "Draft post",
  },
  {
    id:          "call_monitor",
    name:        "Call Monitor",
    description: "Checks that call data is still flowing in for every client.",
    webhookEnv:  "N8N_WEBHOOK_CALLMONITOR",
    kind:        "status",
    fields:      [],
    submitLabel: "Run check",
  },
];
