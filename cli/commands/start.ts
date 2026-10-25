import { APP_NAME } from "../../lib/app"
import { isValidPort, readRuntimeConfig, serverRuntimes, writeRuntimeConfig, type ServerRuntime } from "../../lib/runtime/config"
import { AlreadyRunningError, runLauncher, startDetached } from "../../lib/runtime/launcher"
import { getLayout } from "../../lib/runtime/layout"
import type { Command } from "../types"
import { flagString } from "../util"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
export const command: Command = {
  name: "start",
  summary: "Run the web server and the worker together (single instance)",
  usage: [
    "--detach        start in the background; returns once the app answers",
    "--no-wait       with --detach, return right away (used at login)",
    "--port <n>      port on 127.0.0.1, saved for next time (default 3000)",
    "--runtime <r>   what runs the web server: auto (Bun, else Node), bun or node; saved",
    "--json          print one JSON object",
  ],
  async run(args, out) {
    const portFlag = flagString(args, "port")
    const runtimeFlag = flagString(args, "runtime")
    const patch: { port?: number; runtime?: ServerRuntime } = {}
    if (portFlag !== undefined) {
      const port = Number(portFlag)
      if (!isValidPort(port)) out.fail(`--port must be a whole number from 1024 to 65535 (got "${portFlag}").`)
      patch.port = port
    }
    if (runtimeFlag !== undefined) {
      if (!serverRuntimes.includes(runtimeFlag as ServerRuntime)) out.fail(`--runtime must be one of ${serverRuntimes.join(", ")}.`)
      patch.runtime = runtimeFlag as ServerRuntime
    }
    const config = Object.keys(patch).length ? writeRuntimeConfig(patch) : readRuntimeConfig()
    const layout = getLayout()

    if (args.flags.detach === true) {
      const r = await startDetached({ layout, port: config.port, runtime: config.runtime, wait: args.flags["no-wait"] !== true })
      const human = {
        running: `${APP_NAME} is already running at ${r.url} (pid ${r.pid}).`,
        started: `${APP_NAME} is running at ${r.url} (pid ${r.pid}).`,
        starting: `${APP_NAME} is starting in the background (pid ${r.pid}); it will answer at ${r.url}.`,
      }[r.status]
      out.result(r, human)
      return
    }

    try {
      const code = await runLauncher({ layout, port: config.port, runtime: config.runtime, echo: !out.json })
      if (out.json) out.result({ status: code === 0 ? "stopped" : "failed", code })
      process.exit(code)
    } catch (err) {
      if (!(err instanceof AlreadyRunningError)) throw err
      out.result({ status: "running", url: err.state.url, pid: err.state.pid }, err.message)
    }
  },
}
