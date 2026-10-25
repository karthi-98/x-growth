"use client"

import { CheckIcon, LocateFixedIcon } from "lucide-react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { startTransition, useActionState, useId, useState, useSyncExternalStore } from "react"

import { saveGeneralSettings } from "@/components/settings/general-actions"
import {
  normalizeTimeZone,
  PAY_PERIOD_LIMITS,
  validateGeneralSettings,
  type GeneralErrors,
  type GeneralField,
  type GeneralFormState,
} from "@/components/settings/general-validate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { dateKeyIn } from "@/lib/dates"
import { formatPostDate, timeZoneAbbr } from "@/lib/format"
import { payoutLabel, payPeriodFor, payPeriodRangeLabel } from "@/lib/pay-periods"
import type { PayPeriodSettings } from "@/lib/settings"

const INITIAL: GeneralFormState = { status: "idle", errors: {} }

// Client-only values (the clock, the browser's zone) read after hydration,
// so the server render and the first client render match.
const subscribeMinute = (onChange: () => void) => {
  const id = setInterval(onChange, 30_000)
  return () => clearInterval(id)
}
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000
const useNow = () => useSyncExternalStore(subscribeMinute, minuteNow, () => null)
const noSubscribe = () => () => {}
const useBrowserZone = () =>
  useSyncExternalStore(noSubscribe, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => null)

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** aria wiring for an input whose Field shows an error or a hint. */
const described = (id: string, error?: string, hint?: boolean) => ({
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
})

