import { APP_NAME } from "../../lib/app"
import { stopLauncher } from "../../lib/runtime/instance"
import type { Command } from "../types"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
export const command: Command = {
  name: "stop",
  summary: "Stop the running web server and worker",
  usage: ["--json   print one JSON object"],
  async run(_args, out) {
    const r = await stopLauncher()
    if (!r.wasRunning) {
      out.result({ status: "not-running" }, `${APP_NAME} isn't running.`)
      return
    }
    out.result({ status: "stopped", pid: r.pid, forced: r.forced }, r.forced ? "Stopped (it had to be forced)." : "Stopped.")
  },
}
