"use server"

import { refresh } from "next/cache"

import { disableAutostart, enableAutostart } from "./autostart"
import { createBackup } from "./backup"
import { getLayout } from "./layout"
import { checkForUpdate, type UpdateCheck } from "./releases"

/*
 * Server Actions for Settings → App. They only touch this computer (a backup
 * file, a login item, a GitHub version check). proxy.ts rejects cross-origin
 * and non-localhost requests before they get here.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const failed = (err: unknown): ActionResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) })

export async function backupNowAction(): Promise<ActionResult> {
  try {
    const made = await createBackup("manual")
    refresh()
    return { ok: true, message: `Saved ${made.name}` }
  } catch (err) {
    return failed(err)
  }
}

export async function setAutostartAction(enabled: boolean): Promise<ActionResult> {
  try {
    const status = enabled ? enableAutostart(getLayout()) : disableAutostart()
    refresh()
    return { ok: true, message: status.enabled ? "Starts at login" : "Doesn't start at login" }
  } catch (err) {
    return failed(err)
  }
}

export async function checkForUpdateAction(): Promise<UpdateCheck> {
  return checkForUpdate()
}
