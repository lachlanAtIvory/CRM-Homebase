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
          color="#10b981"
          height={3}
          showSpinner={false}
          shadow="0 0 10px #10b981,0 0 5px #10b981"
        />

        {children}

        {/* Toast container — bottom-right, themed, nice slide-in */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: "shadow-lg ring-1 ring-foreground/5",
            },
          }}
        />
      </body>
    </html>
  );
}
