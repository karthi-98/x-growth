import { APP_NAME } from "../../lib/app"
import { getLayout } from "../../lib/runtime/layout"
import { checkForUpdate } from "../../lib/runtime/releases"
import { applyUpdate, type UpdateOptions } from "../../lib/runtime/update"
import type { Command } from "../types"
import { flagString } from "../util"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
export const command: Command = {
  name: "update",
  summary: "Download, verify and install the latest release, then migrate",
  usage: [
    "(no args)              install the latest release if it's newer",
    "check                  only report whether a newer release exists",
    "--dry-run              download, verify and unpack it, but change nothing",
    "--from-file <archive>  install this bundle instead (checksum from SHA256SUMS next to it, or --sha256)",
    "--sha256 <hex>         expected checksum for --from-file",
    "--version <x.y.z>      install this version instead of the latest",
    "--force                reinstall even if it isn't newer",
    "--simulate-failure <migrate|start>   testing: fail on purpose to exercise the rollback",
    "--json                 print one JSON object",
  ],
  async run(args, out) {
    const sub = args.positionals[0]

    if (sub === "check") {
      const r = await checkForUpdate()
      const human = r.error
        ? `Could not check for updates: ${r.error}`
        : r.available
          ? `${APP_NAME} ${r.latest} is available (you have ${r.current}). Run "xstats update".`
          : r.latest
            ? `${APP_NAME} ${r.current} is up to date.`
            : `No release has been published yet (you have ${r.current}).`
      out.result({ status: r.error ? "error" : "ok", ...r }, human)
      return
    }

    // Internal step of an update: run this app folder's migrations in a fresh process.
    if (sub === "migrate") {
      const { runMigrations } = await import("../../lib/runtime/migrate")
      const r = await runMigrations(getLayout().migrations)
      out.result({ status: "ok", ...r }, `Applied ${r.applied} migration(s); ${r.total} in total.`)
      return
    }

    if (sub !== undefined) out.fail(`Unknown update subcommand "${sub}". Use "xstats update" or "xstats update check".`)

    const simulate = flagString(args, "simulate-failure")
    if (simulate !== undefined && simulate !== "migrate" && simulate !== "start") out.fail("--simulate-failure must be migrate or start.")
    const opts: UpdateOptions = {
      fromFile: flagString(args, "from-file"),
      sha256: flagString(args, "sha256"),
      version: flagString(args, "version"),
      dryRun: args.flags["dry-run"] === true,
      force: args.flags.force === true,
      simulateFailure: simulate as UpdateOptions["simulateFailure"],
      onProgress: out.json ? undefined : (line) => out.info(line),
    }
    const r = await applyUpdate(opts)
    const human = {
      "up-to-date": `${APP_NAME} ${r.from} is up to date${r.to && r.to !== r.from ? ` (latest is ${r.to})` : ""}.`,
      "dry-run": `Dry run: ${r.to} downloaded, verified and unpacked. A real update would: ${r.plan?.join(", ")}.`,
      updated: `Updated ${APP_NAME} ${r.from} → ${r.to}${r.url ? `; running at ${r.url}` : ""}.`,
      "rolled-back": `The update to ${r.to} failed and was rolled back: ${r.error}`,
    }[r.status]
    if (r.status === "rolled-back") out.fail(human, r)
    out.result(r, human)
  },
}
