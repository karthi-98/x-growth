import { APP_NAME } from "../../lib/app"
import { autostartStatus, disableAutostart, enableAutostart, type AutostartStatus } from "../../lib/runtime/autostart"
import { getLayout } from "../../lib/runtime/layout"
import type { Command } from "../types"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
const describe = (s: AutostartStatus) =>
  !s.supported
    ? `Autostart isn't supported on ${process.platform}.`
    : s.enabled
      ? `${APP_NAME} starts at login (${s.method}: ${s.path}).`
      : `${APP_NAME} does not start at login.`

export const command: Command = {
  name: "autostart",
  summary: "Enable or disable starting at login (enable, disable, status)",
  usage: [
    "enable    start at login (no admin rights needed)",
    "disable   stop starting at login (the running app keeps running)",
    "status    show whether it starts at login (default)",
    "--json    print one JSON object",
  ],
  async run(args, out) {
    const action = args.positionals[0] ?? "status"
    let status: AutostartStatus
    if (action === "enable") status = enableAutostart(getLayout())
    else if (action === "disable") status = disableAutostart()
    else if (action === "status") status = autostartStatus()
    else return out.fail(`Unknown action "${action}". Use enable, disable or status.`)
    out.result({ status: "ok", ...status }, describe(status))
  },
}
