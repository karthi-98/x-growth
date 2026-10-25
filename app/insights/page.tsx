import type { Metadata } from "next"
import { Suspense } from "react"

import {
  Insights,
  InsightsRangeTabs,
  InsightsRangeTabsFallback,
  InsightsSkeleton,
} from "@/components/insights/insights"
import { Separator } from "@/components/ui/separator"
import { APP_NAME } from "@/lib/app"
import { formatTimeZone } from "@/lib/format"
import { getSettings } from "@/lib/get-settings"

export const metadata: Metadata = {
  title: `Insights · ${APP_NAME}`,
  description: "Best time to post, what performs and how consistently you post",
}

async function Footnote() {
  const { timeZone } = await getSettings()
  return (
    <>
      Computed on this computer from your stored posts&apos; lifetime public metrics. Hours and days in{" "}
      {formatTimeZone(timeZone)}; change it in Settings. Medians are used so one viral post doesn&apos;t
      skew a slot.
    </>
  )
}

export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            When to post, what performs and how consistently you post.
          </p>
        </div>
        <Suspense fallback={<InsightsRangeTabsFallback />}>
          <InsightsRangeTabs searchParams={searchParams} />
        </Suspense>
      </header>

      <Suspense fallback={<InsightsSkeleton />}>
        <Insights searchParams={searchParams} />
      </Suspense>

      <Separator />
      <footer className="text-xs text-muted-foreground">
        <Suspense fallback={null}>
          <Footnote />
        </Suspense>
      </footer>
    </div>
  )
}
