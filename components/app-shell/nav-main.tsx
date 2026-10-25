"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useMemo } from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { dateKeyIn } from "@/lib/dates"
import { activeNavItem, NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/lib/nav"
import { navHref } from "@/lib/range-links"

type HrefFor = (item: NavItem) => string

function NavList({ hrefFor }: { hrefFor: HrefFor }) {
  const pathname = usePathname()
  const active = activeNavItem(pathname)
  const { isMobile, setOpenMobile } = useSidebar()
  return NAV_GROUPS.map((group) => (
    <SidebarGroup key={group}>
      <SidebarGroupLabel>{group}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
            const isActive = active?.href === item.href
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                  <Link href={hrefFor(item)} aria-current={isActive ? "page" : undefined}
                    // Close the mobile drawer once a page is picked.
                    onClick={() => isMobile && setOpenMobile(false)}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ))
}

/** Reads the URL so links carry the current date range between pages. */
function NavListWithParams({ minKey, timeZone }: { minKey: string | null; timeZone: string }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const today = useMemo(() => dateKeyIn(new Date(), timeZone), [timeZone])
  return (
    <NavList
      hrefFor={(item) =>
        item.carriesRange && (item.href === "/" || item.href === "/posts")
          ? navHref(item.href, pathname, params, today, minKey)
          : item.href
      }
    />
  )
}

export function NavMain({ minKey, timeZone }: { minKey: string | null; timeZone: string }) {
  return (
    <Suspense fallback={<NavList hrefFor={(item) => item.href} />}>
      <NavListWithParams minKey={minKey} timeZone={timeZone} />
    </Suspense>
  )
}
