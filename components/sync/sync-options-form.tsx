"use client"

import { PlusIcon, XIcon } from "lucide-react"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SyncSettings } from "@/lib/settings"

import { saveSyncOptions, type ActionState } from "./actions"
import { BACKFILL_DAYS, FULL_REFRESH_DAYS, LIGHT_REFRESH_HOURS, MAX_REMINDERS } from "./options"
import { FormMessage } from "./form-message"

type Options = Pick<
  SyncSettings,
  "reminderTimes" | "backfillDays" | "fullRefreshDays" | "lightRefreshHours" | "refreshReplies"
>

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function OptionSelect({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select name={name} value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Reminder times and window sizes, saved to settings.sync. */
export function SyncOptionsForm({ initial, timeZone }: { initial: Options; timeZone: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSyncOptions, null)
  const [times, setTimes] = useState(initial.reminderTimes)
  const [backfill, setBackfill] = useState(String(initial.backfillDays))
  const [full, setFull] = useState(String(initial.fullRefreshDays))
  const [light, setLight] = useState(String(initial.lightRefreshHours))
  const [replies, setReplies] = useState<string>(initial.refreshReplies)

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Reminder times</legend>
        <div className="flex flex-wrap items-center gap-2">
          {times.map((t, i) => (
            <div key={i} className="flex items-center">
              <Input
                type="time"
                name="reminderTimes"
                value={t}
                required
                onChange={(e) => setTimes(times.map((v, j) => (j === i ? e.target.value : v)))}
                aria-label={`Reminder ${i + 1}`}
                className="w-28"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setTimes(times.filter((_, j) => j !== i))}
                aria-label={`Remove reminder ${i + 1}`}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          {times.length < MAX_REMINDERS ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setTimes([...times, "12:00"])}>
              <PlusIcon />
              Add
            </Button>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          Grok Bot runs the sync at these times ({timeZone}) and asks you to approve each import. A missed run is
          caught up by the next one.
        </span>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First import" hint="How far back the backfill and Refresh all reach.">
          <OptionSelect
            name="backfillDays"
            label="First import"
            value={backfill}
            onChange={setBackfill}
            options={BACKFILL_DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
          />
        </Field>
        <Field label="Daily full refresh" hint="The first run each day refreshes numbers on posts this recent.">
          <OptionSelect
            name="fullRefreshDays"
            label="Daily full refresh"
            value={full}
            onChange={setFull}
            options={FULL_REFRESH_DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
          />
        </Field>
        <Field label="Later runs" hint="Runs later the same day refresh this window.">
          <OptionSelect
            name="lightRefreshHours"
            label="Later runs"
            value={light}
            onChange={setLight}
            options={LIGHT_REFRESH_HOURS.map((h) => ({ value: String(h), label: `Last ${h} hours` }))}
          />
        </Field>
        <Field label="Replies" hint="New only saves X reads on reply-heavy accounts: new replies are still stored.">
          <OptionSelect
            name="refreshReplies"
            label="Replies"
            value={replies}
            onChange={setReplies}
            options={[
              { value: "all", label: "Refresh all replies" },
              { value: "new-only", label: "Store new replies only" },
            ]}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}
