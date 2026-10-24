"use server"

import { refresh } from "next/cache"

import { isAiError, type AiErrorCode } from "@/lib/ai/errors"
import { generateText, markGenerationAccepted } from "@/lib/ai/index"
import { parseReply, replyPrompt } from "@/lib/ai/prompts"
import { decodeXEntities } from "@/lib/ai/text"
import { getVoiceProfile } from "@/lib/voice/profile"

import { getMention, queueReply, ReplyError, setMentionHandled } from "./data"

/*
 * Replies inbox actions. Drafting only returns text for the user to edit;
 * only an explicit Send (with the user's final text) queues anything.
 */

const ID_RE = /^\d{1,25}$/
const GEN_RE = /^[0-9a-f-]{36}$/i

export type DraftReplyResult =
  | { ok: true; text: string; generationId: string; estCostUsd: number; model: string }
  | { ok: false; error: string; code?: AiErrorCode }

export async function draftReply(mentionId: string): Promise<DraftReplyResult> {
  if (typeof mentionId !== "string" || !ID_RE.test(mentionId)) return { ok: false, error: "Unknown mention." }
  const mention = await getMention(mentionId)
  if (!mention) return { ok: false, error: "That mention isn't in your inbox any more." }

  try {
    const voice = await getVoiceProfile()
    const prompt = replyPrompt(
      {
        mention: {
          author: mention.authorUsername ? `@${mention.authorUsername}` : (mention.authorName ?? "someone"),
          text: decodeXEntities(mention.text),
        },
        repliedTo: mention.repliedTo ? { text: decodeXEntities(mention.repliedTo.text), mine: mention.repliedTo.mine } : null,
        thread: mention.thread.map((p) => ({ author: p.author, text: decodeXEntities(p.text), mine: p.mine })),
      },
      voice
    )
    const out = await generateText({ kind: "reply", ...prompt })
    const text = parseReply(out.text, mention.authorUsername)
    if (!text) return { ok: false, error: "The model didn't return a usable reply. Try again.", code: "provider" }
    return { ok: true, text, generationId: out.generationId, estCostUsd: out.estCostUsd, model: out.model }
  } catch (err) {
    if (isAiError(err)) return { ok: false, error: err.message, code: err.code }
    console.error("[replies] draft failed:", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't draft a reply. Try again." }
  }
}

export type SendReplyResult = { ok: true; estCostUsd: number } | { ok: false; error: string }

/** Queue the user's (possibly edited) reply for the publish job. */
export async function sendReply(input: {
  mentionId: string
  text: string
  /** Set when the text started as an AI draft. */
  generationId?: string | null
}): Promise<SendReplyResult> {
  if (typeof input?.mentionId !== "string" || !ID_RE.test(input.mentionId)) return { ok: false, error: "Unknown mention." }
  if (typeof input.text !== "string") return { ok: false, error: "Write a reply first." }
  const generationId = typeof input.generationId === "string" && GEN_RE.test(input.generationId) ? input.generationId : null

  try {
    const { estCostUsd } = await queueReply({ mentionId: input.mentionId, text: input.text, fromAi: !!generationId })
    if (generationId) await markGenerationAccepted(generationId)
    refresh()
    return { ok: true, estCostUsd }
  } catch (err) {
    if (err instanceof ReplyError) return { ok: false, error: err.message }
    console.error("[replies] send failed:", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't queue the reply. Try again." }
  }
}

export async function markHandled(mentionId: string, handled: boolean): Promise<void> {
  if (typeof mentionId !== "string" || !ID_RE.test(mentionId)) return
  await setMentionHandled(mentionId, handled === true)
  refresh()
}
