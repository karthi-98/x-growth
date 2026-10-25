/**
 * Preloaded by `bun test` (see bunfig.toml). Bun runs every test file in one
 * process and lib/db/client keeps one client per process, so all tests share
 * one throwaway data folder and database, created and migrated here before any
 * test imports app code. Test files start from a clean slate by calling
 * resetTestData() (the useTestDataDir / useTempDatabase helpers do it).
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const dir = mkdtempSync(path.join(tmpdir(), "x-growth-test-"))
process.env.XGROWTH_TEST_DIR = dir
process.env.XSTATS_DATA_DIR = dir
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`
delete process.env.XGROWTH_X_DRY_RUN

const { db } = await import("../lib/db/client")
const { migrate } = await import("drizzle-orm/libsql/migrator")
await migrate(db, { migrationsFolder: path.join(import.meta.dir, "..", "drizzle") })
