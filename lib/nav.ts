import { LayoutDashboardIcon, ListIcon, type LucideIcon } from "lucide-react"

/** App pages shown in the sidebar. Add an entry here to add a nav item. */
export type NavItem = {
  title: string
  href: "/" | "/posts"
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { title: "Posts", href: "/posts", icon: ListIcon },
]

/** Nav item for a pathname: exact match for "/", prefix match otherwise. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
}