import {
  ArrowUpRightIcon,
  BookmarkIcon,
  EyeIcon,
  HeartIcon,
  MessageCircleIcon,
  type LucideIcon,
} from "lucide-react"

import { PostTypeBadge } from "@/components/dashboard/post-type-badge"
import type { DashboardPost } from "@/lib/db/schema"
import { formatCompact, formatNumber, formatPostDate } from "@/lib/format"
import { postHref } from "@/lib/posts-params"

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${formatNumber(value)} ${label}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
      <span className="tabular-nums text-foreground/80">{formatCompact(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * One post. The whole row is the link to X (new tab), so it gets the hover
 * lift, background and focus ring; the stagger index feeds .t-rise.
 */
export function PostRow({ post, index }: { post: DashboardPost; index: number }) {
  return (
    <li className="t-rise" style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <a
        href={postHref(post)}
        target="_blank"
        rel="noopener noreferrer"
        className="group/post relative flex flex-col gap-2 rounded-lg px-3 py-3 outline-none transition-[transform,background-color,box-shadow] duration-(--duration-fast) ease-(--ease-smooth-out) hover:bg-muted/60 hover:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_12px_-4px_rgb(0_0_0/0.08)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:hover:-translate-y-0.5 sm:px-4 dark:hover:bg-muted/40 dark:hover:shadow-none"
      >
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <PostTypeBadge type={post.type} />
          <time dateTime={post.createdAt} className="tabular-nums">
            {formatPostDate(post.createdAt)}
          </time>
          <ArrowUpRightIcon
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 opacity-40 transition-[opacity,transform] duration-(--duration-fast) ease-(--ease-smooth-out) group-hover/post:opacity-100 group-focus-visible/post:opacity-100 motion-safe:group-hover/post:translate-x-0.5 motion-safe:group-hover/post:-translate-y-0.5"
          />
          <span className="sr-only">(opens on X in a new tab)</span>
        </span>
        <span className="line-clamp-2 text-sm leading-relaxed break-words text-foreground">
          {post.text}
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Metric icon={EyeIcon} label="impressions" value={post.impressions} />
          <Metric icon={HeartIcon} label="likes" value={post.likes} />
          <Metric icon={MessageCircleIcon} label="replies" value={post.replies} />
          <Metric icon={BookmarkIcon} label="bookmarks" value={post.bookmarks} />
        </span>
      </a>
    </li>
  )
}
