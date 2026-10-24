"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"

/** Theme picker styled as a sidebar menu button (icon + tooltip when collapsed). */
export function ThemeMenuButton() {
  const { theme, setTheme } = useTheme()
  const { isMobile, state } = useSidebar()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Theme" aria-label="Change theme">
          {/* Both icons render; CSS swaps them so SSR never mismatches. */}
          <span className="t-theme-icon relative grid size-4 shrink-0 place-items-center">
            <SunIcon className="t-theme-icon-sun" aria-hidden="true" />
            <MoonIcon className="t-theme-icon-moon absolute" aria-hidden="true" />
          </span>
          <span>Theme</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isMobile ? "top" : state === "collapsed" ? "right" : "top"}
        align={isMobile || state !== "collapsed" ? "start" : "end"}
        className="min-w-40"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}