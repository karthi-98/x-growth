import { readdirSync, rmSync } from "node:fs"
import path from "node:path"

import { sql } from "drizzle-orm"

/** The shared test data folder created by test/setup.ts. */
export function testDataDir(): string {
  const dir = process.env.XGROWTH_TEST_DIR
  if (!dir) {
    throw new Error("No test data folder. Run tests with `bun test` from the project root (bunfig.toml preloads test/setup.ts).")
  }
  return dir
}

/**
 * Empty every table and remove every file in the test data folder except the
 * database itself (secrets.json, voice profile, inbox/processed/failed, ...),
 * so a test file never sees what an earlier file left behind.
 */
export async function resetTestData(): Promise<void> {
  const dir = testDataDir()
  const { db } = await import("@/lib/db/client")
  const tables = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations'`
  )
  for (const { name } of tables) await db.run(sql.raw(`delete from "${name}"`))
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith("test.db")) rmSync(path.join(dir, entry), { recursive: true, force: true })
  }
}
