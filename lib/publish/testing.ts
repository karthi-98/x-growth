import { resetTestData, testDataDir } from "@/test/reset"

/*
 * Tests only. test/setup.ts (preloaded by `bun test`) points DATABASE_URL at
 * one migrated temp SQLite file for the whole process, so tests never touch
 * data/x-stats.db. This empties it so the calling test file starts clean.
 */
export async function useTempDatabase() {
  testDataDir()
  const { db, DATABASE_URL } = await import("../db/client")
  if (DATABASE_URL !== process.env.DATABASE_URL) {
    throw new Error(`lib/db/client was loaded with ${DATABASE_URL}, not the test database`)
  }
  await resetTestData()
  return db
}
