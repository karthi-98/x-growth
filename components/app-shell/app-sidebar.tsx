import { ChartNoAxesColumnIcon } from "lucide-react"
import Link from "next/link"

import { NavMain } from "@/components/app-shell/nav-main"
import { ThemeMenuButton } from "@/components/app-shell/theme-menu-button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { APP_NAME } from "@/lib/app"

export function AppSidebar({ minKey, account }: { minKey: string | null; account: string }) {
  return (
    <Sidebar collapsible="icon" className="t-app-sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={APP_NAME}>
              <Link href="/">
                <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <ChartNoAxesColumnIcon aria-hidden="true" />
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</span>
                  <span className="truncate text-xs text-muted-foreground">{account}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain minKey={minKey} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeMenuButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}