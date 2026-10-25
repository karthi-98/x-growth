import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP_NAME } from "../app"
import type { Layout } from "./layout"
import { absoluteDataDir } from "./paths"
import { bunPath } from "./platform"
import { quoteWindowsArg, runPowerShell } from "./windows"

/*
 * Start the app at login, per user and without admin rights:
 *   Windows  a shortcut in the Startup folder (runs `xstats start --detach`,
 *            minimized; the background launcher has no window). A scheduled
 *            task needs admin for `schtasks /SC ONLOGON` and may be blocked
 *            by policy for standard users, so it isn't used.
 *   macOS    a LaunchAgent in ~/Library/LaunchAgents (runs `xstats start`).
 *   Linux    a systemd user unit, or an XDG autostart entry when systemd
 *            --user isn't available.
 * Every entry passes --data-dir, because a login item can't set environment
 * variables on every OS.
 */

export type AutostartMethod = "startup-folder" | "launch-agent" | "systemd-user" | "xdg-autostart"

export type AutostartStatus = {
  supported: boolean
  enabled: boolean
  method: AutostartMethod | null
  /** The file that makes it start at login. */
  path: string | null
}

export const LAUNCH_AGENT_LABEL = "com.xgrowth.app"
export const SYSTEMD_UNIT = "x-growth.service"

type LoginCommand = { bin: string; args: string[]; cwd: string; dataDir: string }

function loginCommand(layout: Layout, detach: boolean): LoginCommand {
  const bin = bunPath()
  if (!bin) throw new Error("Bun was not found. Install it from https://bun.sh and try again.")
  const dataDir = absoluteDataDir()
  const args = [layout.cli, "start", ...(detach ? ["--detach", "--no-wait"] : []), "--data-dir", dataDir]
  return { bin, args, cwd: layout.appDir, dataDir }
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true })
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), error: r.error }
}

// --- Windows ---------------------------------------------------------------

const startupFolder = () =>
  path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")

const shortcutPath = () => path.join(startupFolder(), `${APP_NAME}.lnk`)

function enableWindows(cmd: LoginCommand) {
  mkdirSync(startupFolder(), { recursive: true })
  const r = runPowerShell(
    [
      "$ErrorActionPreference = 'Stop'",
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:XG_LNK)",
      "$s.TargetPath = $env:XG_TARGET",
      "$s.Arguments = $env:XG_ARGS",
      "$s.WorkingDirectory = $env:XG_CWD",
      "$s.WindowStyle = 7",
      "$s.Description = $env:XG_DESC",
      "$s.Save()",
    ].join("\n"),
    {
      XG_LNK: shortcutPath(),
      XG_TARGET: cmd.bin,
      XG_ARGS: cmd.args.map(quoteWindowsArg).join(" "),
      XG_CWD: cmd.cwd,
      XG_DESC: `Starts ${APP_NAME} at login`,
    }
  )
  if (!r.ok || !existsSync(shortcutPath())) throw new Error(`Could not create the Startup shortcut: ${r.stderr || r.error?.message}`)
}

// --- macOS -----------------------------------------------------------------

const launchAgentPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function launchAgentPlist(cmd: LoginCommand): string {
  const strings = (items: string[]) => items.map((s) => `    <string>${xml(s)}</string>`).join("\n")
  const log = path.join(cmd.dataDir, "logs", "launchd.log")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([cmd.bin, ...cmd.args])}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(cmd.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XSTATS_DATA_DIR</key>
    <string>${xml(cmd.dataDir)}</string>
    <key>PATH</key>
    <string>${xml(process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`
}

// --- Linux -----------------------------------------------------------------

const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
const unitPath = () => path.join(configHome(), "systemd", "user", SYSTEMD_UNIT)
const desktopPath = () => path.join(configHome(), "autostart", "x-growth.desktop")

const hasSystemdUser = () => run("systemctl", ["--user", "show-environment"]).ok

/** Quote for a systemd ExecStart= or a .desktop Exec= line. */
const quoteExec = (arg: string) => `"${arg.replace(/(["\\`$])/g, "\\$1")}"`

function systemdUnit(cmd: LoginCommand): string {
  const unitArg = (s: string) => quoteExec(s).replace(/%/g, "%%")
  return `[Unit]
Description=${APP_NAME} (local web app and worker)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${cmd.cwd}
Environment=${unitArg(`XSTATS_DATA_DIR=${cmd.dataDir}`)}
ExecStart=${[cmd.bin, ...cmd.args].map(unitArg).join(" ")}
Restart=on-failure
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=default.target
`
}

function desktopEntry(cmd: LoginCommand): string {
  return `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Starts ${APP_NAME} at login
Exec=${[cmd.bin, ...cmd.args].map(quoteExec).join(" ")}
Path=${cmd.cwd}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`
}

// --- API -------------------------------------------------------------------

export function autostartStatus(): AutostartStatus {
  switch (process.platform) {
    case "win32": {
      const file = shortcutPath()
      return { supported: true, enabled: existsSync(file), method: "startup-folder", path: file }
    }
    case "darwin": {
      const file = launchAgentPath()
      return { supported: true, enabled: existsSync(file), method: "launch-agent", path: file }
    }
    case "linux": {
      if (existsSync(unitPath())) {
        const enabled = run("systemctl", ["--user", "is-enabled", SYSTEMD_UNIT]).out === "enabled"
        return { supported: true, enabled, method: "systemd-user", path: unitPath() }
      }
      if (existsSync(desktopPath())) return { supported: true, enabled: true, method: "xdg-autostart", path: desktopPath() }
      return { supported: true, enabled: false, method: null, path: null }
    }
    default:
      return { supported: false, enabled: false, method: null, path: null }
  }
}

/** Register (or re-register, e.g. after the app moved) the login item. */
export function enableAutostart(layout: Layout): AutostartStatus {
  switch (process.platform) {
    case "win32":
      enableWindows(loginCommand(layout, true))
      break
    case "darwin": {
      // launchd runs it in the foreground and loads it at the next login;
      // nothing is started now (the app may already be running).
      const file = launchAgentPath()
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, launchAgentPlist(loginCommand(layout, false)))
      break
    }
    case "linux": {
      if (hasSystemdUser()) {
        mkdirSync(path.dirname(unitPath()), { recursive: true })
        writeFileSync(unitPath(), systemdUnit(loginCommand(layout, false)))
        run("systemctl", ["--user", "daemon-reload"])
        const r = run("systemctl", ["--user", "enable", SYSTEMD_UNIT])
        if (!r.ok) throw new Error(`systemctl --user enable failed: ${r.out}`)
        rmSync(desktopPath(), { force: true })
      } else {
        mkdirSync(path.dirname(desktopPath()), { recursive: true })
        writeFileSync(desktopPath(), desktopEntry(loginCommand(layout, true)))
      }
      break
    }
    default:
      throw new Error(`Autostart isn't supported on ${process.platform}.`)
  }
  return autostartStatus()
}

/** Remove the login item. The running app keeps running. */
export function disableAutostart(): AutostartStatus {
  switch (process.platform) {
    case "win32":
      rmSync(shortcutPath(), { force: true })
      break
    case "darwin":
      rmSync(launchAgentPath(), { force: true })
      break
    case "linux":
      if (existsSync(unitPath())) {
        run("systemctl", ["--user", "disable", SYSTEMD_UNIT])
        rmSync(unitPath(), { force: true })
        run("systemctl", ["--user", "daemon-reload"])
      }
      rmSync(desktopPath(), { force: true })
      break
  }
  return autostartStatus()
}
