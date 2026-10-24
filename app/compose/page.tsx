import type { Metadata } from "next"

import { PagePlaceholder } from "@/components/page-placeholder"
import { APP_NAME } from "@/lib/app"

// Owner: compose workstream (docs/WORKSTREAMS.md). Replace this placeholder.
export const metadata: Metadata = { title: `Compose · ${APP_NAME}` }

export default function Page() {
  return <PagePlaceholder title="Compose" description="Write posts and threads, get AI help, and post now or schedule." owner="compose" />
}
