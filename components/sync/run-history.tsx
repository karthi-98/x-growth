import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SyncRun } from "@/lib/db/schema"
import { formatDateTime } from "@/lib/sync/format"

const statusLabel: Record<SyncRun["status"], string> = {
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
  skipped: "Skipped",
}

/** "posts", "mentions", "unknown", … from the sync_runs id prefix (lib/import/import.ts). */
const kindOf = (run: SyncRun) => run.id.split("-")[0]

function runLabel(run: SyncRun) {
  const kind = kindOf(run)
  if (kind === "unknown") return run.source === "inbox" ? "Inbox file" : "File import"
  if (run.source === "file") return "File import"
  return `${run.type}${kind === "posts" ? "" : ` · ${kind}`} · ${run.trigger}`
}

/** Recent sync_runs, newest first. */
export function RunHistory({ runs, timeZone }: { runs: SyncRun[]; timeZone: string }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No imports yet. They show up here after each sync.</p>
  }
  const when = (iso: string) => formatDateTime(iso, timeZone)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Window</TableHead>
          <TableHead className="text-right">Posts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="align-top">
            <TableCell className="whitespace-nowrap tabular-nums">{when(run.startedAt)}</TableCell>
            <TableCell className="whitespace-nowrap capitalize">{runLabel(run)}</TableCell>
            <TableCell className="max-w-72 whitespace-normal">
              <Badge
                variant={run.status === "failed" ? "destructive" : run.status === "ok" ? "secondary" : "outline"}
              >
                {statusLabel[run.status]}
              </Badge>
              {run.error ? (
                <p
                  className={cn(
                    "mt-1 line-clamp-2 text-xs",
                    run.status === "failed" ? "text-destructive" : "text-muted-foreground"
                  )}
                  title={run.error}
                >
                  {run.error}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
              {run.windowFrom && run.windowTo ? `${when(run.windowFrom)} – ${when(run.windowTo)}` : "—"}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap tabular-nums">
              {run.postsReceived ? (
                <>
                  {run.postsReceived.toLocaleString("en-US")}
                  <span className="text-muted-foreground"> · {run.postsNew.toLocaleString("en-US")} new</span>
                </>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
