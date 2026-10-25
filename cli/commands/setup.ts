import path from "node:path"

import { CLI_NAME } from "../../lib/app"
import { isValidTimeZone } from "../../lib/dates"
import { paths } from "../../lib/paths"
import type { Command } from "../types"
import { flagString } from "../util"

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
const USER_ID_RE = /^\d{1,25}$/

export const command: Command = {
  name: "setup",
  summary: "Create data folders, run migrations, save handle/user id/timezone",
  usage: [
    `${CLI_NAME} setup --handle <x handle> --timezone <IANA zone> [--user-id <numeric id>] [--json]`,
    "Safe to run again: it only adds what's missing and updates the values you pass.",
    "Without --user-id, the first Grok Bot import fills it in.",
  ],
  async run(args, out) {
    const handle = flagString(args, "handle")?.replace(/^@/, "")
    const timeZone = flagString(args, "timezone")
    const userId = flagString(args, "user-id")
    if (handle !== undefined && !HANDLE_RE.test(handle)) {
      return out.fail(`"${handle}" isn't an X handle (letters, digits and _, up to 15).`)
    }
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      return out.fail(`"${timeZone}" isn't a timezone. Use an IANA name like Asia/Kolkata or Europe/London.`)
    }
    if (userId !== undefined && !USER_ID_RE.test(userId)) {
      return out.fail(`"${userId}" isn't a numeric X user id.`)
    }

    // Folders first: the database can't open until its folder exists.
    const { ensureDataDirs } = await import("../../lib/import/files")
    const dirs = ensureDataDirs()
    const { applyMigrations } = await import("../../lib/sync/migrations")
    const applied = await applyMigrations()

    const { readSettings, updateSettings } = await import("../../lib/settings")
    const current = await readSettings()
    if (current.userId && userId && current.userId !== userId) {
      return out.fail(
        `This app is already set up for X user id ${current.userId}. To switch accounts, start from a new data folder.`
      )
    }
    const settings = await updateSettings({
      ...(handle ? { handle } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(userId ? { userId } : {}),
    })

    let account: { id: string; username: string } | null = null
    if (settings.userId && settings.handle) {
      const { db } = await import("../../lib/db/client")
      const { accounts } = await import("../../lib/db/schema")
      account = { id: settings.userId, username: settings.handle }
      await db
        .insert(accounts)
        .values({ ...account, isPrimary: true, createdAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: accounts.id, set: { username: account.username, isPrimary: true } })
    }

    const missing = [!settings.handle && "--handle", !settings.userId && "--user-id (or the first import)"].filter(Boolean)
    out.result(
      {
        status: "ok",
        dataDir: path.resolve(paths.data),
        database: path.resolve(paths.database),
        folders: dirs.map((d) => path.resolve(d)),
        migrationsApplied: applied,
        settings: { handle: settings.handle, userId: settings.userId, timeZone: settings.timeZone },
        account,
        missing,
      },
      [
        `Data folder: ${path.resolve(paths.data)}`,
        `Database: ${applied ? `${applied} migration${applied === 1 ? "" : "s"} applied` : "up to date"}`,
        `Handle: ${settings.handle ? `@${settings.handle}` : "not set"}`,
        `User id: ${settings.userId ?? "not set (the first Grok Bot import fills it in)"}`,
        `Timezone: ${settings.timeZone}`,
        missing.length ? `Still missing: ${missing.join(", ")}` : "Setup complete.",
      ].join("\n")
    )
  },
}
