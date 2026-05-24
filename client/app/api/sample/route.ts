import { PSI_SAMPLE_CSV, PSI_SAMPLE_NAME } from "@/lib/psi/sample"

export const runtime = "nodejs"

// Serves the synthetic PSI-instrument dataset for the "Load sample" button so
// the client never bundles the generator.
export async function GET() {
  return Response.json({ name: PSI_SAMPLE_NAME, csvText: PSI_SAMPLE_CSV })
}
