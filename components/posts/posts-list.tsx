import { ChevronLeftIcon, ChevronRightIcon, SearchXIcon } from "lucide-react"
import Link from "next/link"

import { PostRow } from "@/components/posts/post-row"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber, formatRangeLabel } from "@/lib/format"
import {
  parsePostsParams,
  POSTS_RANGE_LABELS,
  postsQuery,
  type PostsParams,
  type PostsView,
} from "@/lib/posts-params"
import { getPostsPage } from "@/lib/posts-query"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const NOUN: Record<PostsView, [string, string]> = {
  posts: ["post", "posts"],
  replies: ["reply", "replies"],
  all: ["post", "posts"],
}

function countLabel(total: number, view: PostsView) {
  const [one, many] = NOUN[view]
  return `${formatNumber(total)} ${total === 1 ? one : many}`
}

function PageLink({
  params,
  page,
  disabled,
  children,
  label,
}: {
  params: PostsParams
  page: number
  disabled: boolean
  children: React.ReactNode
  label: string
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    )
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/posts${postsQuery({ ...params, page })}`} aria-label={label} scroll>
        {children}
      </Link>
    </Button>
  )
}

export async function PostsList({ searchParams }: { searchParams: SearchParams }) {
  const params = parsePostsParams(await searchParams)
  const { rows, total, page, pageCount, range } = await getPostsPage(params)
  const label = range.from ? formatRangeLabel(range.from, range.to) : null
  const within = params.custom
    ? " in this date range"
    : params.range === "all"
      ? ""
      : ` in the ${POSTS_RANGE_LABELS[params.range].long.toLowerCase()}`

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground tabular-nums">{countLabel(total, params.view)}</span>
        {params.q ? <span>matching &ldquo;{params.q}&rdquo;</span> : null}
        {label ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span className="tabular-nums">{label}</span>
          </>
        ) : null}
      </p>

      <Card className="py-1.5 sm:py-2">
        <CardContent className="px-1.5 sm:px-2">
          {rows.length === 0 ? (
            <div className="t-rise flex flex-col items-center gap-2 px-6 py-16 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <SearchXIcon className="size-5" aria-hidden="true" />
              </span>
              <p className="font-medium">No {NOUN[params.view][1]} found</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {params.q
                  ? `Nothing${within} matches your search. Try fewer words, a longer range or another segment.`
                  : `Nothing posted${within} for this segment.`}
              </p>
            </div>
          ) : (
            <ol className="flex flex-col divide-y divide-border/60">
              {rows.map((post, i) => (
                <PostRow key={post.id} post={post} index={i} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-1">
          <PageLink params={params} page={page - 1} disabled={page <= 1} label="Previous page">
            <ChevronLeftIcon data-icon="inline-start" />
            Previous
          </PageLink>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {formatNumber(page)} of {formatNumber(pageCount)}
          </span>
          <PageLink params={params} page={page + 1} disabled={page >= pageCount} label="Next page">
            Next
            <ChevronRightIcon data-icon="inline-end" />
          </PageLink>
        </nav>
      ) : null}
    </div>
  )
}

export function PostsListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading posts">
      <Skeleton className="h-5 w-48" />
      <Card className="py-1.5 sm:py-2">
        <CardContent className="flex flex-col px-1.5 sm:px-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2.5 px-3 py-3.5 sm:px-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
