import type { Metadata } from "next"
import { Suspense } from "react"

import { RepliesInbox, RepliesInboxSkeleton } from "@/components/replies/replies-inbox"
import { Separator } from "@/components/ui/separator"
import { APP_NAME } from "@/lib/app"

export const metadata: Metadata = {
  title: `Replies · ${APP_NAME}`,
  description: "Mentions inbox with AI reply drafts in your voice",
}

export default function RepliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Replies</h1>
        <p className="text-sm text-muted-foreground">
          Mentions and replies to your posts. Draft a reply in your voice, edit it, and send it with your own X keys.
        </p>
      </header>

      <Suspense fallback={<RepliesInboxSkeleton />}>
        <RepliesInbox searchParams={searchParams} />
      </Suspense>

      <Separator />
      <footer className="text-xs text-muted-foreground">
        Mentions arrive with each Grok Bot sync. AI drafts are never sent on their own: a reply goes out only when you
        press Send, through the publish queue.
      </footer>
    </div>
  )
}
