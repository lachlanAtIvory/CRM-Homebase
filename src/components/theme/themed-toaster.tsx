"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/**
 * Sonner Toaster wrapper that watches the `class="dark"` attribute on <html>
 * and switches sonner's theme accordingly. Sonner's own "system" mode reads
 * prefers-color-scheme (OS-level), which won't follow our class-based toggle
 * — so we wire it up manually.
 */
export function ThemedToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const update = () => {
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      position="top-center"
      theme={theme}
      richColors
      closeButton
      expand
      duration={5000}
      toastOptions={{
        classNames: {
          toast:       "shadow-xl ring-1 ring-foreground/10",
          title:       "text-sm font-medium",
          description: "text-xs",
        },
      }}
    />
  );
}
