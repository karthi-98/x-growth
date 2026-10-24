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
import { istDateKey } from "@/lib/dates"
import { activeNavItem, NAV_ITEMS } from "@/lib/nav"
import { navHref } from "@/lib/range-links"

function NavList({ hrefFor }: { hrefFor: (href: "/" | "/posts") => string }) {
  const pathname = usePathname()
  const active = activeNavItem(pathname)
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenu className="gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = active?.href === item.href
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
              <Link href={hrefFor(item.href)} aria-current={isActive ? "page" : undefined}
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
  )
}

/** Reads the URL so links carry the current date range between pages. */
function NavListWithParams({ minKey }: { minKey: string | null }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const today = useMemo(() => istDateKey(), [])
  return <NavList hrefFor={(href) => navHref(href, pathname, params, today, minKey)} />
}

export function NavMain({ minKey }: { minKey: string | null }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Pages</SidebarGroupLabel>
      <SidebarGroupContent>
        <Suspense fallback={<NavList hrefFor={(href) => href} />}>
          <NavListWithParams minKey={minKey} />
        </Suspense>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}