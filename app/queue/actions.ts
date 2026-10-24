"use server"

import { refresh } from "next/cache"

import { publishNow } from "@/lib/publish"
import { deleteDraft, markDraftPosted, rescheduleDraft, unscheduleDraft } from "@/lib/publish/drafts"

export type QueueActionResult = { ok: boolean; error?: string; message?: string }

const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 64

/** Post now (missed / scheduled) or Retry (needs-check / failed): sends right away. */
export async function postNowAction(id: string): Promise<QueueActionResult> {
  if (!validId(id)) return { ok: false, error: "Unknown post." }
  const out = await publishNow(id)
  refresh()
  if (out.status === "published") return { ok: true, message: "Posted." }
  return { ok: false, error: out.error ?? `Not posted (${out.status}).` }
}

export async function rescheduleAction(id: string, local: string): Promise<QueueActionResult> {
  if (!validId(id) || typeof local !== "string") return { ok: false, error: "Unknown post." }
  const out = await rescheduleDraft(id, local.slice(0, 16))
  refresh()
  return out
}

/** Missed / scheduled / failed → back to drafts. */
export async function unscheduleAction(id: string): Promise<QueueActionResult> {
  if (!validId(id)) return { ok: false, error: "Unknown post." }
  await unscheduleDraft(id)
  refresh()
  return { ok: true }
}

export async function markPostedAction(id: string): Promise<QueueActionResult> {
  if (!validId(id)) return { ok: false, error: "Unknown post." }
  await markDraftPosted(id)
  refresh()
  return { ok: true }
}

export async function deleteAction(id: string): Promise<QueueActionResult> {
  if (!validId(id)) return { ok: false, error: "Unknown post." }
  await deleteDraft(id)
  refresh()
  return { ok: true }
}
