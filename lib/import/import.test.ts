import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { resetTestData, testDataDir } from "@/test/reset"

import type { ExportEnvelope } from "../contract/envelope"
import { TEST_USER, testEnvelope, testPost } from "./test-envelopes"

/*
 * Runs the real pipeline against the shared throwaway data folder that
 * test/setup.ts creates (lib/paths and the DB client already point at it).
 */
const dataDir = testDataDir()

const { sql } = await import("drizzle-orm")
const { db } = await import("../db/client")
const schema = await import("../db/schema")
const { paths } = await import("../paths")
const { updateSettings, readSettings } = await import("../settings")
const { applyMigrations } = await import("../sync/migrations")
const { ensureDataDirs } = await import("./files")
const { importFiles, importInbox } = await import("./import")

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date("2026-10-24T12:00:00Z")
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

let fileNo = 0
function drop(env: ExportEnvelope, name = `posts-${++fileNo}.json`) {
  writeFileSync(path.join(paths.inbox, name), JSON.stringify(env))
  return name
}
const importNow = async (now = NOW) => (await importInbox({ now }))!
const count = async (table: Parameters<typeof sql>[1]) =>
  Number((await db.get<{ n: number }>(sql`select count(*) as n from ${table}`))?.n ?? 0)
const stored = async (id: string) =>
  (await db.select().from(schema.posts).where(sql`${schema.posts.id} = ${id}`))[0]

beforeAll(async () => {
  await resetTestData()
  ensureDataDirs()
  await applyMigrations()
  // A non-IST zone on purpose: days must follow settings.timeZone.
  await updateSettings({ handle: TEST_USER.username, timeZone: "America/New_York" })
})

