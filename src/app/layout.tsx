import type { Metadata } from "next";
import { Inter } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { cn } from "@/lib/utils";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Agent Ivory CRM",
  description: "Internal CRM dashboard",
};

/**
 * Inline script that runs SYNCHRONOUSLY before React hydrates, applying the
 * saved theme class to <html>. Without this, a dark-mode user would see a
 * flash of light theme on every reload while React figures out the state.
 *
 * Tiny, dependency-free, wrapped in try/catch so it can't ever throw.
 */
const FOIT_PREVENTION = `
try {
  var t = localStorage.getItem("theme");
  if (!t) t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (t === "dark") document.documentElement.classList.add("dark");
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FOIT_PREVENTION }} />
      </head>
      <body className="antialiased">
        {/* Top progress bar — fires on every Next.js navigation */}
        <NextTopLoader
          color="#6c4bf1"
          height={3}
          showSpinner={false}
          shadow="0 0 10px #6c4bf1,0 0 5px #6c4bf1"
        />

        {children}

        {/* Toast container — wired to follow dark-mode toggle */}
        <ThemedToaster />
      </body>
    </html>
  );
}
