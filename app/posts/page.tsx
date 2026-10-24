import type { Metadata } from "next"
import { Suspense } from "react"

import {
  PostsControls,
  PostsControlsFallback,
  PostsSubtitle,
} from "@/components/posts/posts-controls"
import { PostsList, PostsListSkeleton } from "@/components/posts/posts-list"
import {
  FilterTransitionProvider,
  PendingArea,
} from "@/components/range-filter/filter-transition"
import { Separator } from "@/components/ui/separator"

export const metadata: Metadata = {
  title: "Posts \u00b7 X Stats",
  description: "Browse posts and replies with search, filters and metrics",
}

export default function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <FilterTransitionProvider>
      {/* The app shell's SidebarInset owns the <main> landmark. */}
      <div className="t-page-in mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
          <Suspense fallback={<p className="h-5" />}>
            <PostsSubtitle />
          </Suspense>
        </header>

        <Suspense fallback={<PostsControlsFallback />}>
          <PostsControls />
        </Suspense>

        <PendingArea>
          <Suspense fallback={<PostsListSkeleton />}>
            <PostsList searchParams={searchParams} />
          </Suspense>
        </PendingArea>

        <Separator />
        <footer className="text-xs text-muted-foreground">
          Lifetime public metrics per post from the X API. Click a post to open it on X.
        </footer>
      </div>
    </FilterTransitionProvider>
  )
}
