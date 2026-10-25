import type { Metadata } from "next"
import { Suspense } from "react"

import { SetupWizard, SetupWizardSkeleton } from "@/components/setup/setup-wizard"
import { APP_NAME } from "@/lib/app"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
export const metadata: Metadata = { title: `Setup · ${APP_NAME}` }

/** First-run wizard; the installer opens it. Welcome → X keys → AI key → first sync → done. */
export default function SetupPage({ searchParams }: PageProps<"/setup">) {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Set up {APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">A few steps, all on this computer. You can skip any of them and come back later.</p>
      </header>
      <Suspense fallback={<SetupWizardSkeleton />}>
        <SetupWizard searchParams={searchParams} />
      </Suspense>
    </div>
  )
}
