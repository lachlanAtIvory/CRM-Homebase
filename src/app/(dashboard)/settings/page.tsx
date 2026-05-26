import { EmailSnippets } from "./email-snippets";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable assets for outreach + day-to-day team workflows.
        </p>
      </div>

      <EmailSnippets />
    </div>
  );
}
