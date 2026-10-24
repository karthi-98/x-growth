import { AlertTriangleIcon } from "lucide-react"
import { Suspense } from "react"
import { cn } from "cn"

import { healthCopy, toneDot } from "@/components/sync/health"
import { RunHistory } from "@/components/sync/run-history"
import { SyncNowButton } from "@/components/sync/sync-now-button"
import { SyncOptionsForm } from "@/components/sync/sync-options-form"
import { WebhookForm } from "@/components/sync/webhook-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { getSettings } from "@/lib/get-settings"
import { maskSecret, readSecrets } from "@/lib/secrets"
import { formatDateTime } from "@/lib/sync/format"
import { recentRuns } from "@/lib/sync/state"
import { getSyncStatus } from "@/lib/sync/status"

function Part({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

async function SyncSectionBody() {
  const settings = await getSettings()
  const now = new Date()
  const [status, runs] = await Promise.all([getSyncStatus(now, settings), recentRuns(20)])
  const copy = healthCopy(status, now)
  const webhookKey = readSecrets().grokBotWebhookKey
  const configured = !!settings.sync.webhookUrl && !!webhookKey
  const tz = settings.timeZone
  const gap = status.coverage.gap

  return (
    <div className="flex flex-col gap-6">
      <Part title="Status">
        <div className="flex items-start gap-2 text-sm">
          {copy.tone === "warn" || copy.tone === "error" ? (
            <AlertTriangleIcon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                copy.tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"
              )}
              aria-hidden
            />
          ) : (
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneDot[copy.tone])} aria-hidden />
          )}
          <div className="flex flex-col gap-1">
            <span className="font-medium">{copy.chip}</span>
            <span className="text-muted-foreground">{copy.detail}</span>
            {gap ? (
              <span className="text-muted-foreground">
                {formatDateTime(gap.from, tz)} to {formatDateTime(gap.to, tz)} hasn&apos;t been fetched yet; the next run
                covers it.
              </span>
            ) : null}
          </div>
        </div>
        <SyncNowButton configured={configured} />
      </Part>

      <Separator />
      <Part title="Reminders and windows">
        <SyncOptionsForm initial={settings.sync} timeZone={tz} />
      </Part>

      <Separator />
      <Part
        title="Sync now webhook"
        description="Optional. Create a webhook trigger on the X Growth routine in Grok Bot, then paste its URL and key here."
      >
        <WebhookForm url={settings.sync.webhookUrl} maskedKey={maskSecret(webhookKey)} />
      </Part>

      <Separator />
      <Part title="Run history" description={`Last ${runs.length || 20} imports, times in ${tz}.`}>
        <RunHistory runs={runs} timeZone={tz} />
      </Part>
    </div>
  )
}

function SyncSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function SyncSection() {
  return (
    <Card id="sync" className="scroll-mt-16">
      <CardHeader>
        <CardTitle>Sync</CardTitle>
        <CardDescription>
          Grok Bot reads your X data at the reminder times and drops it here; each import waits for your approval.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<SyncSectionSkeleton />}>
          <SyncSectionBody />
        </Suspense>
      </CardContent>
    </Card>
  )
}
