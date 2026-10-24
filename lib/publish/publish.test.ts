import { beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { useTempDatabase } from "./testing"

// Dynamic imports: lib/db/client must load after the temp database is set.
let db: Awaited<ReturnType<typeof useTempDatabase>>
let pub: typeof import("./index")
let draftsLib: typeof import("./drafts")
let schema: typeof import("../db/schema")
let XApiError: typeof import("../x/errors").XApiError
let settings: import("../settings").AppSettings

beforeAll(async () => {
  db = await useTempDatabase()
  pub = await import("./index")
  draftsLib = await import("./drafts")
  schema = await import("../db/schema")
  XApiError = (await import("../x/errors")).XApiError
  const { DEFAULT_SETTINGS } = await import("../settings")
  settings = { ...DEFAULT_SETTINGS, handle: "tester", timeZone: "UTC", autoPostGraceMinutes: 30 }
})

const NOW = new Date("2026-10-25T12:00:00.000Z")
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString()

type Sent = { text: string; replyToId?: string; quoteId?: string }

/** A fake X: records calls, returns sequential ids, can fail on chosen calls. */
function fakeX(fail: Record<number, unknown> = {}) {
  const sent: Sent[] = []
  let n = 0
  const createPost = async (input: Sent) => {
    n++
    if (fail[n]) throw fail[n]
    sent.push(input)
    return { id: `9000${n}`, text: input.text }
  }
  return { sent, createPost }
}

function deps(x: ReturnType<typeof fakeX>, extra: Partial<import("./index").PublishDeps> = {}) {
  return {
    db,
    createPost: x.createPost,
    now: () => NOW,
    settings,
    spentThisMonthUsd: async () => 0,
    state: { pausedUntil: 0 },
    ...extra,
  }
}

async function addDraft(fields: Omit<Partial<import("../db/schema").NewDraft>, "parts"> & { parts: string[] }) {
  const id = crypto.randomUUID()
  await db.insert(schema.drafts).values({
    id,
    kind: fields.parts.length > 1 ? "thread" : "post",
    status: "scheduled",
    scheduledAt: NOW.toISOString(),
    createdAt: minutes(-120),
    updatedAt: minutes(-120),
    ...fields,
    parts: JSON.stringify(fields.parts),
  })
  return id
}

async function getDraft(id: string) {
  const d = (await draftsLib.getDraft(id, db))!
  return { ...d, ids: pub.draftPublishedIds(d) }
}

beforeEach(async () => {
  await db.delete(schema.drafts)
  await db.delete(schema.posts)
})

describe("publishDue", () => {
  test("sends a due 3-part thread in order, each part replying to the previous one", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["one", "two", "three"] })
    const summary = await pub.publishDue(deps(x))

    expect(summary.published).toEqual([id])
    expect(x.sent).toEqual([{ text: "one" }, { text: "two", replyToId: "90001" }, { text: "three", replyToId: "90002" }])
    const d = await getDraft(id)
    expect(d.status).toBe("published")
    expect(d.ids).toEqual(["90001", "90002", "90003"])
    expect(d.error).toBeNull()

    const rows = await db.select().from(schema.posts)
    expect(rows.map((r) => [r.id, r.type, r.repliedToId, r.conversationId, r.impressions, r.likes])).toEqual([
      ["90001", "original", null, "90001", 0, 0],
      ["90002", "reply", "90001", "90001", 0, 0],
      ["90003", "reply", "90002", "90001", 0, 0],
    ])
    expect(rows[0].url).toBe("https://x.com/tester/status/90001")
  })

  test("a reply or quote sets the reference on the first part only", async () => {
    const x = fakeX()
    await addDraft({ parts: ["re", "more"], inReplyToId: "555", quoteId: "777" })
    await pub.publishDue(deps(x))
    expect(x.sent).toEqual([
      { text: "re", replyToId: "555", quoteId: "777" },
      { text: "more", replyToId: "90001" },
    ])
    const [first] = await db.select().from(schema.posts).limit(1)
    expect(first.type).toBe("quote")
    expect(first.conversationId).toBeNull()
  })

  test("future posts wait", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["later"], scheduledAt: minutes(5) })
    await pub.publishDue(deps(x))
    expect(x.sent).toHaveLength(0)
    expect((await getDraft(id)).status).toBe("scheduled")
  })

  test("late within the grace period: still goes out (computer was off briefly)", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["slightly late"], scheduledAt: minutes(-25) })
    await pub.publishDue(deps(x))
    expect((await getDraft(id)).status).toBe("published")
  })

  test("late beyond the grace period: missed, nothing sent", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["too late"], scheduledAt: minutes(-31) })
    const summary = await pub.publishDue(deps(x))
    expect(summary.missed).toEqual([id])
    expect(x.sent).toHaveLength(0)
    const d = await getDraft(id)
    expect(d.status).toBe("missed")
    expect(d.error).toContain("more than 30 min ago")
  })

  test("a thread already under way finishes even when late", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["a", "b"], scheduledAt: minutes(-90), publishedIds: JSON.stringify(["111"]) })
    await pub.publishDue(deps(x))
    expect(x.sent).toEqual([{ text: "b", replyToId: "111" }])
    expect((await getDraft(id)).ids).toEqual(["111", "90001"])
  })

  test("startup recovery: an interrupted send becomes needs-check and is not resent", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["x"], status: "publishing", updatedAt: minutes(-10) })
    const fresh = await addDraft({ parts: ["y"], status: "publishing", updatedAt: minutes(-1) })
    const summary = await pub.publishDue(deps(x))
    expect(summary.needsCheck).toEqual([id])
    expect(x.sent).toHaveLength(0)
    expect((await getDraft(id)).status).toBe("needs-check")
    // Still being sent by the other process: left alone.
    expect((await getDraft(fresh)).status).toBe("publishing")
  })

  test("needs-check resolves when the synced posts contain every part", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["Fish & chips https://example.com", "part two"], status: "needs-check" })
    await db.insert(schema.posts).values([
      { id: "old", createdAt: minutes(-60), text: "part two", fetchedAt: NOW.toISOString() },
      { id: "p1", createdAt: minutes(1), text: "Fish &amp; chips https://t.co/abc", fetchedAt: NOW.toISOString() },
      { id: "p2", createdAt: minutes(2), text: "part two", type: "reply", fetchedAt: NOW.toISOString() },
    ])
    const summary = await pub.publishDue(deps(x))
    expect(summary.resolved).toEqual([id])
    const d = await getDraft(id)
    expect(d.status).toBe("published")
    expect(d.ids).toEqual(["p1", "p2"])
    expect(x.sent).toHaveLength(0)
  })

  test("needs-check with a partial match records what is on X and waits", async () => {
    const id = await addDraft({ parts: ["first", "second"], status: "needs-check" })
    await db.insert(schema.posts).values({ id: "p1", createdAt: minutes(1), text: "first", fetchedAt: NOW.toISOString() })
    await pub.publishDue(deps(fakeX()))
    const d = await getDraft(id)
    expect(d.status).toBe("needs-check")
    expect(d.ids).toEqual(["p1"])
  })

  test("a server error mid-thread → needs-check; Retry continues from the next part", async () => {
    const x = fakeX({ 2: new XApiError("server", "X had a server error (503).", 503) })
    const id = await addDraft({ parts: ["a", "b", "c"] })
    const summary = await pub.publishDue(deps(x))
    expect(summary.needsCheck).toEqual([id])
    let d = await getDraft(id)
    expect(d.status).toBe("needs-check")
    expect(d.ids).toEqual(["90001"])

    const out = await pub.publishNow(id, deps(x))
    expect(out.status).toBe("published")
    d = await getDraft(id)
    expect(d.ids).toEqual(["90001", "90003", "90004"])
    expect(x.sent.slice(1)).toEqual([
      { text: "b", replyToId: "90001" },
      { text: "c", replyToId: "90003" },
    ])
  })

  test("rate limited: stays scheduled, pauses until the reset, then sends", async () => {
    const retryAt = new Date(NOW.getTime() + 10 * 60_000)
    const x = fakeX({ 1: new XApiError("rate-limit", "X rate limit reached.", 429, retryAt) })
    const state = { pausedUntil: 0 }
    const id = await addDraft({ parts: ["hello"] })

    const first = await pub.publishDue(deps(x, { state }))
    expect(first.held).toEqual([id])
    expect(state.pausedUntil).toBe(retryAt.getTime())
    expect((await getDraft(id)).status).toBe("scheduled")

    const later = new Date(NOW.getTime() + 5 * 60_000)
    await pub.publishDue(deps(x, { state, now: () => later }))
    expect(x.sent).toHaveLength(0)
    expect((await getDraft(id)).error).toContain("Waiting until")

    const after = new Date(NOW.getTime() + 11 * 60_000)
    await pub.publishDue(deps(x, { state, now: () => after }))
    expect((await getDraft(id)).status).toBe("published")
  })

  test("the monthly spend cap holds posts that would pass it", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["costs 0.015"] })
    const capped = { ...settings, monthlySpendCapUsd: 1 }
    await pub.publishDue(deps(x, { settings: capped, spentThisMonthUsd: async () => 0.99 }))
    expect(x.sent).toHaveLength(0)
    const d = await getDraft(id)
    expect(d.status).toBe("scheduled")
    expect(d.error).toContain("monthly spend cap")

    await pub.publishDue(deps(x, { settings: capped, spentThisMonthUsd: async () => 0.5 }))
    expect((await getDraft(id)).status).toBe("published")
  })

  test("refused posts fail with X's reason", async () => {
    const x = fakeX({ 1: new XApiError("duplicate", "X refused this as a duplicate.", 403) })
    const id = await addDraft({ parts: ["dup"] })
    const summary = await pub.publishDue(deps(x))
    expect(summary.failed).toEqual([id])
    const d = await getDraft(id)
    expect(d.status).toBe("failed")
    expect(d.error).toContain("duplicate")
  })

  test("a connection that never reached X keeps the post scheduled", async () => {
    const x = fakeX({ 1: new XApiError("network", "The request to X failed (ENOTFOUND).", 0, undefined, false) })
    const id = await addDraft({ parts: ["offline"] })
    await pub.publishDue(deps(x))
    expect((await getDraft(id)).status).toBe("scheduled")
  })

  test("two publishers at once send each part exactly once", async () => {
    const sent: string[] = []
    let n = 0
    const slow = async (input: Sent) => {
      await Bun.sleep(5)
      sent.push(input.text)
      return { id: `7000${++n}`, text: input.text }
    }
    await addDraft({ parts: ["a", "b", "c"] })
    const d = { ...deps(fakeX()), createPost: slow }
    await Promise.all([pub.publishDue(d), pub.publishDue(d)])
    expect(sent).toEqual(["a", "b", "c"])
  })

  test("Post now on a missed post sends it", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["missed one"], status: "missed", scheduledAt: minutes(-300) })
    const out = await pub.publishNow(id, deps(x))
    expect(out.status).toBe("published")
    expect((await getDraft(id)).scheduledAt).toBe(NOW.toISOString())
  })

  test("AI replies inserted as scheduled-now are sent (ai stream contract)", async () => {
    const x = fakeX()
    const id = await addDraft({ parts: ["thanks!"], kind: "reply", inReplyToId: "123", origin: "ai" })
    await pub.publishDue(deps(x))
    expect(x.sent).toEqual([{ text: "thanks!", replyToId: "123" }])
    expect((await getDraft(id)).status).toBe("published")
  })
})

