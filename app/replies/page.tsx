import type { Metadata } from "next"

import { PagePlaceholder } from "@/components/page-placeholder"
import { APP_NAME } from "@/lib/app"

// Owner: ai workstream (docs/WORKSTREAMS.md). Replace this placeholder.
export const metadata: Metadata = { title: `Replies · ${APP_NAME}` }

export default function Page() {
  return <PagePlaceholder title="Replies" description="Mentions inbox with AI reply drafts in your voice." owner="ai" />
}
