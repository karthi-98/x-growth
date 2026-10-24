"use client"

import { usePathname } from "next/navigation"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { activeNavItem } from "@/lib/nav"

/** Slim bar above every page: sidebar toggle (Ctrl/Cmd+B) and page name. */
export function AppTopbar() {
  const title = activeNavItem(usePathname())?.title
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Toggle sidebar <kbd className="ml-1 font-sans opacity-70">Ctrl B</kbd>
        </TooltipContent>
      </Tooltip>
      {title ? (
        <>
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium">{title}</span>
        </>
      ) : null}
    </header>
  )
}