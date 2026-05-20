"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sun / moon toggle that flips the `dark` class on <html> and persists the
 * choice to localStorage. The FOIT-prevention script in layout.tsx reads
 * the stored value on every load BEFORE React hydrates, so there's no
 * flash of light-on-dark or vice versa.
 */
export function ThemeToggle() {
  // Match what the inline FOIT script decided so we don't show the wrong icon
  // before the first effect runs.
  const [dark, setDark] = useState<boolean>(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-all duration-200",
        "hover:bg-muted hover:text-foreground active:scale-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      {/* Crossfade between sun and moon */}
      <Sun
        size={16}
        className={cn(
          "absolute transition-all duration-300",
          dark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
        )}
      />
      <Moon
        size={16}
        className={cn(
          "absolute transition-all duration-300",
          dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
        )}
      />
    </button>
  );
}
