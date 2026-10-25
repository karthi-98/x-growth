import { beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { blockNetwork, useTestDataDir } from "@/lib/ai/testing/env"

let data: typeof import("./data")
let db: (typeof import("@/lib/db/client"))["db"]
let schema: typeof import("@/lib/db/schema")

beforeAll(async () => {
  blockNetwork()
  await useTestDataDir()
  data = await import("./data")
  db = (await import("@/lib/db/client")).db
  schema = await import("@/lib/db/schema")
})

const fetchedAt = "2026-10-24T08:00:00.000Z"

beforeEach(async () => {
  await db.delete(schema.drafts)
  await db.delete(schema.mentions)
  await db.delete(schema.posts)
  await db.insert(schema.posts).values([
    { id: "100", createdAt: "2026-10-23T10:00:00.000Z", text: "I hit 1k followers 🥳", type: "original", conversationId: "100", fetchedAt },
    { id: "102", createdAt: "2026-10-23T11:00:00.000Z", text: "@pal thank you!", type: "reply", conversationId: "100", repliedToId: "101", fetchedAt },
    // A reply to someone else in the same busy conversation: not context for @pal.
    { id: "104", createdAt: "2026-10-23T11:30:00.000Z", text: "@stranger haha yes", type: "reply", conversationId: "100", repliedToId: "777", fetchedAt },
  ])
  await db.insert(schema.mentions).values([
    { id: "101", authorId: "9", authorUsername: "pal", text: "Congrats!", createdAt: "2026-10-23T10:30:00.000Z", conversationId: "100", inReplyToId: "100", fetchedAt },
    { id: "103", authorId: "9", authorUsername: "pal", text: "How did you do it?", createdAt: "2026-10-23T12:00:00.000Z", conversationId: "100", inReplyToId: "102", fetchedAt },
    { id: "200", authorId: "8", authorUsername: "old", text: "Seen this", createdAt: "2026-10-20T12:00:00.000Z", fetchedAt, handledAt: fetchedAt },
  ])
})

describe("listMentions", () => {
  test("filters and counts", async () => {
    expect(await data.mentionCounts()).toEqual({ unhandled: 2, handled: 1, all: 3 })
    expect((await data.listMentions("unhandled")).map((m) => m.id)).toEqual(["103", "101"])
    expect((await data.listMentions("handled")).map((m) => m.id)).toEqual(["200"])
    expect(await data.listMentions("all")).toHaveLength(3)
    expect(data.parseReplyFilter("nope")).toBe("unhandled")
  })

  test("adds the post replied to and its reply chain", async () => {
    const m = await data.getMention("103")
    expect(m?.repliedTo).toMatchObject({ id: "102", mine: true, author: "you" })
    expect(m?.thread.map((p) => [p.id, p.mine])).toEqual([
      ["100", true],
      ["101", false],
    ])
    const first = await data.getMention("101")
    expect(first?.repliedTo).toMatchObject({ id: "100", mine: true, text: "I hit 1k followers 🥳" })
    expect(first?.thread).toEqual([])
  })
})

describe("queueReply", () => {
  test("inserts a scheduled reply draft due now and links it", async () => {
    const now = new Date("2026-10-24T09:00:00.000Z")
    const { draftId, estCostUsd } = await data.queueReply({ mentionId: "103", text: "  Consistency mostly!  ", fromAi: true, now })
    expect(estCostUsd).toBe(0.015)

    const [draft] = await db.select().from(schema.drafts)
    expect(draft).toMatchObject({
      id: draftId,
      kind: "reply",
      parts: JSON.stringify(["Consistency mostly!"]),
      inReplyToId: "103",
      status: "scheduled",
      scheduledAt: now.toISOString(),
      origin: "ai",
      estCostUsd: 0.015,
    })
    const m = await data.getMention("103")
    expect(m?.replyDraftId).toBe(draftId)
    expect(m?.handledAt).toBe(now.toISOString())
    expect(m?.replyDraft).toMatchObject({ id: draftId, status: "scheduled", text: "Consistency mostly!" })
  })

  test("a link costs more on X", async () => {
    const { estCostUsd } = await data.queueReply({ mentionId: "101", text: "Wrote it up: example.com/post", fromAi: false })
    expect(estCostUsd).toBe(0.2)
    const [draft] = await db.select().from(schema.drafts)
    expect(draft.origin).toBe("user")
  })

  test("refuses a second reply while one is queued, allows one after a failure", async () => {
    const { draftId } = await data.queueReply({ mentionId: "101", text: "Thanks!", fromAi: false })
    await expect(data.queueReply({ mentionId: "101", text: "Thanks again!", fromAi: false })).rejects.toThrow("already queued")
    expect(await db.select().from(schema.drafts)).toHaveLength(1)

    await db.update(schema.drafts).set({ status: "failed" }).where((await import("drizzle-orm")).eq(schema.drafts.id, draftId))
    const retry = await data.queueReply({ mentionId: "101", text: "Thanks!", fromAi: false })
    expect(retry.draftId).not.toBe(draftId)
  })

  test("rejects empty text and unknown mentions", async () => {
    await expect(data.queueReply({ mentionId: "101", text: "   ", fromAi: false })).rejects.toThrow("Write a reply")
    await expect(data.queueReply({ mentionId: "999", text: "hi", fromAi: false })).rejects.toThrow("isn't in your inbox")
    expect(await db.select().from(schema.drafts)).toHaveLength(0)
  })

  test("mark handled and back", async () => {
    expect(await data.setMentionHandled("101", true)).toBe(true)
    expect((await data.getMention("101"))?.handledAt).not.toBeNull()
    await data.setMentionHandled("101", false)
    expect((await data.getMention("101"))?.handledAt).toBeNull()
  })
})
