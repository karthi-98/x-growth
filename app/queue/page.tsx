import { FlaskConicalIcon, SquarePenIcon, TriangleAlertIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { QueueItem, type QueueSection } from "@/components/queue/queue-item"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/app"
import type { Draft } from "@/lib/db/schema"
import { getSettings } from "@/lib/get-settings"
import { loadQueue } from "@/lib/publish/drafts"
import { utcToZonedLocal } from "@/lib/publish/zoned"
import type { AppSettings } from "@/lib/settings"
import { isXDryRun } from "@/lib/x/client"

export const metadata: Metadata = { title: `Queue · ${APP_NAME}` }

function Section({
  title,
  description,
  items,
  section,
  settings,
  now,
  tone,
  empty,
}: {
  title: string
  description?: React.ReactNode
  items: Draft[]
  section: QueueSection
  settings: AppSettings
  now: Date
  tone?: "warn"
  empty?: string
}) {
  if (!items.length && !empty) return null
  const nextHour = new Date(Math.ceil((now.getTime() + 5 * 60_000) / 3_600_000) * 3_600_000)
  return (
    <section
      aria-labelledby={`q-${section}`}
      className={
        tone === "warn"
          ? "flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
          : "flex flex-col gap-3"
      }
    >
      <div className="flex flex-col gap-1">
        <h2 id={`q-${section}`} className="flex items-center gap-2 text-base font-semibold">
          {tone === "warn" && <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
          {title}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{items.length}</span>
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((d) => (
            <QueueItem
              key={d.id}
              draft={d}
              section={section}
              settings={settings}
              now={now}
              defaultLocal={utcToZonedLocal(
                d.scheduledAt && Date.parse(d.scheduledAt) > now.getTime() ? d.scheduledAt : nextHour,
                settings.timeZone
              )}
              minLocal={utcToZonedLocal(now, settings.timeZone)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

async function QueueLoader() {
  await connection()
  const [settings, q] = await Promise.all([getSettings(), loadQueue()])
  const now = new Date()
  const profile = settings.handle ? `https://x.com/${settings.handle}` : null
  const grace = settings.autoPostGraceMinutes

  return (
    <div className="flex flex-col gap-8">
      {isXDryRun() && (
        <p className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-800 dark:text-sky-300">
          <FlaskConicalIcon className="size-4 shrink-0" aria-hidden="true" />
          Dry run is on: posts are marked published with fake ids and nothing reaches X.
        </p>
      )}

      <Section
        title={q.missed.length === 1 ? "A scheduled post was missed" : "Scheduled posts were missed"}
        description={`These came due while the app wasn't running, and more than ${grace} minutes have passed, so they weren't sent automatically. Post now, pick a new time, or discard (the text moves to Drafts).`}
        items={q.missed}
        section="missed"
        settings={settings}
        now={now}
        tone="warn"
      />
      <Section
        title="Check on X"
        description={
          <>
            The app stopped or lost X while sending these, so they may already be posted.{" "}
            {profile ? (
              <a href={profile} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
                Check your profile
              </a>
            ) : (
              "Check your profile"
            )}
            , then Retry or Mark as posted. A matching post in the next sync resolves them on its own.
          </>
        }
        items={q.needsCheck}
        section="needsCheck"
        settings={settings}
        now={now}
        tone="warn"
      />
      <Section
        title="Failed"
        description="X refused these. Fix the problem shown, then Retry; a thread continues from the first unsent post."
        items={q.failed}
        section="failed"
        settings={settings}
        now={now}
      />
      <Section title="Sending now" items={q.publishing} section="publishing" settings={settings} now={now} />
      <Section
        title="Upcoming"
        description={`Times in ${settings.timeZone}. Posts go out while this computer is on; up to ${grace} minutes late they still go out on the next start.`}
        items={q.scheduled}
        section="scheduled"
        settings={settings}
        now={now}
        empty="Nothing scheduled."
      />
      <Section title="Drafts" items={q.drafts} section="drafts" settings={settings} now={now} />
      <Section
        title="Published"
        description="The latest posts sent from this app. Metrics arrive with the next sync."
        items={q.published}
        section="published"
        settings={settings}
        now={now}
      />
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  )
}

export default function QueuePage() {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">Drafts, scheduled posts, missed posts and publish history.</p>
        </div>
        <Button asChild>
          <Link href="/compose">
            <SquarePenIcon /> Compose
          </Link>
        </Button>
      </header>
      <Suspense fallback={<QueueSkeleton />}>
        <QueueLoader />
      </Suspense>
    </div>
  )
}
