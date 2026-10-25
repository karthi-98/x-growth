import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"

import { db } from "../db/client"
import { getLayout } from "../runtime/layout"

/*
 * Drizzle migrations for the CLI (`xstats setup`, `xstats doctor`). The
 * folder sits in the app folder, wherever the app is installed. Resolve it
 * through the runtime layout, not this file's location: in a release bundle
 * the CLI is one bundled file at the app root, so a path relative to the
 * source file points outside the app.
 */
const migrationsFolder = () => getLayout().migrations

/** Migrations in the app that the database hasn't applied yet. */
export async function pendingMigrations(): Promise<number> {
  const files = readMigrationFiles({ migrationsFolder: migrationsFolder() })
  let last = 0
  try {
    const rows = await db.all<{ created_at: number | string | null }>(
      sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
    )
    last = Number(rows[0]?.created_at ?? 0)
  } catch {
    // No migrations table yet: everything is pending.
  }
  return files.filter((m) => m.folderMillis > last).length
}

/** Apply pending migrations. Returns how many ran. */
export async function applyMigrations(): Promise<number> {
  const pending = await pendingMigrations()
  if (pending > 0) {
    const { migrate } = await import("drizzle-orm/libsql/migrator")
    await migrate(db, { migrationsFolder: migrationsFolder() })
  }
  return pending
}
