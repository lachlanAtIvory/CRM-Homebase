import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Settings size={32} className="opacity-30" />
        <p className="text-sm font-medium">Settings</p>
        <p className="text-xs">Coming in a later phase</p>
      </div>
    </div>
  );
}
