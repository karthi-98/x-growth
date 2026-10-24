import { RefreshCwIcon } from "lucide-react"
import { connection } from "next/server"
import { Suspense } from "react"

import { formatWhen } from "@/components/replies/format"
import { AiKeyForm } from "@/components/settings/ai-key-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { rebuildVoiceProfile } from "@/lib/ai/actions"
import { monthSpend } from "@/lib/ai/budget"
import { aiKeyStatus } from "@/lib/ai/index"
import { formatUsd } from "@/lib/ai/models"
import { formatNumber } from "@/lib/format"
import { readSettings } from "@/lib/settings"
import { isVoiceProfileStale, readVoiceProfile } from "@/lib/voice/profile"

/** Provider and key, this month's AI spend, and the voice profile every AI prompt uses. */
export function AiSection() {
  return (
    <Card id="ai" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>AI</CardTitle>
        <CardDescription>
          Your own key for writing help: rewrites, post ideas and reply drafts. AI output is always a draft you
          review; nothing is posted automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Suspense fallback={<FormSkeleton />}>
          <KeyForm />
        </Suspense>
        <Separator />
        <Suspense fallback={<Skeleton className="h-16 w-full" />}>
          <Spend />
        </Suspense>
        <Separator />
        <Suspense fallback={<Skeleton className="h-28 w-full" />}>
          <Voice />
        </Suspense>
      </CardContent>
    </Card>
  )
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="h-14" />
      <Skeleton className="h-8 w-36" />
    </div>
  )
}

async function KeyForm() {
  // secrets.json changes outside the build: read it per request.
  await connection()
  return <AiKeyForm initial={aiKeyStatus()} />
}

async function Spend() {
  await connection()
  const spend = await monthSpend()
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">This month</h3>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{formatUsd(spend.ai)}</span> estimated AI spend
        across {formatNumber(spend.generations)} {spend.generations === 1 ? "request" : "requests"}
        {spend.capUsd !== null ? (
          <>
            {" "}
            &middot; monthly cap {formatUsd(spend.capUsd)} (X and AI together, {formatUsd(spend.ai + spend.x)} used)
          </>
        ) : null}
        .
      </p>
      <p className="text-xs text-muted-foreground">
        Estimates from token counts and each provider&apos;s prices (OpenRouter and xAI report exact costs).
      </p>
    </div>
  )
}

async function Voice() {
  await connection()
  const [profile, settings] = await Promise.all([Promise.resolve(readVoiceProfile()), readSettings()])
  const stale = isVoiceProfileStale(profile)
  const built = profile ? formatWhen(profile.builtAt, settings.timeZone) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-medium">Voice profile</h3>
          <p className="text-sm text-muted-foreground">
            {profile
              ? `Built ${built} from your ${profile.examples.length} best original posts${
                  profile.minImpressions > 1 ? ` with at least ${formatNumber(profile.minImpressions)} impressions` : ""
                }, ranked by engagement rate.${stale ? " A week old: it rebuilds on the next AI request." : ""}`
              : "Not built yet. It's built from your best original posts the first time you use AI, and rebuilt weekly."}
          </p>
        </div>
        <form action={rebuildVoiceProfile}>
          <Button type="submit" variant="outline" size="sm">
            <RefreshCwIcon aria-hidden="true" />
            Rebuild voice profile
          </Button>
        </form>
      </div>
      {profile ? (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {profile.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {profile.themes.length ? <li>Topics: {profile.themes.join(", ")}.</li> : null}
          </ul>
          {profile.examples.length ? (
            <details className="group text-sm">
              <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                Example posts the AI learns from
              </summary>
              <ol className="mt-2 flex flex-col gap-2">
                {profile.examples.slice(0, 5).map((e) => (
                  <li key={e.id} className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="line-clamp-3 break-words whitespace-pre-wrap">{e.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(e.impressions)} impressions &middot; {(e.engagementRate * 100).toFixed(1)}% engagement
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
