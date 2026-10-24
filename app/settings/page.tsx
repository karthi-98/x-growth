import type { Metadata } from "next"

import { AiSection } from "@/components/settings/ai-section"
import { AppSection } from "@/components/settings/app-section"
import { GeneralSection } from "@/components/settings/general-section"
import { SyncSection } from "@/components/settings/sync-section"
import { XKeysSection } from "@/components/settings/x-keys-section"
import { APP_NAME } from "@/lib/app"

export const metadata: Metadata = { title: `Settings · ${APP_NAME}` }

/*
 * Each section is its own component with one owner (docs/WORKSTREAMS.md), so
 * workstreams can build their part without editing this file.
 */
export default function SettingsPage() {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Everything stays on this computer. Keys are stored locally and never shown to Grok Bot.
        </p>
      </header>
      <GeneralSection />
      <SyncSection />
      <XKeysSection />
      <AiSection />
      <AppSection />
    </div>
  )
}
