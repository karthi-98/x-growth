import { gte, sql } from "drizzle-orm"

import { db } from "./db/client"
import { spendLedger } from "./db/schema"

/*
 * Ledger of every paid call made with the user's own keys. X prices from
 * https://docs.x.com/x-api/getting-started/pricing (Oct 2026).
 */
export const X_PRICES_USD = {
  postCreate: 0.015,
  postCreateWithUrl: 0.2,
  ownedRead: 0.001,
  postRead: 0.005,
  userRead: 0.01,
  delete: 0.01,
} as const

export type SpendEntry = {
  provider: "x" | "ai"
  /** e.g. "post.create", "post.create.url", "users.me", "ai.reply" */
  operation: string
  units?: number
  estCostUsd: number
}

export async function recordSpend(entry: SpendEntry): Promise<void> {
  await db.insert(spendLedger).values({
    provider: entry.provider,
    operation: entry.operation,
    units: entry.units ?? 1,
    estCostUsd: entry.estCostUsd,
    at: new Date().toISOString(),
  })
}

/** Total estimated spend since an ISO instant, by provider. */
export async function spendSince(sinceIso: string): Promise<{ x: number; ai: number }> {
  const rows = await db
    .select({ provider: spendLedger.provider, total: sql<number>`coalesce(sum(${spendLedger.estCostUsd}), 0)` })
    .from(spendLedger)
    .where(gte(spendLedger.at, sinceIso))
    .groupBy(spendLedger.provider)
  const by = Object.fromEntries(rows.map((r) => [r.provider, Number(r.total)]))
  return { x: by.x ?? 0, ai: by.ai ?? 0 }
}
