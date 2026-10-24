import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

/** "View all posts" link for the Top posts card header. */
export function ViewAllPostsLink({ href }: { href: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="t-view-all -mr-2 text-muted-foreground hover:text-foreground"
    >
      <Link href={href}>
        View all posts
        <ArrowRightIcon data-icon="inline-end" aria-hidden="true" className="t-view-all-arrow" />
      </Link>
    </Button>
  )
}
