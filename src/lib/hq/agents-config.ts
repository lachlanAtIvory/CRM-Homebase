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

export type AgentFieldType = "text" | "date" | "textarea" | "select";

export type AgentField = {
  key:          string;         // property name sent to the webhook
  label:        string;
  type:         AgentFieldType;
  required?:    boolean;
  placeholder?: string;
  options?:     string[];       // static select options
  optionsFrom?: "hq_clients";   // dynamic select — populated from the table
};

export type AgentConfig = {
  id:           string;         // slug; stored in jobs.agent
  name:         string;
  description:  string;
  webhookEnv:   string;         // env var NAME holding the n8n webhook URL
  kind:         "form" | "status";
  fields:       AgentField[];
  submitLabel?: string;
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
    description: "Builds a client performance report for a date range.",
    webhookEnv:  "N8N_WEBHOOK_REPORT",
    kind:        "form",
    fields: [
      { key: "client_id", label: "Client",    type: "select", required: true, optionsFrom: "hq_clients" },
      { key: "date_from",  label: "From",     type: "date",   required: true },
      { key: "date_to",    label: "To",       type: "date",   required: true },
    ],
    submitLabel: "Generate report",
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
