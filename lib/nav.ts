import {
  CalendarClockIcon,
  ChartLineIcon,
  LayoutDashboardIcon,
  ListIcon,
  MessageSquareReplyIcon,
  SquarePenIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export type NavHref = "/" | "/posts" | "/insights" | "/compose" | "/queue" | "/replies" | "/settings"

/** App pages shown in the sidebar. Add an entry here to add a nav item. */
export type NavItem = {
  title: string
  href: NavHref
  icon: LucideIcon
  group: "Analytics" | "Create" | "App"
  /** Links carry the current date range between these pages (lib/range-links.ts). */
  carriesRange?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon, group: "Analytics", carriesRange: true },
  { title: "Posts", href: "/posts", icon: ListIcon, group: "Analytics", carriesRange: true },
  { title: "Insights", href: "/insights", icon: ChartLineIcon, group: "Analytics" },
  { title: "Compose", href: "/compose", icon: SquarePenIcon, group: "Create" },
  { title: "Queue", href: "/queue", icon: CalendarClockIcon, group: "Create" },
  { title: "Replies", href: "/replies", icon: MessageSquareReplyIcon, group: "Create" },
  { title: "Settings", href: "/settings", icon: SettingsIcon, group: "App" },
]

export const NAV_GROUPS = ["Analytics", "Create", "App"] as const

/** Nav item for a pathname: exact match for "/", prefix match otherwise. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
}
