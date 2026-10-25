import type { ApiPost, ApiUser, ExportEnvelope } from "../contract/envelope"

/*
 * Synthetic envelopes for tests. Never real account data: the ids, handle
 * and text are made up.
 */

export const TEST_USER: ApiUser = {
  id: "1000000000000000001",
  username: "synthetic_user",
  name: "Synthetic User",
  public_metrics: { followers_count: 100, following_count: 50, tweet_count: 10, listed_count: 1 },
}

export function testPost(
  id: string,
  createdAt: string,
  impressions = 100,
  extra: Partial<ApiPost> = {}
): ApiPost {
  return {
    id,
    text: `Synthetic post ${id}`,
    created_at: createdAt,
    author_id: TEST_USER.id,
    conversation_id: id,
    public_metrics: {
      impression_count: impressions,
      like_count: Math.round(impressions / 20),
      reply_count: 1,
      retweet_count: 0,
      quote_count: 0,
      bookmark_count: 0,
    },
    ...extra,
  }
}

export function testEnvelope(over: Partial<ExportEnvelope> = {}): ExportEnvelope {
  return {
    format: "xstats-export",
    version: 1,
    kind: "posts",
    run: { id: "r1", type: "light", trigger: "schedule", source: "test" },
    fetched_at: "2026-10-24T08:30:00Z",
    account: TEST_USER,
    window: { start_time: "2026-10-23T08:30:00Z", end_time: "2026-10-24T08:30:00Z" },
    complete: true,
    rate_limited: false,
    errors: [],
    data: [],
    ...over,
  }
}
