import { spawnSync } from "node:child_process"

/* Windows helpers for the launcher and autostart. */

/** Quote one argument for a Windows command line (CommandLineToArgvW rules). */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
}

/**
 * Run a PowerShell script. Values go in as environment variables (read them
 * with $env:NAME) so nothing needs PowerShell quoting.
 */
export function runPowerShell(script: string, env: Record<string, string> = {}) {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  })
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim(), error: r.error }
}

/**
 * Start a program in the background with no handles from this process.
 * Windows children inherit every inheritable handle, including pipes our
 * caller reads (a script capturing `xstats start --detach`), and would hold
 * them open for as long as the app runs. Start-Process goes through
 * ShellExecute, which passes none. Returns the new process id.
 */
export function startHidden(bin: string, args: string[], cwd: string): number {
  const r = runPowerShell(
    "$p = Start-Process -FilePath $env:XG_BIN -ArgumentList $env:XG_ARGS -WorkingDirectory $env:XG_CWD -WindowStyle Hidden -PassThru; [Console]::Out.Write($p.Id)",
    { XG_BIN: bin, XG_ARGS: args.map(quoteWindowsArg).join(" "), XG_CWD: cwd }
  )
  const pid = Number(r.stdout)
  if (!r.ok || !Number.isInteger(pid) || pid <= 0) throw new Error(`Could not start the background process: ${r.stderr || r.error?.message}`)
  return pid
}
