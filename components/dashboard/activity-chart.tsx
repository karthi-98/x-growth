import { ActivityChartCard } from "@/components/dashboard/activity-chart-card"
import { getActivityData } from "@/lib/activity-query"

/**
 * "Posts and replies" card. Reads per-day counts for the selected range
 * (same ?from/?to keys as the rest of the dashboard) on the server, then
 * hands them to the client chart.
 */
export async function ActivityChart({ from, to }: { from: string; to: string }) {
  const data = await getActivityData(from, to)
  return <ActivityChartCard data={data} />
}
