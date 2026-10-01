import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { PublicChrome } from "@/components/layout/public-chrome";
import { CommandSearch } from "@/components/layout/command-search";
import { FirstRun } from "@/components/onboarding/first-run";

export const metadata: Metadata = {
  title: "Vigil — See what's happening in the world",
  description:
    "Live global conflict monitoring and personalized geopolitical impact analysis.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#080a0d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <Providers>
          <PublicChrome />
          {children}
          <CommandSearch />
          <FirstRun />
        </Providers>
      </body>
    </html>
  );
}
