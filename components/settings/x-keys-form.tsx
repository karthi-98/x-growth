"use client"

import { CircleCheckIcon, FlaskConicalIcon, KeyRoundIcon, LoaderCircleIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"
import { useEffect, useId, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getXKeysStatusAction, removeXKeysAction, saveXKeysAction, verifyXKeysAction } from "@/lib/x/actions"
import type { XKeysStatus } from "@/lib/x/keys"
import type { XKeys } from "@/lib/secrets"

const FIELDS: { key: keyof XKeys; label: string; hint: string }[] = [
  { key: "apiKey", label: "API Key", hint: "Consumer Key" },
  { key: "apiSecret", label: "API Key Secret", hint: "Consumer Secret" },
  { key: "accessToken", label: "Access Token", hint: "starts with your user id and a dash" },
  { key: "accessTokenSecret", label: "Access Token Secret", hint: "" },
]

const EMPTY: Record<keyof XKeys, string> = { apiKey: "", apiSecret: "", accessToken: "", accessTokenSecret: "" }

type Verify = { ok: true; username: string; dryRun?: boolean } | { ok: false; error: string }

/**
 * Form to paste and verify the user's X API keys (OAuth 1.0a, Read and Write).
 * Used by the Settings X keys section and the /setup wizard.
 * `onSaved` lets the wizard move to its next step. `initial` skips the first
 * status fetch when a server component already has it.
 */
export function XKeysForm({ onSaved, initial }: { onSaved?: () => void; initial?: XKeysStatus }) {
  const id = useId()
  const [status, setStatus] = useState<XKeysStatus | null>(initial ?? null)
  const [values, setValues] = useState(EMPTY)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [verify, setVerify] = useState<Verify | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<"save" | "verify" | "remove" | null>(null)

  useEffect(() => {
    if (initial) return
    let live = true
    getXKeysStatusAction().then((s) => live && setStatus(s))
    return () => {
      live = false
    }
  }, [initial])

  const saved = !!status?.saved
  const typed = Object.values(values).some((v) => v.trim())

  const save = () => {
    setMessage(null)
    setVerify(null)
    setBusy("save")
    startTransition(async () => {
      const res = await saveXKeysAction(values)
      setBusy(null)
      setStatus(res.status)
      if (!res.ok) {
        setMessage({ ok: false, text: res.error ?? "Couldn't save the keys." })
        return
      }
      setValues(EMPTY)
      setMessage({ ok: true, text: "Keys saved on this computer. Verify them to check they work." })
      onSaved?.()
    })
  }

  const runVerify = () => {
    setMessage(null)
    setVerify(null)
    setBusy("verify")
    startTransition(async () => {
      setVerify(await verifyXKeysAction())
      setBusy(null)
    })
  }

  const remove = () => {
    setConfirmRemove(false)
    setMessage(null)
    setVerify(null)
    setBusy("remove")
    startTransition(async () => {
      setStatus(await removeXKeysAction())
      setBusy(null)
      setMessage({ ok: true, text: "Keys removed." })
    })
  }

  const spin = (what: typeof busy) => (busy === what ? <LoaderCircleIcon className="animate-spin" /> : null)

  return (
    <div className="flex flex-col gap-5">
      {status?.dryRun && (
        <p className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-800 dark:text-sky-300">
          <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Dry run is on: Verify only checks that keys are saved, and nothing is sent to X.
        </p>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-${f.key}`} className="text-sm font-medium">
              {f.label}
              {f.hint && <span className="font-normal text-muted-foreground"> · {f.hint}</span>}
            </label>
            <Input
              id={`${id}-${f.key}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={status?.masked[f.key] || "Paste here"}
              className="font-mono"
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending || !typed}>
            {spin("save") ?? <KeyRoundIcon />} {saved ? "Save changes" : "Save keys"}
          </Button>
          <Button type="button" variant="outline" onClick={runVerify} disabled={pending || !saved}>
            {spin("verify") ?? <ShieldCheckIcon />} Verify
          </Button>
          {saved &&
            (confirmRemove ? (
              <>
                <span className="text-sm">Remove the saved keys?</span>
                <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending}>
                  Remove
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={pending}>
                {spin("remove") ?? <Trash2Icon />} Remove
              </Button>
            ))}
          <span className="text-xs text-muted-foreground">
            {saved ? "Leave a field blank to keep its saved value. " : ""}Verify reads your profile (about $0.01) and never posts.
          </span>
        </div>
      </form>

      <div role="status" aria-live="polite" className="empty:hidden">
        {verify?.ok && (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CircleCheckIcon className="size-4" aria-hidden="true" />
            {verify.dryRun ? "Keys are saved (dry run, not checked with X)." : <>Connected as <strong>@{verify.username}</strong>.</>}
          </p>
        )}
        {verify && !verify.ok && <p className="text-sm text-destructive">{verify.error}</p>}
        {message && <p className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{message.text}</p>}
      </div>

      <details className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium select-none">How to get these keys</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
          <li>
            Open the{" "}
            <a
              href="https://developer.x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-4"
            >
              X developer portal
            </a>{" "}
            with your X account and create an app on the pay-per-use plan.
          </li>
          <li>
            In the app&apos;s <strong className="text-foreground">User authentication settings</strong>, set App permissions
            to <strong className="text-foreground">Read and Write</strong>. Any callback URL works, for example
            http://127.0.0.1:3000.
          </li>
          <li>
            Under <strong className="text-foreground">Keys and tokens</strong>, copy the API Key and Secret, then generate
            the Access Token and Secret. Generate them <em>after</em> setting Read and Write: tokens made while the app was
            read-only can&apos;t post, so regenerate them if you changed permissions.
          </li>
          <li>Add credits. Each post costs $0.015, or $0.20 when it contains a link.</li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Keys are stored only on this computer (data/secrets.json), are never shown again in full, and are never shared
          with Grok Bot.
        </p>
      </details>
    </div>
  )
}