describe("import pipeline", () => {
  test("adopts the user id from the first envelope, then rejects other accounts", async () => {
    expect((await readSettings()).userId).toBeNull()
    drop(
      testEnvelope({
        run: { id: "bf1", type: "backfill", trigger: "manual", source: "test" },
        fetched_at: at(-3 * DAY),
        window: { start_time: at(-90 * DAY), end_time: at(-3 * DAY) },
        data: [testPost("101", at(-10 * DAY), 100), testPost("102", at(-5 * DAY), 200)],
      })
    )
    const res = await importNow()
    expect(res.result).toMatchObject({ status: "ok", runs: ["bf1"], posts: { received: 2, new: 2, updated: 0 }, gap: null })
    expect((await readSettings()).userId).toBe(TEST_USER.id)
    expect(readdirSync(paths.processed)).toHaveLength(1)

    const other = drop(testEnvelope({ account: { ...TEST_USER, id: "2000000000000000002", username: "someone_else" } }))
    const bad = await importNow()
    expect(bad.result.status).toBe("failed")
    expect(bad.result.failed[0]).toMatchObject({ file: other })
    expect(readFileSync(path.join(paths.failed, `${other}.error.txt`), "utf8")).toContain("@someone_else")
  })

  test("stores accounts, profile snapshots and metric snapshots", async () => {
    expect(await count(schema.accounts)).toBe(1)
    const [account] = await db.select().from(schema.accounts)
    expect(account).toMatchObject({ id: TEST_USER.id, username: TEST_USER.username, isPrimary: true })
    expect(await count(schema.accountSnapshots)).toBe(1)
    expect(await count(schema.postMetricSnapshots)).toBe(2)
  })

  test("a detached window reports a gap; the catch-up fills it and re-attaches", async () => {
    drop(
      testEnvelope({
        run: { id: "lt1", type: "light", trigger: "schedule", source: "test" },
        fetched_at: at(0),
        window: { start_time: at(-DAY), end_time: at(0) },
        data: [testPost("102", at(-5 * DAY), 250), testPost("103", at(-2 * HOUR), 50)],
      })
    )
    const light = await importNow()
    expect(light.result.gap).toEqual({ from: at(-3 * DAY - HOUR), to: at(-DAY) })
    expect(light.state.lastOkTo).toBe(at(-3 * DAY))
    // The next scheduled run still reaches back over the hole if the catch-up never happens.
    expect(Date.parse(light.result.next.from)).toBeLessThanOrEqual(Date.parse(at(-3 * DAY - HOUR)))

    drop(
      testEnvelope({
        run: { id: "cu1", type: "catch-up", trigger: "schedule", source: "test" },
        fetched_at: at(10 * 60_000),
        window: { start_time: light.result.gap!.from, end_time: light.result.gap!.to },
        data: [],
      })
    )
    const catchUp = await importNow(new Date(at(10 * 60_000)))
    expect(catchUp.result.gap).toBeNull()
    expect(catchUp.state.lastOkTo).toBe(at(0))
  })

  test("metric snapshots only when numbers change; never overwrite newer metrics", async () => {
    const before = await count(schema.postMetricSnapshots)
    // 102 changed (200 -> 250) and 103 is new: two snapshots from the light run above.
    expect(before).toBe(4)
    expect((await stored("102"))?.impressions).toBe(250)

    // An older copy (fetched before the light run) must not win.
    drop(
      testEnvelope({
        run: { id: "old1", type: "light", trigger: "schedule", source: "test" },
        fetched_at: at(-2 * DAY),
        window: { start_time: at(-3 * DAY), end_time: at(-2 * DAY) },
        data: [testPost("102", at(-5 * DAY), 210)],
      })
    )
    const old = await importNow()
    expect(old.files[0].posts).toMatchObject({ received: 1, new: 0, updated: 0, skipped: 1 })
    expect((await stored("102"))?.impressions).toBe(250)
    expect(await count(schema.postMetricSnapshots)).toBe(before)
  })

  test("re-importing the same file changes nothing but the run history", async () => {
    const env = testEnvelope({
      run: { id: "lt2", type: "light", trigger: "schedule", source: "test" },
      fetched_at: at(HOUR),
      window: { start_time: at(-DAY), end_time: at(HOUR) },
      data: [testPost("103", at(-2 * HOUR), 80), testPost("104", at(-HOUR), 10)],
    })
    drop(env)
    const first = await importNow(new Date(at(HOUR)))
    expect(first.result.posts).toEqual({ received: 2, new: 1, updated: 1 })

    const snapshot = async () => ({
      posts: await count(schema.posts),
      metricSnapshots: await count(schema.postMetricSnapshots),
      accountSnapshots: await count(schema.accountSnapshots),
      daily: await db.select().from(schema.dailyStats).orderBy(schema.dailyStats.date),
      state: (await db.select().from(schema.syncState))[0],
    })
    const after1 = await snapshot()
    drop(env)
    const second = await importNow(new Date(at(HOUR)))
    expect(second.result).toMatchObject({ status: "ok", posts: { received: 2, new: 0, updated: 0 }, gap: null })
    expect(second.files[0].posts.unchanged).toBe(2)
    expect(await snapshot()).toEqual(after1)
  })

  test("daily_stats follow settings.timeZone", async () => {
    // 03:00Z on 24 Oct is 23:00 on 23 Oct in New York.
    drop(
      testEnvelope({
        run: { id: "tz1", type: "light", trigger: "schedule", source: "test" },
        fetched_at: at(2 * HOUR),
        window: { start_time: at(-DAY), end_time: at(2 * HOUR) },
        data: [testPost("105", "2026-10-24T03:00:00Z", 1000)],
      })
    )
    await importNow(new Date(at(2 * HOUR)))
    const day = async (date: string) =>
      (await db.select().from(schema.dailyStats).where(sql`${schema.dailyStats.date} = ${date}`))[0]
    expect((await day("2026-10-23"))?.impressions).toBeGreaterThanOrEqual(1000)
    expect((await day("2026-10-24"))?.impressions ?? 0).toBeLessThan(1000)
  })

  test("a partial run is saved but never advances coverage", async () => {
    const before = (await db.select().from(schema.syncState))[0]
    drop(
      testEnvelope({
        run: { id: "pt1", type: "light", trigger: "schedule", source: "test" },
        fetched_at: at(5 * HOUR),
        window: { start_time: at(HOUR), end_time: at(5 * HOUR) },
        complete: false,
        rate_limited: true,
        data: [testPost("106", at(4 * HOUR), 5)],
      })
    )
    const res = await importNow(new Date(at(5 * HOUR)))
    expect(res.result.status).toBe("partial")
    expect(res.result.gap).toBeNull()
    expect(res.state.lastOkTo).toBe(before.lastOkTo)
    expect(await stored("106")).toBeDefined()
    const [run] = await db.select().from(schema.syncRuns).where(sql`${schema.syncRuns.status} = 'partial'`)
    expect(run.error).toContain("read limit")
  })

  test("mentions go to the replies inbox; the cursor moves only on complete files", async () => {
    const users = [{ id: "3000000000000000003", username: "a_fan", name: "A Fan" }]
    const mention = (id: string) => ({ ...testPost(id, at(-HOUR), 20), author_id: users[0].id })
    drop(
      testEnvelope({ kind: "mentions", complete: false, users, data: [mention("901")] }),
      "mentions-1.json"
    )
    const partial = await importNow()
    expect(partial.result.mentions).toEqual({ received: 1, new: 1 })
    expect(partial.result.next.mentionsSinceId).toBeNull()

    drop(
      testEnvelope({
        kind: "mentions",
        users,
        // Own replies in a mentions fetch never reach the inbox.
        data: [mention("901"), mention("9100"), testPost("902", at(-HOUR))],
      }),
      "mentions-2.json"
    )
    const res = await importNow()
    expect(res.result.mentions).toEqual({ received: 3, new: 1 })
    // Snowflake ids compare as numbers: 9100 > 901 even though "901" > "9100" as text.
    expect(res.result.next.mentionsSinceId).toBe("9100")
    const rows = await db.select().from(schema.mentions)
    expect(rows.map((r) => r.id).sort()).toEqual(["901", "9100"])
    expect(rows[0]).toMatchObject({ authorUsername: "a_fan", authorName: "A Fan" })
  })

  test("inspiration posts go to inspiration_posts", async () => {
    const author = { id: "4000000000000000004", username: "big_account" }
    drop(
      testEnvelope({
        kind: "inspiration",
        users: [author],
        data: [{ ...testPost("950", at(-DAY), 50_000), author_id: author.id }],
      }),
      "inspiration-1.json"
    )
    await importNow()
    const [row] = await db.select().from(schema.inspirationPosts)
    expect(row).toMatchObject({ id: "950", authorUsername: "big_account", impressions: 50_000, saved: false })
  })

  test("older exports import from an explicit path and stay where they are", async () => {
    const file = path.join(dataDir, "flat-export.json")
    writeFileSync(
      file,
      JSON.stringify([
        { id: "201", created_at: at(-20 * DAY), text: "Synthetic flat row", type: "original", impressions: 7, likes: 1 },
        { id: "202", created_at: at(-19 * DAY), text: "Synthetic flat reply", type: "reply", impressions: 3 },
      ])
    )
    const res = (await importFiles([file], { now: NOW }))!
    expect(res.files[0]).toMatchObject({ status: "ok", format: "flat", posts: { new: 2 } })
    expect(existsSync(file)).toBe(true)
    expect((await stored("202"))?.type).toBe("reply")
  })

  test("inbox files must be envelopes; bad JSON goes to failed/ with the reason", async () => {
    writeFileSync(path.join(paths.inbox, "legacy.json"), JSON.stringify([{ id: "1", text: "x", created_at: at(0) }]))
    writeFileSync(path.join(paths.inbox, "broken.json"), "{ not json")
    const res = await importNow()
    expect(res.result.status).toBe("failed")
    expect(res.result.failed.map((f) => f.file).sort()).toEqual(["broken.json", "legacy.json"])
    expect(existsSync(path.join(paths.failed, "broken.json.error.txt"))).toBe(true)
    expect(readdirSync(paths.inbox)).toHaveLength(0)
  })

  test("an empty inbox still returns a plan", async () => {
    const res = await importNow(new Date(at(6 * HOUR)))
    expect(res.result.status).toBe("empty")
    expect(res.result.next.type).toBeOneOf(["full", "light", "catch-up"])
  })
})
