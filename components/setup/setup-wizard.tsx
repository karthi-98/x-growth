import { ArrowLeftIcon, ArrowRightIcon, CircleCheckIcon, CircleDashedIcon, LoaderCircleIcon } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/app"
import { getSetupStatus, type SetupStatus } from "@/lib/runtime/status"

import { AutoRefresh } from "./auto-refresh"
import { formatAgo, formatWhen } from "./format"
import { KeyStep } from "./key-step"
import { SetupStepper } from "./setup-stepper"
import { nextStep, parseStep, previousStep, stepHref, type SetupStepId } from "./steps"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function StepNav({ step, nextLabel = "Continue", primary = true }: { step: SetupStepId; nextLabel?: string; primary?: boolean }) {
  return (
    <CardFooter className="justify-between gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link href={stepHref(previousStep(step))}>
          <ArrowLeftIcon />
          Back
        </Link>
      </Button>
      <Button variant={primary ? "default" : "outline"} size="sm" asChild>
        <Link href={stepHref(nextStep(step))}>
          {nextLabel}
          <ArrowRightIcon />
        </Link>
      </Button>
    </CardFooter>
  )
}

function Welcome() {
  return (
    <>
      <CardHeader>
        <CardTitle>Welcome to {APP_NAME}</CardTitle>
        <CardDescription>
          {APP_NAME} runs on this computer. Grok Bot reads your X posts a few times a day and drops them into the app,
          and everything is stored here, in your own database.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>Your X API keys are used only to post, schedule and reply from the app.</li>
          <li>Your AI key is used only to help you write.</li>
          <li>Keys stay on this computer. Grok Bot never sees them.</li>
        </ul>
        <p className="text-muted-foreground">Both keys are optional for now: skip a step and add the key later in Settings.</p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button size="sm" asChild>
          <Link href={stepHref("x-keys")}>
            Get started
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </>
  )
}

const runBadge: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  partial: "secondary",
  failed: "destructive",
  skipped: "outline",
}

function FirstSync({ status }: { status: SetupStatus }) {
  const run = status.latestRun
  return (
    <>
      <CardHeader>
        <CardTitle>First sync</CardTitle>
        <CardDescription>
          Grok Bot fetches your last {status.backfillDays} days of posts and imports them here. Later runs keep the numbers fresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {run ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={runBadge[run.status] ?? "outline"}>{run.status}</Badge>
              <span className="font-medium">{run.type} import</span>
              <span className="text-muted-foreground">
                {formatWhen(run.finishedAt ?? run.startedAt, status.timeZone)} ({formatAgo(run.finishedAt ?? run.startedAt)})
              </span>
            </div>
            <p className="text-muted-foreground">
              {run.postsReceived} posts received: {run.postsNew} new, {run.postsUpdated} updated.
            </p>
            {run.error ? <p className="text-destructive">{run.error}</p> : null}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-muted-foreground">
            <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" />
            <p>
              Waiting for the first import. In Grok Bot, ask it to <span className="text-foreground">run the {APP_NAME} backfill</span>.
              This page updates by itself.
            </p>
          </div>
        )}
        {!run || run.status !== "ok" ? <AutoRefresh seconds={10} /> : null}
      </CardContent>
      <StepNav step="first-sync" nextLabel={run ? "Continue" : "Skip for now"} primary={!!run} />
    </>
  )
}

function Done({ status }: { status: SetupStatus }) {
  const items = [
    { label: "X API keys", done: status.hasXKeys, todo: "Add them in Settings when you want to post." },
    { label: "AI key", done: status.hasAiKey, todo: "Add it in Settings for writing help." },
    {
      label: "First sync",
      done: status.latestRun?.status === "ok" || status.latestRun?.status === "partial",
      todo: "Grok Bot hasn't imported your posts yet.",
    },
  ]
  const allDone = items.every((i) => i.done)
  return (
    <>
      <CardHeader>
        <CardTitle>{allDone ? "You're all set" : "Setup is finished for now"}</CardTitle>
        <CardDescription>
          Anything you skipped is in Settings, along with backups, updates and starting at login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              {item.done ? (
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-label="done" />
              ) : (
                <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="not yet" />
              )}
              <span>
                <span className="font-medium">{item.label}</span>
                {item.done ? null : <span className="text-muted-foreground"> · {item.todo}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">Settings</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/">
            Open the dashboard
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </>
  )
}

export async function SetupWizard({ searchParams }: { searchParams: SearchParams }) {
  const [params, status] = await Promise.all([searchParams, getSetupStatus()])
  const step = parseStep(params.step)
  const synced = status.latestRun?.status === "ok" || status.latestRun?.status === "partial"

  return (
    <div className="flex flex-col gap-6">
      <SetupStepper
        current={step}
        complete={{ welcome: step !== "welcome", "x-keys": status.hasXKeys, "ai-key": status.hasAiKey, "first-sync": synced }}
      />
      <Card>
        {step === "welcome" ? <Welcome /> : null}
        {step === "x-keys" ? (
          <>
            <CardHeader>
              <CardTitle>X API keys</CardTitle>
              <CardDescription>
                From your own X developer app with Read and Write access: API key and secret, access token and secret. They
                are used only to post. Checking them reads your profile (about $0.01) and posts nothing.
              </CardDescription>
            </CardHeader>
            <KeyStep kind="x" saved={status.hasXKeys} back={stepHref("welcome")} next={stepHref("ai-key")} />
          </>
        ) : null}
        {step === "ai-key" ? (
          <>
            <CardHeader>
              <CardTitle>AI key</CardTitle>
              <CardDescription>
                Pick a provider and paste its API key. It is used only for writing help and billed by the provider. A Grok
                subscription doesn&apos;t include xAI API credits.
              </CardDescription>
            </CardHeader>
            <KeyStep kind="ai" saved={status.hasAiKey} back={stepHref("x-keys")} next={stepHref("first-sync")} />
          </>
        ) : null}
        {step === "first-sync" ? <FirstSync status={status} /> : null}
        {step === "done" ? <Done status={status} /> : null}
      </Card>
    </div>
  )
}

export function SetupWizardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  )
}
