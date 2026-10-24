import type { PostType } from "@/lib/db/schema"

/**
 * One place for post type labels and colours. The CSS custom properties live
 * in app/post-types.css (light + dark). `color` is the swatch (matches the
 * donut segments), `fg` is AA-contrast text for tinted badges.
 */
export const POST_TYPE_META = {
  original: {
    label: "Original",
    plural: "Originals",
    color: "var(--type-original)",
    fg: "var(--type-original-fg)",
  },
  quote: {
    label: "Quote",
    plural: "Quotes",
    color: "var(--type-quote)",
    fg: "var(--type-quote-fg)",
  },
  reply: {
    label: "Reply",
    plural: "Replies",
    color: "var(--type-reply)",
    fg: "var(--type-reply-fg)",
  },
} as const satisfies Record<
  PostType,
  { label: string; plural: string; color: string; fg: string }
>

/** Swatch colour per type, e.g. for chart segments. */
export const POST_TYPE_COLORS: Record<PostType, string> = {
  original: POST_TYPE_META.original.color,
  quote: POST_TYPE_META.quote.color,
  reply: POST_TYPE_META.reply.color,
}
