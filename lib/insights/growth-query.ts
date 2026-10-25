import { and, asc, eq, lt, sql } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { db } from "@/lib/db/client"
import { accounts, accountSnapshots } from "@/lib/db/schema"
import {
  followerGrowth,
  gainedPerDay,
  trackedFromDay,
  type FollowerGrowth,
  type GainedRow,
  type ImpressionsGained,
} from "@/lib/insights/growth"
import { zonedDays } from "@/lib/insights/zoned"

/**
 * The primary account's id: the `accounts` row marked primary, else the
 * user id from settings. Null before setup (then every snapshot counts,
 * which is right while v1 has one account).
 */
async function primaryAccountId(userId: string | null): Promise<string | null> {
  const [primary] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.isPrimary, true))
    .limit(1)
  return primary?.id ?? userId
}

async function loadFollowerGrowth(
  from: string,
  to: string,
  timeZone: string,
  userId: string | null
): Promise<FollowerGrowth & { hasSnapshots: boolean }> {
  await connection()
  const { end } = zonedDays(from, to, timeZone)
  const accountId = await primaryAccountId(userId)
  const read = (byAccount: boolean) =>
    db
      .select({ takenAt: accountSnapshots.takenAt, followers: accountSnapshots.followers })
      .from(accountSnapshots)
      .where(
        and(
          lt(accountSnapshots.takenAt, end),
          byAccount && accountId ? eq(accountSnapshots.accountId, accountId) : undefined
        )
      )
      .orderBy(asc(accountSnapshots.takenAt))

  let rows = await read(true)
  // Snapshots keyed some other way (e.g. before setup stored the user id).
  if (rows.length === 0 && accountId) rows = await read(false)
  return { ...followerGrowth(rows, from, to, timeZone), hasSnapshots: rows.length > 0 }
}

/** Follower count per local day over an inclusive range, from account_snapshots. */
export const getFollowerGrowth = cache(loadFollowerGrowth)

async function loadImpressionsGained(
  from: string,
  to: string,
  timeZone: string,
  today: string
): Promise<ImpressionsGained | null> {
  await connection()
  const [{ first }] = await db.all<{ first: string | null }>(
    sql`select min(taken_at) as first from post_metric_snapshots`
  )
  const trackedFrom = trackedFromDay(first, today, timeZone)
  if (!trackedFrom || to < trackedFrom) return null

  const { start, end } = zonedDays(from, to, timeZone)
  // Each snapshot minus the post's previous one. A post's first snapshot is
  // its baseline (0 gained), unless the post was created after tracking
  // began: then everything it has was gained since. Grouped by sync minute,
  // which keeps day bucketing exact for every zone offset.
  const rows = await db.all<GainedRow>(sql`
    with s as (
      select post_id, taken_at, impressions,
        lag(impressions) over (partition by post_id order by taken_at) as prev
      from post_metric_snapshots
      where taken_at < ${end}
        and post_id in (
          select post_id from post_metric_snapshots where taken_at >= ${start} and taken_at < ${end}
        )
    )
    select replace(substr(s.taken_at, 1, 16), ' ', 'T') || ':00Z' as at,
      sum(max(0, s.impressions - coalesce(
        s.prev,
        case when p.created_at >= ${first} then 0 else s.impressions end
      ))) as gained
    from s join posts p on p.id = s.post_id
    where s.taken_at >= ${start} and p.type != 'repost'
    group by 1
  `)
  return gainedPerDay(
    rows.map((r) => ({ at: r.at, gained: Number(r.gained) })),
    from,
    to,
    timeZone,
    trackedFrom
  )
}

/**
 * Impressions gained per local day from post_metric_snapshots, or null
 * while there are too few snapshots (callers fall back to lifetime totals
 * by post date).
 */
export const getImpressionsGained = cache(loadImpressionsGained)
