import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/*
 * Test helpers. `useTestDataDir()` points the data folder and database at a
 * fresh temp directory and migrates it, before anything opens the real
 * data/x-stats.db. Test files that touch the DB must import their modules
 * with `await import()` after calling it. Bun runs every test file in one
 * process, so the setup runs once and is shared.
 */

type TestEnv = { dir: string }
const g = globalThis as unknown as { __xgTestEnv?: Promise<TestEnv>; xStatsClient?: unknown }

export function useTestDataDir(): Promise<TestEnv> {
  g.__xgTestEnv ??= (async () => {
    if (g.xStatsClient) throw new Error("The DB client was opened before the test data dir was set up.")
    const dir = mkdtempSync(path.join(tmpdir(), "x-growth-test-"))
    process.env.XSTATS_DATA_DIR = dir
    process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`

    const { paths } = await import("@/lib/paths")
    if (paths.data !== dir) throw new Error("lib/paths was loaded before the test data dir was set up.")
    const { db } = await import("@/lib/db/client")
    const { migrate } = await import("drizzle-orm/libsql/migrator")
    await migrate(db, { migrationsFolder: path.join(import.meta.dir, "..", "..", "..", "drizzle") })
    return { dir }
  })()
  return g.__xgTestEnv
}

/** Make any real network call fail loudly (tests pass a mock fetch instead). */
export function blockNetwork(): void {
  globalThis.fetch = (async () => {
    throw new Error("Real network calls are disabled in tests")
  }) as unknown as typeof fetch
}

export type Captured = { url: string; init: RequestInit; body: Record<string, unknown>; headers: Record<string, string> }

/** A fetch that records requests and answers with `respond`. */
export function mockFetch(respond: (call: Captured) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Captured[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call: Captured = {
      url,
      init,
      body: JSON.parse(String(init.body ?? "{}")),
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
    }
    calls.push(call)
    const r = respond(call)
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    })
  }
  return { fetch: fetchImpl, calls }
}
