import { DeltaBadge } from "@/components/dashboard/delta-badge"
import { FollowerGrowthChart } from "@/components/dashboard/follower-growth-chart"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatNumber, formatRangeLabel } from "@/lib/format"
import { getFollowerGrowth } from "@/lib/insights/growth-query"

const signed = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" })

/**
 * "Followers" card: the follower count at the end of each local day, from
 * account_snapshots (written by each sync).
 */
export async function FollowerGrowth({
  from,
  to,
  timeZone,
  userId,
}: {
  from: string
  to: string
  timeZone: string
  userId: string | null
}) {
  const growth = await getFollowerGrowth(from, to, timeZone, userId)
  const label = formatRangeLabel(from, to)
  const { latest, change } = growth
  const start = latest && change !== null ? latest.followers - change : null

  const summary = !growth.hasSnapshots
    ? "Follower counts appear after the first sync records your profile."
    : latest
      ? `Followers, ${label}: ${formatNumber(latest.followers)}` +
        (change !== null ? `, ${signed.format(change)} over the range.` : ".")
      : "Syncs only started recording follower counts after this range."

  return (
    <Card className="t-rise" style={{ "--i": 7 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>Followers</CardTitle>
        <CardDescription>
          End of each day, {label}
          {growth.startedInRange ? " · since the first recorded count" : null}
        </CardDescription>
        {latest ? (
          <CardAction className="flex flex-col items-end gap-1">
            <span className="text-xl font-semibold tabular-nums tracking-tight">
              {formatNumber(latest.followers)}
            </span>
            {change !== null ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                {signed.format(change)} in range
                {start ? <DeltaBadge change={change / start} /> : null}
              </span>
            ) : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <FollowerGrowthChart points={growth.points} summary={summary} />
      </CardContent>
    </Card>
  )
}
