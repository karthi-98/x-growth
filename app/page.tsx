import { Suspense } from "react"

import { Dashboard, DashboardFootnote, DataStatus } from "@/components/dashboard/dashboard"
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton"
import {
  FilterTransitionProvider,
  PendingArea,
} from "@/components/range-filter/filter-transition"
import { RangeFilter, RangeFilterFallback } from "@/components/range-filter/range-filter"
import { Separator } from "@/components/ui/separator"
import { getSettings } from "@/lib/get-settings"
import { accountLabel } from "@/lib/settings"

async function AccountTitle() {
  return <>{accountLabel(await getSettings())}</>
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <FilterTransitionProvider>
      <div className="t-page-in mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        {/* Title and status, then the range filter (side by side from lg,
            since the sidebar narrows the content area). */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              <Suspense fallback={" "}>
                <AccountTitle />
              </Suspense>
            </h1>
            <Suspense fallback={<span className="h-5" />}>
              <DataStatus searchParams={searchParams} />
            </Suspense>
          </div>
          <div className="shrink-0">
            <Suspense fallback={<RangeFilterFallback />}>
              <RangeFilter searchParams={searchParams} />
            </Suspense>
          </div>
        </header>

        <PendingArea>
          <Suspense fallback={<DashboardSkeleton />}>
            <Dashboard searchParams={searchParams} />
          </Suspense>
        </PendingArea>

        <Separator />
        <footer className="text-xs text-muted-foreground">
          <Suspense fallback={null}>
            <DashboardFootnote />
          </Suspense>
        </footer>
      </div>
    </FilterTransitionProvider>
  )
}
