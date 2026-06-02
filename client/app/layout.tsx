import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { ThemeProvider } from "@/components/providers/theme-provider"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

// Mono for numbers, labels, and the PSI brand — matches the poll-tool mockups.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
})

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://toplines.app"

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Toplines — turn a polling CSV into a publish-ready report",
    template: "%s | Toplines",
  },
  description:
    "Drop in a polling CSV and get weighted toplines, crosstabs with significance testing, and a clean PDF report in seconds. Margin of error, raking weights, and an AI executive summary — all in the browser.",
  applicationName: "Toplines",
  keywords: [
    "toplines",
    "crosstabs",
    "polling data analysis",
    "survey topline report",
    "weighted survey results",
    "margin of error calculator",
    "raking weighting",
    "poll PDF report generator",
    "crosstab significance testing",
    "survey CSV analysis",
  ],
  authors: [{ name: "Toplines" }],
  openGraph: {
    type: "website",
    siteName: "Toplines",
    title: "Toplines — turn a polling CSV into a publish-ready report",
    description:
      "Weighted toplines, crosstabs with significance testing, and a clean PDF — straight from your poll CSV.",
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Toplines — CSV in, weighted report out",
    description:
      "Topline percentages, crosstabs, raking weights, margin of error, and a PDF report from any polling CSV.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  alternates: { canonical: "/" },
  formatDetection: { email: false, address: false, telephone: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#090b10" },
  ],
  colorScheme: "light dark",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
