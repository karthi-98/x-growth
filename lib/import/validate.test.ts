import { describe, expect, test } from "bun:test"

import { TEST_USER, testEnvelope, testPost } from "./test-envelopes"
import { MAX_ENVELOPE_BYTES, validateEnvelope, type ValidateOptions } from "./validate"

const now = new Date("2026-10-24T09:00:00Z")
const opts: ValidateOptions = { sizeBytes: 1000, userId: TEST_USER.id, now }

const reason = (raw: unknown, o: Partial<ValidateOptions> = {}) => {
  const res = validateEnvelope(raw, { ...opts, ...o })
  return res.ok ? null : res.reason
}

describe("validateEnvelope", () => {
  test("accepts a valid v1 envelope, extra X fields included", () => {
    const env = testEnvelope({
      data: [{ ...testPost("101", "2026-10-24T01:00:00Z"), edit_history_tweet_ids: ["101"] } as never],
    })
    const res = validateEnvelope(env, opts)
    expect(res.ok).toBe(true)
  })

  test("rejects files over 20 MB before anything else", () => {
    expect(reason(testEnvelope(), { sizeBytes: MAX_ENVELOPE_BYTES + 1 })).toContain("limit is 20 MB")
    expect(reason(testEnvelope(), { sizeBytes: MAX_ENVELOPE_BYTES })).toBeNull()
  })

  test("rejects other formats and unknown versions", () => {
    expect(reason({ ...testEnvelope(), format: "something-else" })).toContain("Unknown format")
    expect(reason({ ...testEnvelope(), version: 2 })).toContain("Unsupported export version 2")
    expect(reason([])).toContain("JSON object")
  })

  test("account id must match the configured user id", () => {
    const other = testEnvelope({ account: { ...TEST_USER, id: "2000000000000000002", username: "someone_else" } })
    expect(reason(other)).toContain("@someone_else")
    // With no user id configured yet, the first envelope's account is adopted.
    expect(reason(other, { userId: null })).toBeNull()
  })

  test("names the field that is wrong", () => {
    expect(reason(testEnvelope({ kind: "likes" as never }))).toStartWith("kind ")
    expect(reason(testEnvelope({ run: { ...testEnvelope().run, type: "weekly" as never } }))).toStartWith("run.type")
    expect(reason(testEnvelope({ data: [testPost("abc", "2026-10-24T01:00:00Z")] }))).toStartWith("data[0].id")
    expect(reason(testEnvelope({ data: [testPost("101", "yesterday")] }))).toStartWith("data[0].created_at")
    expect(
      reason(testEnvelope({ data: [testPost("101", "2026-10-24T01:00:00Z", 1, { public_metrics: { like_count: -1 } })] }))
    ).toStartWith("data[0].public_metrics.like_count")
    expect(reason({ ...testEnvelope(), complete: "yes" })).toStartWith("complete")
  })

  test("rejects windows that end before they start", () => {
    const env = testEnvelope({ window: { start_time: "2026-10-24T08:00:00Z", end_time: "2026-10-23T08:00:00Z" } })
    expect(reason(env)).toBe("window starts after it ends")
  })

  test("rejects fetched_at far in the future (it would block newer data)", () => {
    expect(reason(testEnvelope({ fetched_at: "2026-10-26T09:00:00Z" }))).toStartWith("fetched_at")
    expect(reason(testEnvelope({ fetched_at: "2026-10-24T20:00:00Z" }))).toBeNull()
  })

  test("mentions and inspiration posts need an author", () => {
    const { author_id: _drop, ...noAuthor } = testPost("101", "2026-10-24T01:00:00Z")
    expect(reason(testEnvelope({ kind: "mentions", data: [noAuthor] }))).toStartWith("data[0].author_id")
    expect(reason(testEnvelope({ kind: "posts", data: [noAuthor] }))).toBeNull()
  })
})
