import { cookies } from "next/headers"
import { Suspense } from "react"

import { AppSidebar } from "@/components/app-shell/app-sidebar"
import { AppTopbar } from "@/components/app-shell/app-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getDataBounds } from "@/lib/queries"

/**
 * Reads shadcn's `sidebar_state` cookie on the server so the first paint
 * already has the remembered width (no expand/collapse flash). cookies() is
 * request-time data, so under Cache Components it sits inside Suspense.
 */
async function ShellWithState({ children }: { children: React.ReactNode }) {
  const store = await cookies()
  const defaultOpen = store.get("sidebar_state")?.value !== "false"
  const bounds = await getDataBounds()
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar minKey={bounds?.min ?? null} />
      <SidebarInset className="min-w-0">
        <AppTopbar />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-svh w-full bg-background" />}>
      <ShellWithState>{children}</ShellWithState>
    </Suspense>
  )
}