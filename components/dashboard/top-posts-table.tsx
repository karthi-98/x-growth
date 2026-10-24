import { ArrowUpRightIcon } from "lucide-react"

import { PostTypeBadge } from "@/components/dashboard/post-type-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DashboardPost } from "@/lib/db/schema"
import { formatCompact, formatNumber, formatPostDate } from "@/lib/format"

export function TopPostsTable({ posts, timeZone }: { posts: DashboardPost[]; timeZone: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead className="hidden sm:table-cell">Type</TableHead>
          <TableHead className="text-right">Impressions</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Likes</TableHead>
          <TableHead className="hidden text-right md:table-cell">Replies</TableHead>
          <TableHead className="hidden text-right md:table-cell">Bookmarks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => {
          const isSample = post.id.startsWith("sample-")
          return (
            <TableRow key={post.id}>
              <TableCell className="max-w-0 w-full">
                <div className="flex flex-col gap-1">
                  {post.url && !isSample ? (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium underline-offset-4 hover:underline"
                      title={post.text}
                    >
                      {post.text}
                    </a>
                  ) : (
                    <span className="truncate font-medium" title={post.text}>
                      {post.text}
                    </span>
                  )}
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="sm:hidden">
                      <PostTypeBadge type={post.type} />
                    </span>
                    {formatPostDate(post.createdAt, timeZone)}
                    {post.url && !isSample ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
                      >
                        Open on X
                        <ArrowUpRightIcon className="size-3" />
                      </a>
                    ) : null}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <PostTypeBadge type={post.type} />
              </TableCell>
              <TableCell
                className="text-right font-medium tabular-nums"
                title={formatNumber(post.impressions)}
              >
                {formatCompact(post.impressions)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">
                {formatNumber(post.likes)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {formatNumber(post.replies)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {formatNumber(post.bookmarks)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
