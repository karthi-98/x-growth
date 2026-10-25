import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/*
 * Tests only. Points DATABASE_URL at a fresh temp SQLite file and migrates
 * it, so tests never touch data/x-stats.db. Call it before anything imports
 * lib/db/client (use dynamic imports in the test file).
 */
export async function useTempDatabase() {
  if (!process.env.XGROWTH_TEST_DB) {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "xgrowth-test-")), "test.db")
    process.env.XGROWTH_TEST_DB = file
    process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`
  }
  const { db, DATABASE_URL } = await import("../db/client")
  if (DATABASE_URL !== process.env.DATABASE_URL) {
    throw new Error(`lib/db/client was loaded with ${DATABASE_URL} before the test database was set up`)
  }
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") })
  return db
}
