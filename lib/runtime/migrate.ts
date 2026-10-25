import { mkdirSync } from "node:fs"

import { paths } from "../paths"

/*
 * Apply pending Drizzle migrations from a folder (each release ships its own
 * drizzle/). Safe to run any number of times. The DB client is imported
 * lazily: it opens the database file as soon as it loads, so the data folder
 * must exist first.
 */

export type MigrateResult = { applied: number; total: number }

export async function runMigrations(migrationsFolder: string): Promise<MigrateResult> {
  mkdirSync(paths.data, { recursive: true })
  const [{ migrate }, { db }] = await Promise.all([import("drizzle-orm/libsql/migrator"), import("../db/client")])
  const count = async () => {
    try {
      const r = await db.$client.execute("select count(*) as n from __drizzle_migrations")
      return Number(r.rows[0]?.n ?? 0)
    } catch {
      return 0
    }
  }
  const before = await count()
  await migrate(db, { migrationsFolder })
  const total = await count()
  return { applied: total - before, total }
}
