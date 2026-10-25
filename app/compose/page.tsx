import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { Composer, type ComposerInitial } from "@/components/compose/composer"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/app"
import { getSettings } from "@/lib/get-settings"
import { draftParts, draftPublishedIds, PRICES } from "@/lib/publish"
import { bestTimeHint } from "@/lib/publish/best-time"
import { EDITABLE_STATUSES, getDraft } from "@/lib/publish/drafts"
import { utcToZonedLocal } from "@/lib/publish/zoned"
import { hasXKeys } from "@/lib/secrets"
import { isXDryRun } from "@/lib/x/client"

export const metadata: Metadata = { title: `Compose · ${APP_NAME}` }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function ComposeLoader({ searchParams }: { searchParams: PageProps<"/compose">["searchParams"] }) {
  await connection()
  const [sp, settings] = await Promise.all([searchParams, getSettings()])
  const tz = settings.timeZone
  const now = new Date()

  const draftId = first(sp.draft)
  const draft = draftId ? await getDraft(draftId) : null
  const editable =
    !!draft && (EDITABLE_STATUSES as readonly string[]).includes(draft.status) && !draftPublishedIds(draft).length

  const initial: ComposerInitial = editable
    ? {
        draftId: draft.id,
        parts: draftParts(draft),
        replyTo: draft.inReplyToId ? `https://x.com/i/status/${draft.inReplyToId}` : "",
        quote: draft.quoteId ? `https://x.com/i/status/${draft.quoteId}` : "",
        scheduleLocal: draft.scheduledAt && draft.status === "scheduled" ? utcToZonedLocal(draft.scheduledAt, tz) : "",
      }
    : { parts: [""], replyTo: first(sp.reply) ?? "", quote: first(sp.quote) ?? "", scheduleLocal: "" }

  const nextHour = new Date(Math.ceil((now.getTime() + 5 * 60_000) / 3_600_000) * 3_600_000)
  const hint = await bestTimeHint(tz, now)

  return (
    <>
      {draftId && !editable && (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          {draft ? "That draft can't be edited any more (it was sent or is being sent)." : "That draft no longer exists."}{" "}
          Starting a new post. <Link href="/queue" className="font-medium text-foreground underline underline-offset-4">Back to the queue</Link>
        </p>
      )}
      <Composer
        // Remount when switching drafts so the editor state starts fresh.
        key={editable ? draft.id : "new"}
        initial={initial}
        defaultScheduleLocal={utcToZonedLocal(nextHour, tz)}
        minScheduleLocal={utcToZonedLocal(now, tz)}
        timeZone={tz}
        prices={PRICES}
        hint={hint}
        hasKeys={hasXKeys()}
        dryRun={isXDryRun()}
      />
    </>
  )
}

function ComposeSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  )
}

export default function ComposePage({ searchParams }: PageProps<"/compose">) {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        <p className="text-sm text-muted-foreground">
          Write a post or a thread, then post it now or schedule it. Scheduled posts go out while this computer is on.
        </p>
      </header>
      <Suspense fallback={<ComposeSkeleton />}>
        <ComposeLoader searchParams={searchParams} />
      </Suspense>
    </div>
  )
}
