import { Badge } from "@/components/ui/badge"
import type { PostType } from "@/lib/db/schema"
import { POST_TYPE_META } from "@/lib/post-types"

/** Outline badge tinted by post type; colours come from app/post-types.css. */
export function PostTypeBadge({ type }: { type: PostType }) {
  return (
    <Badge variant="outline" data-post-type={type} className="t-type-badge">
      <span aria-hidden="true" className="t-type-dot size-1.5 rounded-full" />
      {POST_TYPE_META[type].label}
    </Badge>
  )
}
