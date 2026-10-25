import { accessSync, constants, existsSync } from "node:fs"
import path from "node:path"

import { APP_NAME, CLI_NAME } from "../../lib/app"
import { isValidTimeZone } from "../../lib/dates"
import { paths } from "../../lib/paths"
import { hasAiKey, hasXKeys, readSecrets } from "../../lib/secrets"
import type { Command } from "../types"

type Level = "ok" | "warn" | "error"
type Check = { id: string; level: Level; title: string; detail: string; fix?: string }

const MIN_BUN = [1, 1]

function writable(dir: string) {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Keys are reported as present or missing, never shown (docs/ARCHITECTURE.md section 10). */
export const command: Command = {
  name: "doctor",
  summary: "Check runtime, folders, DB, settings and keys; explain problems",
  usage: [`${CLI_NAME} doctor [--json]   exits with 1 when something needs fixing`],
  async run(_args, out) {
    const checks: Check[] = []
    const add = (c: Check) => checks.push(c)
    const setup = `Run "${CLI_NAME} setup --handle <handle> --timezone <zone>".`

    const bun = process.versions.bun
    const [major, minor] = (bun ?? "0.0").split(".").map(Number)
    const bunOk = !!bun && (major > MIN_BUN[0] || (major === MIN_BUN[0] && minor >= MIN_BUN[1]))
    add({
      id: "runtime",
      level: bunOk ? "ok" : "error",
      title: "Runtime",
      detail: bun ? `Bun ${bun} on ${process.platform} ${process.arch}` : `Node ${process.version}, not Bun`,
      fix: bunOk ? undefined : `${APP_NAME} needs Bun ${MIN_BUN.join(".")} or newer. Install it from https://bun.sh and run again.`,
    })

    const dataDir = path.resolve(paths.data)
    const dataOk = existsSync(paths.data) && writable(paths.data)
    add({
      id: "data-folder",
      level: dataOk ? "ok" : "error",
      title: "Data folder",
      detail: existsSync(paths.data)
        ? dataOk
          ? dataDir
          : `${dataDir} exists but can't be written to.`
        : `${dataDir} doesn't exist yet.`,
      fix: dataOk ? undefined : existsSync(paths.data) ? "Check the folder's permissions." : setup,
    })
    const folders = { inbox: paths.inbox, processed: paths.processed, failed: paths.failed, backups: paths.backups, logs: paths.logs }
    const missingFolders = Object.entries(folders).filter(([, dir]) => !existsSync(dir)).map(([name]) => name)
    if (dataOk) {
      add({
        id: "folders",
        level: missingFolders.length ? "warn" : "ok",
        title: "Folders",
        detail: missingFolders.length ? `Missing: ${missingFolders.join(", ")}.` : "inbox, processed, failed, backups and logs are in place.",
        fix: missingFolders.length ? setup : undefined,
      })
    }

    const secrets = readSecrets()
    const dbExists = existsSync(paths.database)
    if (!dbExists) {
      add({ id: "database", level: "error", title: "Database", detail: `No database at ${path.resolve(paths.database)}.`, fix: setup })
    } else if (dataOk) {
      try {
        const { sql } = await import("drizzle-orm")
        const { db } = await import("../../lib/db/client")
        const { pendingMigrations } = await import("../../lib/sync/migrations")
        const pending = await pendingMigrations()
        add({
          id: "migrations",
          level: pending ? "error" : "ok",
          title: "Database updates",
          detail: pending ? `${pending} update${pending === 1 ? "" : "s"} not applied yet.` : "Up to date.",
          fix: pending ? `Run "${CLI_NAME} setup"; it applies them and keeps your data.` : undefined,
        })
        if (!pending) {
          const row = await db.get<{ n: number }>(sql`select count(*) as n from posts`)
          add({ id: "database", level: "ok", title: "Database", detail: `${Number(row?.n ?? 0).toLocaleString("en-US")} posts stored.` })

          const { readSettings } = await import("../../lib/settings")
          const settings = await readSettings()
          const missing = [!settings.handle && "X handle", !settings.userId && "X user id"].filter(Boolean)
          add({
            id: "settings",
            level: missing.length ? "warn" : "ok",
            title: "Settings",
            detail: missing.length
              ? `Not set yet: ${missing.join(" and ")}. Timezone ${settings.timeZone}.`
              : `@${settings.handle} (id ${settings.userId}), timezone ${settings.timeZone}.`,
            fix: missing.length
              ? `${setup} The user id is also filled in by the first Grok Bot import.`
              : undefined,
          })
          if (!isValidTimeZone(settings.timeZone)) {
            add({ id: "timezone", level: "error", title: "Timezone", detail: `"${settings.timeZone}" isn't a timezone.`, fix: setup })
          }

          const { isReminderTime } = await import("../../lib/sync/window")
          const times = settings.sync.reminderTimes
          const bad = times.filter((t) => !isReminderTime(t))
          add({
            id: "reminders",
            level: bad.length ? "error" : times.length ? "ok" : "warn",
            title: "Reminders",
            detail: bad.length
              ? `Not valid times: ${bad.join(", ")} (use HH:mm, 24-hour).`
              : times.length
                ? `${times.join(", ")} (${settings.timeZone}).`
                : "No reminder times set, so nothing syncs automatically.",
            fix: bad.length || !times.length ? "Fix the reminder times in Settings > Sync." : undefined,
          })

          const webhookUrl = !!settings.sync.webhookUrl
          const webhookKey = !!secrets.grokBotWebhookKey
          add({
            id: "webhook",
            level: webhookUrl === webhookKey ? "ok" : "warn",
            title: "Sync now webhook",
            detail:
              webhookUrl && webhookKey
                ? "URL and key saved."
                : webhookUrl || webhookKey
                  ? `Only the ${webhookUrl ? "URL" : "key"} is saved, so Sync now stays off.`
                  : "Not set up (optional).",
            fix: webhookUrl !== webhookKey ? "Add the missing part in Settings > Sync." : undefined,
          })

          const { getSyncStatus } = await import("../../lib/sync/status")
          const { timeAgo } = await import("../../lib/sync/format")
          const status = await getSyncStatus(new Date(), settings)
          const syncLevel: Level = status.health === "ok" || status.health === "partial" ? "ok" : "warn"
          const syncDetail: Record<typeof status.health, string> = {
            never: "No sync yet.",
            ok: `Synced ${status.syncedAt ? timeAgo(status.syncedAt) : ""}.`,
            partial: `Synced ${status.syncedAt ? timeAgo(status.syncedAt) : ""}; the last run stopped early and the next one continues.`,
            backfill: "The first 90-day import (backfill) hasn't finished.",
            stale: `Last complete sync ${status.syncedAt ? timeAgo(status.syncedAt) : "long ago"}.`,
            failing: `The last import failed: ${status.lastRun?.error ?? "unknown error"}`,
          }
          const syncFix: Partial<Record<typeof status.health, string>> = {
            never: "Ask Grok Bot to run the X Growth backfill.",
            backfill: "Ask Grok Bot to run the X Growth backfill again; it continues where it stopped.",
            stale: "Grok Bot may have paused the X Growth routines after a quiet stretch. Open Grok Bot and resume them.",
            failing: "Ask Grok Bot to run the sync again. If it keeps failing, check the file in data/failed/ and its .error.txt.",
          }
          add({ id: "sync", level: syncLevel, title: "Sync", detail: syncDetail[status.health], fix: syncFix[status.health] })
        }
      } catch (err) {
        add({
          id: "database",
          level: "error",
          title: "Database",
          detail: `Can't open it: ${err instanceof Error ? err.message : String(err)}`,
          fix: `Close other programs using ${path.basename(paths.database)} and try again. If it says the file is damaged, restore one from data/backups.`,
        })
      }
    }

    if (dataOk) {
      const { listFailed, listInbox } = await import("../../lib/import/files")
      const waiting = listInbox({ minAgeMs: 10 * 60_000 })
      add({
        id: "inbox",
        level: waiting.length ? "warn" : "ok",
        title: "Inbox",
        detail: waiting.length ? `${waiting.length} file${waiting.length === 1 ? "" : "s"} waiting for over 10 minutes.` : "Nothing waiting.",
        fix: waiting.length ? `Run "${CLI_NAME} import --inbox".` : undefined,
      })
      const weekAgo = Date.now() - 7 * 24 * 3_600_000
      const failed = listFailed().filter((f) => f.at.getTime() >= weekAgo)
      add({
        id: "failed",
        level: failed.length ? "warn" : "ok",
        title: "Rejected files",
        detail: failed.length
          ? `${failed.length} in the last 7 days. Latest: ${path.basename(failed[0].file)}: ${failed[0].reason || "see its .error.txt"}`
          : "None in the last 7 days.",
        fix: failed.length ? "Grok Bot wrote a file the app couldn't read. Ask it to run the sync again." : undefined,
      })
    }

    add({
      id: "x-keys",
      level: hasXKeys(secrets) ? "ok" : "warn",
      title: "X API keys",
      detail: hasXKeys(secrets) ? "Saved." : "Not saved yet. Only needed to post.",
      fix: hasXKeys(secrets) ? undefined : "Paste your X API keys in Settings when you want to post from the app.",
    })
    add({
      id: "ai-key",
      level: hasAiKey(secrets) ? "ok" : "warn",
      title: "AI key",
      detail: hasAiKey(secrets) ? `Saved (${secrets.ai!.provider}).` : "Not saved yet. Only needed for AI writing.",
      fix: hasAiKey(secrets) ? undefined : "Paste an AI key in Settings when you want writing help.",
    })

    const level: Level = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : "ok"
    const mark: Record<Level, string> = { ok: "[ok]  ", warn: "[warn]", error: "[fail]" }
    out.result(
      { status: level, checks },
      [
        ...checks.map((c) => `${mark[c.level]} ${c.title}: ${c.detail}${c.fix ? `\n       ${c.fix}` : ""}`),
        "",
        level === "ok" ? "Everything looks good." : level === "warn" ? "Working, with notes above." : "Something needs fixing (see [fail] above).",
      ].join("\n")
    )
    if (level === "error") process.exitCode = 1
  },
}
