import type { Metadata } from "next";
import { Inter } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Agent Ivory CRM",
  description: "Internal CRM dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body className="antialiased">
        {/* Top progress bar — fires on every Next.js navigation */}
        <NextTopLoader
          color="#6c4bf1"
          height={3}
          showSpinner={false}
          shadow="0 0 10px #6c4bf1,0 0 5px #6c4bf1"
        />

        {children}

        {/* Toast container — top-center, stays for 5s, can't be missed */}
        <Toaster
          position="top-center"
          richColors
          closeButton
          expand
          duration={5000}
          toastOptions={{
            classNames: {
              toast: "shadow-xl ring-1 ring-foreground/10",
              title: "text-sm font-medium",
              description: "text-xs",
            },
          }}
        />
      </body>
    </html>
  );
}