describe("saveCompose", () => {
  test("schedules in settings.timeZone", async () => {
    const res = await draftsLib.saveCompose(
      { parts: ["hi"], intent: "schedule", scheduleLocal: "2026-10-25T18:00" },
      { db, now: () => NOW, settings: { ...settings, timeZone: "Asia/Kolkata" } }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const d = await getDraft(res.draftId)
    expect(d.status).toBe("scheduled")
    expect(d.scheduledAt).toBe("2026-10-25T12:30:00.000Z")
    expect(d.estCostUsd).toBeCloseTo(0.015)
    expect(res.message).toContain("25 Oct")
  })

  test("rejects posts over 280, empty thread parts, bad links and past times", async () => {
    const opts = { db, now: () => NOW, settings }
    const long = await draftsLib.saveCompose({ parts: ["x".repeat(281)], intent: "schedule", scheduleLocal: "2026-10-26T10:00" }, opts)
    expect(long).toEqual({ ok: false, error: "The post is over 280 characters (281)." })
    const empty = await draftsLib.saveCompose({ parts: ["a", " "], intent: "now" }, opts)
    expect(empty.ok).toBe(false)
    const link = await draftsLib.saveCompose({ parts: ["a"], intent: "draft", replyTo: "https://example.com" }, opts)
    expect(link.ok).toBe(false)
    const past = await draftsLib.saveCompose({ parts: ["a"], intent: "schedule", scheduleLocal: "2026-10-25T11:00" }, opts)
    expect(past.ok).toBe(false)
    // Drafts may be long; they just can't be sent.
    const draft = await draftsLib.saveCompose({ parts: ["x".repeat(300), ""], intent: "draft" }, opts)
    expect(draft.ok).toBe(true)
  })

  test("Post now sends straight away and edits update the same draft", async () => {
    const x = fakeX()
    const opts = { db, now: () => NOW, settings, createPost: x.createPost, state: { pausedUntil: 0 } }
    const saved = await draftsLib.saveCompose(
      { parts: ["v1"], intent: "draft", replyTo: "https://x.com/a/status/321" },
      opts
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const sent = await draftsLib.saveCompose(
      { draftId: saved.draftId, parts: ["v2", "v2 part 2"], intent: "now", replyTo: "https://x.com/a/status/321" },
      opts
    )
    expect(sent.ok).toBe(true)
    expect(x.sent).toEqual([
      { text: "v2", replyToId: "321" },
      { text: "v2 part 2", replyToId: "90001" },
    ])
    const d = await getDraft(saved.draftId)
    expect([d.status, d.kind]).toEqual(["published", "thread"])
    // Published drafts can't be edited.
    const again = await draftsLib.saveCompose({ draftId: saved.draftId, parts: ["v3"], intent: "draft" }, opts)
    expect(again.ok).toBe(false)
  })

  test("queue actions: reschedule, discard to drafts, mark as posted, delete", async () => {
    const opts = { db, now: () => NOW, settings }
    const missed = await addDraft({ parts: ["m"], status: "missed", scheduledAt: minutes(-300) })
    expect(await draftsLib.rescheduleDraft(missed, "2026-10-25T15:00", opts)).toEqual({ ok: true })
    expect((await getDraft(missed)).scheduledAt).toBe("2026-10-25T15:00:00.000Z")

    await draftsLib.unscheduleDraft(missed, opts)
    expect((await getDraft(missed)).status).toBe("draft")

    const check = await addDraft({ parts: ["c"], status: "needs-check" })
    await draftsLib.markDraftPosted(check, opts)
    expect((await getDraft(check)).status).toBe("published")

    const busy = await addDraft({ parts: ["b"], status: "publishing" })
    await draftsLib.deleteDraft(busy, opts)
    await draftsLib.deleteDraft(missed, opts)
    expect(await draftsLib.getDraft(busy, db)).not.toBeNull()
    expect(await draftsLib.getDraft(missed, db)).toBeNull()
  })
})

describe("publishNow when it can't send", () => {
  test("a held Post now goes back to where it was, so the worker never sends it later", async () => {
    const x = fakeX()
    const capped = { ...settings, monthlySpendCapUsd: 0.01 }
    const id = await addDraft({ parts: ["over the cap"], status: "missed", scheduledAt: minutes(-300) })
    const out = await pub.publishNow(id, deps(x, { settings: capped }))
    expect(out.status).toBe("held")
    let d = await getDraft(id)
    expect([d.status, d.scheduledAt]).toEqual(["missed", minutes(-300)])
    expect(d.error).toContain("monthly spend cap")

    // From compose: the text stays a draft and the editor gets its id back.
    const res = await draftsLib.saveCompose({ parts: ["new one"], intent: "now" }, { ...deps(x, { settings: capped }) })
    expect(res.ok).toBe(false)
    if (res.ok || !res.draftId) throw new Error("expected a saved draft id")
    d = await getDraft(res.draftId)
    expect(d.status).toBe("draft")
    await pub.publishDue(deps(x))
    expect(x.sent).toHaveLength(0)
  })
})
