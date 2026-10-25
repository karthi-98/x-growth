import { and, count, eq, gte, like } from "drizzle-orm"
import { connection } from "next/server"
import { Suspense } from "react"

import { XKeysForm } from "@/components/settings/x-keys-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { db } from "@/lib/db/client"
import { spendLedger } from "@/lib/db/schema"
import { getSettings } from "@/lib/get-settings"
import { monthStartUtc } from "@/lib/publish/zoned"
import { spendSince } from "@/lib/spend"
import { xKeysStatus } from "@/lib/x/keys"
import { formatUsd } from "@/lib/x/text"

async function XKeysBody() {
  await connection()
  const settings = await getSettings()
  const since = monthStartUtc(new Date(), settings.timeZone)
  const [spent, [posts]] = await Promise.all([
    spendSince(since),
    db
      .select({ n: count() })
      .from(spendLedger)
      .where(and(eq(spendLedger.provider, "x"), like(spendLedger.operation, "post.create%"), gte(spendLedger.at, since))),
  ])
  const cap = settings.monthlySpendCapUsd
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: settings.timeZone }).format(new Date())

  return (
    <>
      <p className="text-sm">
        X spend in {month}: <strong className="tabular-nums">{formatUsd(spent.x)}</strong>
        <span className="text-muted-foreground">
          {" "}
          · {posts?.n ?? 0} {posts?.n === 1 ? "post" : "posts"}
          {cap != null && ` · cap ${formatUsd(cap)} across X and AI (${formatUsd(spent.x + spent.ai)} used)`}
        </span>
      </p>
      <XKeysForm initial={xKeysStatus()} />
    </>
  )
}

export function XKeysSection() {
  return (
    <Card id="x-keys" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>X API keys</CardTitle>
        <CardDescription>
          Your own developer app&apos;s keys (OAuth 1.0a, Read and Write). Used only to post, from this computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
          <XKeysBody />
        </Suspense>
      </CardContent>
    </Card>
  )
}
