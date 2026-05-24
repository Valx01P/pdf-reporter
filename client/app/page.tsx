import { SiteHeader } from "@/components/layout/site-header"
import { Workspace } from "@/components/tool/workspace"

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://toplines.app"

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Toplines",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Upload a polling CSV and get a dual Registered/Likely Voter weighted report with crosstabs and a PDF — implementing the PSI Pathway 3 methodology.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  url: SITE,
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        <Workspace />
      </main>
    </>
  )
}
