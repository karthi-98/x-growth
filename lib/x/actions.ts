"use server"

import type { XKeys } from "../secrets"
import { verifyXKeys } from "./client"
import { removeXKeys, saveXKeys, xKeysStatus, type XKeysStatus } from "./keys"

/*
 * Server actions behind <XKeysForm>. They return masked status only; keys
 * are read and written on the server (data/secrets.json).
 */

export async function getXKeysStatusAction(): Promise<XKeysStatus> {
  return xKeysStatus()
}

export async function saveXKeysAction(
  input: Partial<Record<keyof XKeys, string>>
): Promise<{ ok: boolean; error?: string; status: XKeysStatus }> {
  const res = saveXKeys(input && typeof input === "object" ? input : {})
  return { ...res, status: xKeysStatus() }
}

export async function verifyXKeysAction(): Promise<
  { ok: true; username: string; dryRun?: boolean } | { ok: false; error: string }
> {
  const res = await verifyXKeys()
  return res.ok ? { ok: true, username: res.username, dryRun: res.dryRun } : res
}

export async function removeXKeysAction(): Promise<XKeysStatus> {
  removeXKeys()
  return xKeysStatus()
}