export function GeneralForm({
  handle,
  userId,
  timeZone,
  payPeriod,
  defaultPayPeriod,
  zones,
}: {
  handle: string | null
  userId: string | null
  timeZone: string
  payPeriod: PayPeriodSettings | null
  /** Pre-filled when pay periods are turned on from off. */
  defaultPayPeriod: PayPeriodSettings
  /** Zone names the server knows (it buckets the data, so its list wins). */
  zones: string[]
}) {
  const uid = useId()
  const ids = {
    handle: `${uid}-handle`,
    userId: `${uid}-user`,
    timeZone: `${uid}-tz`,
    zones: `${uid}-zones`,
    pay: `${uid}-pay`,
    anchor: `${uid}-anchor`,
    days: `${uid}-days`,
    payoutOffsetDays: `${uid}-offset`,
  }
  const defaults = payPeriod ?? defaultPayPeriod

  const [state, formAction, pending] = useActionState(saveGeneralSettings, INITIAL)
  const [clientErrors, setClientErrors] = useState<GeneralErrors | null>(null)
  const [values, setValues] = useState({
    handle: handle ?? "",
    timeZone,
    payPeriodEnabled: payPeriod !== null,
    anchor: defaults.anchor,
    days: String(defaults.days),
    payoutOffsetDays: String(defaults.payoutOffsetDays),
  })
  const now = useNow()
  // Browsers may report an old name (Chrome: "Asia/Calcutta"); offer the current one.
  const rawBrowserZone = useBrowserZone()
  const browserZone = rawBrowserZone ? normalizeTimeZone(rawBrowserZone, zones) : null

  // After a save, show the stored spelling of what was typed.
  const [shownSave, setShownSave] = useState(state.savedAt)
  if (state.savedAt !== shownSave) {
    setShownSave(state.savedAt)
    const { saved } = state
    if (saved) setValues((v) => ({ ...v, handle: saved.handle ?? "", timeZone: saved.timeZone }))
  }

  // Client checks show until the next submit; then the server's answer wins.
  const errors: GeneralErrors = clientErrors ?? state.errors
  const set = (key: keyof typeof values) => (value: string | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    setClientErrors((prev) => {
      if (!prev || !(key in prev)) return prev
      const next = { ...prev }
      delete next[key as GeneralField]
      return next
    })
  }

  const previewZone = normalizeTimeZone(values.timeZone, zones) ?? timeZone
  const today = now === null ? null : dateKeyIn(new Date(now), previewZone)
  const draftPeriod: PayPeriodSettings | null =
    values.payPeriodEnabled && /^\d{4}-\d{2}-\d{2}$/.test(values.anchor) && Number(values.days) >= 1
      ? { anchor: values.anchor, days: Number(values.days), payoutOffsetDays: Number(values.payoutOffsetDays) || 0 }
      : null
  const current = draftPeriod && today ? payPeriodFor(today, draftPeriod) : null

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const check = validateGeneralSettings(data)
    if (!check.ok) {
      setClientErrors(check.errors)
      return
    }
    setClientErrors(null)
    // Called directly (not via form action) so React doesn't reset the fields.
    startTransition(() => formAction(data))
  }

  const saved = state.status === "saved" && !clientErrors && !pending

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Account</legend>
        <Field id={ids.handle} label="X handle" error={errors.handle} hint="Used for post links and the account name.">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
              @
            </span>
            <Input
              id={ids.handle}
              name="handle"
              value={values.handle}
              onChange={(e) => set("handle")(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="yourhandle"
              className="pl-6"
              {...described(ids.handle, errors.handle, true)}
            />
          </div>
        </Field>
        <Field id={ids.userId} label="X user id" hint="Set when Grok Bot connects your account.">
          <Input
            id={ids.userId}
            value={userId ?? "Not connected yet"}
            readOnly
            aria-readonly="true"
            className="bg-muted/50 font-mono text-muted-foreground"
            {...described(ids.userId, undefined, true)}
          />
        </Field>
      </fieldset>

      <Separator />

      <fieldset className="grid gap-4">
        <legend className="sr-only">Timezone</legend>
        <Field
          id={ids.timeZone}
          label="Timezone"
          error={errors.timeZone}
          hint={
            now !== null ? (
              <>
                Now {formatPostDate(new Date(now).toISOString(), previewZone)} {timeZoneAbbr(previewZone)} there.
                Dashboard days, posting hours on Insights and pay periods follow this zone.
              </>
            ) : (
              "Dashboard days, posting hours on Insights and pay periods follow this zone."
            )
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={ids.timeZone}
              name="timeZone"
              list={ids.zones}
              value={values.timeZone}
              onChange={(e) => set("timeZone")(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="sm:max-w-80"
              {...described(ids.timeZone, errors.timeZone, true)}
            />
            <datalist id={ids.zones}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            {browserZone && browserZone !== values.timeZone ? (
              <Button type="button" variant="outline" onClick={() => set("timeZone")(browserZone)}>
                <LocateFixedIcon data-icon="inline-start" aria-hidden="true" />
                Use this computer&apos;s ({browserZone})
              </Button>
            ) : null}
          </div>
        </Field>
      </fieldset>

      <Separator />

      <fieldset className="grid gap-4">
        <legend className="sr-only">Pay periods</legend>
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <label htmlFor={ids.pay} className="text-sm font-medium">
              Pay periods
            </label>
            <p className="text-xs text-muted-foreground">
              X creator payout windows. Adds a payout period picker to the dashboard and an &ldquo;In
              progress&rdquo; tag while the current one runs.
            </p>
          </div>
          <SwitchPrimitive.Root
            id={ids.pay}
            checked={values.payPeriodEnabled}
            onCheckedChange={(on) => set("payPeriodEnabled")(on)}
            className="peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-primary dark:bg-input/80 dark:data-[state=checked]:bg-primary"
          >
            <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5 motion-reduce:transition-none dark:data-[state=unchecked]:bg-foreground" />
          </SwitchPrimitive.Root>
          <input type="hidden" name="payPeriodEnabled" value={values.payPeriodEnabled ? "on" : "off"} />
        </div>

        {values.payPeriodEnabled ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={ids.anchor} label="A period starts on" error={errors.anchor} hint="Any one known first day.">
              <Input
                id={ids.anchor}
                name="anchor"
                type="date"
                value={values.anchor}
                onChange={(e) => set("anchor")(e.target.value)}
                {...described(ids.anchor, errors.anchor, true)}
              />
            </Field>
            <Field id={ids.days} label="Length (days)" error={errors.days} hint="14 for X's two-week periods.">
              <Input
                id={ids.days}
                name="days"
                type="number"
                inputMode="numeric"
                min={PAY_PERIOD_LIMITS.days.min}
                max={PAY_PERIOD_LIMITS.days.max}
                value={values.days}
                onChange={(e) => set("days")(e.target.value)}
                {...described(ids.days, errors.days, true)}
              />
            </Field>
            <Field
              id={ids.payoutOffsetDays}
              label="Paid after (days)"
              error={errors.payoutOffsetDays}
              hint="Days from a period's last day to payout."
            >
              <Input
                id={ids.payoutOffsetDays}
                name="payoutOffsetDays"
                type="number"
                inputMode="numeric"
                min={PAY_PERIOD_LIMITS.payoutOffsetDays.min}
                max={PAY_PERIOD_LIMITS.payoutOffsetDays.max}
                value={values.payoutOffsetDays}
                onChange={(e) => set("payoutOffsetDays")(e.target.value)}
                {...described(ids.payoutOffsetDays, errors.payoutOffsetDays, true)}
              />
            </Field>
            {current && draftPeriod && today ? (
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Current period: <span className="text-foreground tabular-nums">{payPeriodRangeLabel(current)}</span>
                {" · "}
                {payoutLabel(current, today, draftPeriod).text}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {saved ? (
            <>
              <CheckIcon aria-hidden="true" className="size-4" />
              Saved. Every page now uses these settings.
            </>
          ) : Object.keys(errors).length > 0 ? (
            "Fix the highlighted fields to save."
          ) : null}
        </p>
      </div>
    </form>
  )
}
