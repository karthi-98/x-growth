import type { Metadata } from "next"

import { PagePlaceholder } from "@/components/page-placeholder"
import { APP_NAME } from "@/lib/app"

// Owner: compose workstream (docs/WORKSTREAMS.md). Replace this placeholder.
export const metadata: Metadata = { title: `Queue · ${APP_NAME}` }

export default function Page() {
  return <PagePlaceholder title="Queue" description="Drafts, scheduled posts, missed posts and publish history." owner="compose" />
}
