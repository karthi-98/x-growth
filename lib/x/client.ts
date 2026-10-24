// Owner: compose workstream (docs/WORKSTREAMS.md). Replace the stub bodies.

/*
 * X API writes with the user's own OAuth 1.0a keys (lib/secrets.ts). Every
 * call records its cost with lib/spend.ts. Other workstreams never call X
 * directly: replies and posts go through the drafts queue (status
 * "scheduled", scheduled_at = now) and the publish job sends them.
 */

export type CreatePostInput = {
  text: string
  /** Post id this replies to (thread parts and replies). */
  replyToId?: string
  /** Post id this quotes. */
  quoteId?: string
}

export type CreatePostResult = { id: string; text: string }

export async function createPost(_input: CreatePostInput): Promise<CreatePostResult> {
  throw new Error("createPost is not implemented yet (owner: compose workstream)")
}

/** GET /2/users/me with the saved keys: checks them without posting. */
export async function verifyXKeys(): Promise<{ ok: true; id: string; username: string } | { ok: false; error: string }> {
  return { ok: false, error: "verifyXKeys is not implemented yet (owner: compose workstream)" }
}
