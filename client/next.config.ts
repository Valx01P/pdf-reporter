import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // pdfkit + exceljs read font/template files from disk via fs at runtime, so
  // they must NOT be bundled by the Server Components / Route Handler bundler.
  // Keeping them external lets native `require` resolve their package assets.
  serverExternalPackages: ["pdfkit", "exceljs"],
}

export default nextConfig
