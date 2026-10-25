# Installing and running X Growth

X Growth installs per user, without admin rights, on Windows, macOS and Linux. Grok Bot runs the
installer on the user's computer (the user approves it). The plan behind it is
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) sections 3, 9 and 10.

## What the installer does

1. Installs [Bun](https://bun.sh) for this user if it's missing (`~/.bun`, no admin).
2. Downloads the latest release bundle for this OS/arch from
   [GitHub Releases](https://github.com/karthi-98/x-growth/releases) and checks its SHA-256
   against the release's `SHA256SUMS`. A mismatch stops the install before anything changes.
3. Unpacks it to `<install dir>/app`. Data lives next to it in `<install dir>/data`, which updates
   never touch.
4. Runs `xstats setup` (data folders, migrations, handle and timezone), `xstats autostart enable`
   and `xstats start --detach`. If `setup` fails, the installer warns and carries on: `start`
   applies migrations by itself.
5. Opens `http://127.0.0.1:3000/setup`, where the user pastes their X and AI keys. The keys never
   pass through Grok Bot.

Running it again reinstalls over the existing copy and keeps the data. Use `xstats update` for
normal upgrades.

## Install commands (for Grok Bot)

Windows (PowerShell 5.1 or later):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://github.com/karthi-98/x-growth/releases/latest/download/install.ps1))) -Handle <handle> -TimeZone <IANA timezone> -Json"
```

macOS and Linux:

```bash
curl -fsSL https://github.com/karthi-98/x-growth/releases/latest/download/install.sh | bash -s -- --handle <handle> --timezone <IANA timezone> --json
```

With `-Json` / `--json` the last line of output is one JSON object:

```json
{"status":"installed","version":"0.2.0","app":"…\\XGrowth\\app","data":"…\\XGrowth\\data","inbox":"…\\XGrowth\\data\\inbox","cli":"…\\XGrowth\\app\\xstats.cmd","url":"http://127.0.0.1:3000/setup","setup":true,"autostart":true}
```

| Option (`install.ps1` / `install.sh`) | Does |
|---|---|
| `-Version` / `--version <x.y.z>` | Install that release instead of the latest |
| `-InstallDir` / `--install-dir <path>` | Folder that gets `app/` and `data/` |
| `-Port` / `--port <n>` | Port on 127.0.0.1 (default 3000; saved for later starts) |
| `-Handle`, `-TimeZone` / `--handle`, `--timezone` | Passed to `xstats setup` |
| `-FromFile` / `--from-file <archive>` | Install a local bundle (needs `SHA256SUMS` next to it) |
| `-NoAutostart`, `-NoStart`, `-NoOpen` / `--no-autostart`, `--no-start`, `--no-open` | Skip those steps |
| `-Json` / `--json` | End with one JSON object |

On Linux, Bun's installer needs `unzip`.

## Where things live

| | Windows | macOS | Linux |
|---|---|---|---|
| Install dir | `%LOCALAPPDATA%\XGrowth` | `~/Library/Application Support/XGrowth` | `${XDG_DATA_HOME:-~/.local/share}/XGrowth` |
| App (replaced by updates) | `…\app` | `…/app` | `…/app` |
| CLI | `…\app\xstats.cmd` | `…/app/xstats` | `…/app/xstats` |
| Data | `…\data` | `…/data` | `…/data` |
| Grok Bot drops files in | `…\data\inbox` | `…/data/inbox` | `…/data/inbox` |
| Logs | `…\data\logs` | `…/data/logs` | `…/data/logs` |
| Start at login | Startup folder shortcut `X Growth.lnk` | `~/Library/LaunchAgents/com.xgrowth.app.plist` | `~/.config/systemd/user/x-growth.service` (or `~/.config/autostart/x-growth.desktop`) |

The bundle finds its data folder by itself (`app/../data`). `XSTATS_DATA_DIR` overrides it, and so
does `--data-dir <path>` on any command.

## Commands

Every command takes `--json` and then prints exactly one JSON object.

| Command | Does |
|---|---|
| `xstats start` | Runs the web server (127.0.0.1 only) and the worker in the foreground |
| `xstats start --detach` | Starts them in the background and returns once the app answers (`--no-wait` returns at once) |
| `xstats start --port 3001 --runtime node` | Changes the port or what runs the server (`auto`, `bun`, `node`); both are saved in `data/runtime.json` |
| `xstats stop` | Stops the server and worker |
| `xstats autostart enable \| disable \| status` | Start at login, without admin rights |
| `xstats backup` / `xstats backup list` | Copies the database to `data/backups` now / lists the copies |
| `xstats update check` | Says whether a newer release exists |
| `xstats update` | Installs the latest release (see below) |
| `xstats update --dry-run` | Downloads, verifies and unpacks it, then stops without changing anything |
| `xstats update --from-file <archive>` | Installs a local bundle; the checksum comes from `SHA256SUMS` next to it, or `--sha256` |
| `xstats uninstall` | Stops the app, removes start at login and the app folder; keeps the data |
| `xstats uninstall --purge --yes` | Also deletes the data folder (database, backups, keys, logs) |

In a source checkout, run them as `bun run xstats <command>` after `bun run build`.

## How it runs

- **Launcher** (`xstats start`, `lib/runtime/launcher.ts`): one per data folder (lock in
  `data/run/xstats.lock`). It applies pending migrations, then runs two child processes:
  - the Next standalone server, bound to `127.0.0.1:<port>`
  - the worker (`worker/index.ts`)

  A child that crashes restarts after 1, 2, 5, 10, 30, then 60 seconds. A server that stops
  answering for 90 seconds is restarted. If the server can't start under Bun twice in a row and
  Node.js is installed, it switches to Node.
- **Stopping** works on every OS without signals: `xstats stop` writes `data/run/stop-request`, the
  launcher closes its children's stdin, and each child shuts down cleanly. A child whose launcher
  dies exits by itself for the same reason.
- **Logs** go to `data/logs/`: `xstats.log` (launcher), `server.log`, `worker.log`, `update.log`.
  They rotate at 5 MB and keep 5 old files.
- **Worker** (`worker/index.ts`): runs each job on its own schedule. A failing job backs off (up to
  15 minutes) without stopping the others. Each job's last run and error are in
  `data/run/worker-status.json`, which Settings → App shows.
- **Backups**: the worker makes a `VACUUM INTO` copy once a day (checked hourly, so a computer that
  was off catches up) and keeps the last 7. `xstats update` keeps the last 3 pre-update copies on top
  of those.
- **Localhost security** (`proxy.ts`): requests whose `Host` isn't `localhost` or `127.0.0.1` on
  our port get 421, which blocks DNS rebinding. POST and other changing requests must come from our
  own origin (`Origin`, or `Sec-Fetch-Site`), otherwise they get 403. Requests with neither header
  come from local programs, not web pages, and are allowed.

## Updates and rollback

`xstats update`:

1. Reads the latest **published** release from GitHub (drafts are never installed) and downloads the
   bundle for this platform plus `SHA256SUMS` into `data/updates/`.
2. Verifies the SHA-256 and refuses on a mismatch.
3. Unpacks it to `app.new` and checks it: `release.json`, platform, required files, and a newer
   version unless `--force`.
4. Backs up the database (`…-pre-update-<old version>.db`) and stops the app.
5. Swaps folders: `app` → `app.old`, `app.new` → `app`.
6. Runs the new version's migrations, then starts it and waits until it answers.
7. Deletes `app.old`. On Windows it's deleted by a helper once the update process has exited,
   because Windows won't delete a native library that is still loaded.

If step 6 fails, it rolls back: the new folder becomes `app.failed`, `app.old` goes back to
`app`, the database backup is restored, and the old version is started again if it was running.
`--simulate-failure migrate|start` forces this path for testing.

The update process never opens the database itself. On Windows, libSQL keeps a database file
locked until its process exits, which would make the restore impossible. The backup and migrations
run in child processes instead.

## Building a release

```bash
bun run build                                 # next.config.ts sets output: "standalone"
bun install/pack.ts                           # dist/x-growth-<version>-<platform>.zip|.tar.gz + dist/SHA256SUMS
bun install/pack.ts --version 0.1.1           # same build, another version (to test updates)
bun install/test-update.ts dist/x-growth-0.1.0-win-x64.zip dist/x-growth-0.1.1-win-x64.zip
```

`pack.ts` builds the bundle for the machine it runs on, because the libSQL native binary comes from
`node_modules`. It:

- copies Next's standalone server, its static files and `public/`
- adds the complete `@libsql/client` dependency set
- bundles the CLI and worker into `xstats.js` and `worker.js`
- adds `drizzle/`, `server-entry.mjs`, the `xstats` shim and `release.json`

It copies symlinks as real files, because Windows users can't create symlinks without admin rights
or Developer Mode. It refuses to pack if a database, `secrets.json` or `.env` file appears in the
standalone output: releases are public.

`test-update.ts` installs the first bundle into a temp folder and checks that:

- every page, a route handler and a 404 work, and the server never hit a missing module
- a foreign `Host` is rejected
- backup, the update dry run, both rollback paths, checksum refusal and a real update all work

[`.github/workflows/release.yml`](../.github/workflows/release.yml) does all of this on win-x64,
mac-arm64, mac-x64 and linux-x64:

- On a pull request that touches the runtime, or when started by hand, it builds and tests the
  bundles only.
- On a pushed tag `vX.Y.Z`, it also creates a **draft** release with the bundles, `install.ps1`,
  `install.sh` and `SHA256SUMS`. Users get nothing until a maintainer publishes the draft.

## Platform findings (spike S6 and others)

Tested on Windows 11 Home 26200, Bun 1.4.0, Next.js 16.4.3, `@libsql/client` 0.18, as a member of
the Administrators group running without elevation, in October 2026.

- **S6: the standalone server runs under Bun with libSQL's native binary.** Every page renders with
  real data, the same as under Node 25. Bun is the default, so users need no Node.js; Node is the
  fallback (`--runtime node`, or automatic after two failed starts under Bun).
- **The standalone trace needed three fixes:**
  - Next links the hashed external `.next/node_modules/@libsql/client-<hash>` as a symlink.
    `pack.ts` copies it as a real folder.
  - Next leaves out the route-handler runtime (`app-route-turbo.runtime.prod.js`), so
    `/favicon.ico` failed in a bundle. It worked in the repo only because Node fell back to the
    repo's `node_modules`. `outputFileTracingIncludes` adds it.
  - Listing `data/backups` made Turbopack trace the data folder. `outputFileTracingExcludes`
    removes `data/` and `dist/`, and `pack.ts` checks again before packing.
- **Start at login without admin:**
  - `schtasks /Create /SC ONLOGON` is denied without elevation.
  - `Register-ScheduledTask -AtLogOn -User <me>` worked unelevated here, but policy can block it
    for standard accounts.
  - The Startup-folder shortcut always works, so it's the one used. It runs `bun` minimized for
    under a second, and the background app has no window.
- **Background processes on Windows:**
  - A child inherits every inheritable handle. A detached launcher kept the pipe of whatever
    captured `xstats start --detach` open, so the installer never returned. The launcher is now
    started through `Start-Process` (ShellExecute), which passes no handles.
  - Hidden children show no window, even with Windows Terminal as the default console.
- **Files and folders on Windows:**
  - A folder can't be renamed while it is some process's working directory, so the update steps
    out of the app folder first.
  - A loaded native library (`.node`) can be renamed but not deleted, hence the delayed removal of
    `app.old`.
  - `cmd.exe` re-reads a batch file after each command, so `xstats.cmd` runs Bun on its last line,
    and an update that replaces the file can't confuse it.
- **Not yet verified on real machines:**
  - macOS and Linux login items (CI tests the bundles on all four platforms, but not login
    items)
  - Windows for a standard (non-admin) user
  - the installers downloading from a published release (none exists yet; `-FromFile` was
    tested)

## Troubleshooting

- **The app doesn't open.** Run `xstats start --detach` and read `data/logs/xstats.log` and
  `server.log`.
- **"Port 3000 is already in use".** Another program has the port. Run
  `xstats start --port 3001`; the new port is saved.
- **Undo an update by hand.** Copy the newest `data/backups/*-pre-update-*.db` over
  `data/x-stats.db` while the app is stopped, then reinstall that version with
  `install.ps1 -Version <x.y.z>` or `install.sh --version <x.y.z>`.
