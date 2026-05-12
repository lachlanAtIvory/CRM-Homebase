"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const AI_TOOLS = [
  { id: "agent_ivory",   label: "Agent Ivory"      },
  { id: "webchat",       label: "Webchat Tool"     },
  { id: "outreach",      label: "Outreach Tool"    },
  { id: "email_agent",   label: "Email Agent"      },
  { id: "report_gen",    label: "Report Generator" },
  { id: "calendar_sync", label: "Calendar Sync"    },
];

type Values = {
  contact_name:  string;
  phone:         string;
  email:         string;
  website:       string;
  notes:         string;
  active_tools:  string[];
};

export function ClientForm({
  id,
  initialValues,
}: {
  id: string;
  initialValues: Values;
}) {
  const [values,  setValues]  = useState<Values>(initialValues);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function handleChange(field: keyof Values, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setSaved(false);
  }

  function toggleTool(toolId: string) {
    setValues((v) => {
      const has = v.active_tools.includes(toolId);
      return {
        ...v,
        active_tools: has
          ? v.active_tools.filter((t) => t !== toolId)
          : [...v.active_tools, toolId],
      };
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("clients")
      .update({
        contact_name:  values.contact_name  || null,
        phone:         values.phone         || null,
        email:         values.email         || null,
        website:       values.website       || null,
        notes:         values.notes         || null,
        active_tools:  values.active_tools,
      })
      .eq("id", id);
    setSaving(false);
    if (err) {
      setError("Failed to save — please try again.");
      toast.error("Save failed", { description: "Please try again." });
    } else {
      setSaved(true);
      toast.success("Changes saved");
    }
  }

  return (
    <div className="space-y-6">
      {/* Contact details */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="mb-4 text-sm font-semibold">Contact Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Contact Name"
            value={values.contact_name}
            onChange={(v) => handleChange("contact_name", v)}
            placeholder="e.g. Jane Smith"
          />
          <Field
            label="Phone"
            value={values.phone}
            onChange={(v) => handleChange("phone", v)}
            placeholder="e.g. 0412 345 678"
            type="tel"
          />
          <Field
            label="Email"
            value={values.email}
            onChange={(v) => handleChange("email", v)}
            placeholder="e.g. jane@company.com"
            type="email"
          />
          <Field
            label="Website"
            value={values.website}
            onChange={(v) => handleChange("website", v)}
            placeholder="e.g. https://company.com"
            type="url"
          />
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Notes
          </label>
          <textarea
            value={values.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            placeholder="Any additional notes about this client…"
            rows={3}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40 resize-none"
          />
        </div>
      </div>

      {/* Active AI tools */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="mb-1 text-sm font-semibold">Active AI Tools</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Toggle which tools are active for this client
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AI_TOOLS.map((tool) => {
            const active = values.active_tools.includes(tool.id);
            return (
              <button
                key={tool.id}
                onClick={() => toggleTool(tool.id)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all duration-150 active:scale-[0.97]",
                  active
                    ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/30 hover:text-foreground",
                )}
              >
                {tool.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {saved && !saving && (
          <span className="text-xs text-emerald-600 animate-in fade-in slide-in-from-left-1 duration-300">
            Saved ✓
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label:       string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
  type?:       string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
      />
    </div>
  );
}
