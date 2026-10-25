import { Suspense } from "react"

import { AutostartToggle, BackupNowButton, UpdateCheckButton } from "@/components/setup/app-controls"
import { formatAgo, formatMb, formatWhen } from "@/components/setup/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getSettings } from "@/lib/get-settings"
import { getAppInfo } from "@/lib/runtime/status"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

const Path = ({ children }: { children: string }) => (
  <code className="w-fit max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground" title={children}>
    {children}
  </code>
)

async function AppDetails() {
  const [info, settings] = await Promise.all([getAppInfo(), getSettings()])
  const tz = settings.timeZone
  const when = (iso: string) => `${formatWhen(iso, tz)} (${formatAgo(iso)})`
  const jobs = info.worker ? Object.entries(info.worker.jobs) : []

  return (
    <div className="flex flex-col gap-5">
      <Row label="Version">
        <span>
          {info.version} · {info.platform ?? "unknown platform"} · {info.serverRuntime}
          {info.kind === "source" ? " · development checkout" : ""}
        </span>
        <UpdateCheckButton />
      </Row>

      <Row label="Running">
        {info.launcher ? (
          <span>
            At {info.launcher.url} since {when(info.launcher.startedAt)}
          </span>
        ) : (
          <span>Not under the launcher (started some other way, e.g. a dev server). Use <code className="font-mono">xstats start</code>.</span>
        )}
      </Row>

      <Row label="Start at login">
        <span>
          {!info.autostart.supported
            ? "Not supported on this system."
            : info.autostart.enabled
              ? "On. The app starts when you log in."
              : "Off. Start it yourself with xstats start."}
        </span>
        {info.autostart.supported ? <AutostartToggle enabled={info.autostart.enabled} /> : null}
      </Row>

      <Row label="Background jobs">
        {jobs.length === 0 ? (
          <span>The worker hasn&apos;t run yet.</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {!info.worker?.alive ? <li className="text-destructive">The worker isn&apos;t running.</li> : null}
            {jobs.map(([name, job]) => (
              <li key={name} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-foreground">{name}</span>
                {job.lastError ? (
                  <Badge variant="destructive" title={job.lastError}>
                    failing ({job.failures})
                  </Badge>
                ) : null}
                <span>{job.lastOkAt ? `last ok ${formatAgo(job.lastOkAt)}` : "not run yet"}</span>
              </li>
            ))}
          </ul>
        )}
      </Row>

      <Row label="Backups">
        {info.backups.length === 0 ? (
          <span>None yet. The app backs up the database once a day and keeps the last 7.</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {info.backups.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-2">
                <span className="text-foreground">{formatWhen(b.createdAt, tz)}</span>
                <span>{formatMb(b.size)}</span>
                {b.kind !== "daily" ? <Badge variant="secondary">{b.kind === "pre-update" ? `before update from ${b.label}` : "manual"}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        <BackupNowButton />
      </Row>

      <Row label="Folders">
        <span>Data (database, keys, backups, logs):</span>
        <Path>{info.dataDir}</Path>
        <span>App:</span>
        <Path>{info.appDir}</Path>
      </Row>
    </div>
  )
}

function AppDetailsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function AppSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>App</CardTitle>
        <CardDescription>Version, updates, start at login and backups</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<AppDetailsSkeleton />}>
          <AppDetails />
        </Suspense>
      </CardContent>
    </Card>
  )
}
