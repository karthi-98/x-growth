import { Suspense } from "react"

import { GeneralForm } from "@/components/settings/general-form"
import { timeZoneOptions } from "@/components/settings/general-validate"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getSettings } from "@/lib/get-settings"
import { DEFAULT_SETTINGS } from "@/lib/settings"

async function GeneralFormLoader() {
  const settings = await getSettings()
  // The server's list: it does the bucketing, so its zones are the ones that work.
  const zones = timeZoneOptions()
  return (
    <GeneralForm
      handle={settings.handle}
      userId={settings.userId}
      timeZone={settings.timeZone}
      payPeriod={settings.payPeriod}
      defaultPayPeriod={DEFAULT_SETTINGS.payPeriod!}
      zones={zones}
    />
  )
}

/** Account, timezone and pay periods. Owner: analytics workstream (docs/WORKSTREAMS.md). */
export function GeneralSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your X account, the timezone every page uses, and pay periods.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense
          fallback={
            <div className="grid gap-4" aria-busy="true" aria-label="Loading settings">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          }
        >
          <GeneralFormLoader />
        </Suspense>
      </CardContent>
    </Card>
  )
}
