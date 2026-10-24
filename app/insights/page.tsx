import type { Metadata } from "next"

import { PagePlaceholder } from "@/components/page-placeholder"
import { APP_NAME } from "@/lib/app"

// Owner: analytics workstream (docs/WORKSTREAMS.md). Replace this placeholder.
export const metadata: Metadata = { title: `Insights · ${APP_NAME}` }

export default function Page() {
  return <PagePlaceholder title="Insights" description="Best time to post, follower growth and what performs." owner="analytics" />
}
