import { resetTestData, testDataDir } from "@/test/reset"

/*
 * Test helpers. test/setup.ts (preloaded by `bun test`) points the data
 * folder and database at one migrated temp directory for the whole process.
 * `useTestDataDir()` empties it so this test file starts clean; call it in
 * beforeAll, then import modules that touch the DB.
 */

type TestEnv = { dir: string }

export async function useTestDataDir(): Promise<TestEnv> {
  const dir = testDataDir()
  await resetTestData()
  return { dir }
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
