import type { Metadata } from "next"

import { PagePlaceholder } from "@/components/page-placeholder"
import { APP_NAME } from "@/lib/app"

// Owner: runtime workstream (docs/WORKSTREAMS.md). Replace this placeholder.
export const metadata: Metadata = { title: `Setup · ${APP_NAME}` }

export default function Page() {
  return <PagePlaceholder title="Setup" description="Connect your X and AI keys to finish installing." owner="runtime" />
}
