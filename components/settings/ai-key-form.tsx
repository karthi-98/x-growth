"use client"

import { CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getAiKeyState, removeAiKey, saveAiKey, verifySavedAiKey } from "@/lib/ai/actions"
import type { AiKeyStatus } from "@/lib/ai/index"
import { AI_PROVIDER_IDS, AI_PROVIDERS, findModel, formatModelPrice, formatUsd } from "@/lib/ai/models"
import type { AiProvider } from "@/lib/secrets"

type Notice = { tone: "ok" | "error"; text: string } | null
type Busy = "save" | "verify" | "remove" | null

/**
 * Form to pick an AI provider, paste its key and model, and verify it.
 * Used by the Settings AI section and the /setup wizard. `initial` skips
 * the first load when the server already has the (masked) state.
 */
export function AiKeyForm({ onSaved, initial }: { onSaved?: () => void; initial?: AiKeyStatus }) {
  const ids = useId()
  const [status, setStatus] = useState<AiKeyStatus | null>(initial ?? null)
  const [provider, setProvider] = useState<AiProvider>(initial?.provider ?? "xai")
  const [model, setModel] = useState(initial?.model ?? AI_PROVIDERS[initial?.provider ?? "xai"].defaultModel)
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (initial) return
    let live = true
    void getAiKeyState().then((s) => {
      if (!live) return
      setStatus(s)
      if (s.provider) {
        setProvider(s.provider)
        setModel(s.model ?? AI_PROVIDERS[s.provider].defaultModel)
      }
    })
    return () => {
      live = false
    }
  }, [initial])

  const info = AI_PROVIDERS[provider]
  const modelInfo = findModel(provider, model.trim())
  const savedForProvider = !!status?.hasKey && status.provider === provider
  const dirty = apiKey.trim() !== "" || !savedForProvider || (status?.model ?? "") !== model.trim()

  const changeProvider = (next: AiProvider) => {
    setProvider(next)
    // A model id rarely carries over between providers.
    if (!findModel(next, model.trim())) setModel(AI_PROVIDERS[next].defaultModel)
    setNotice(null)
  }

  const verifyNotice = (v: { ok: true; model: string; estCostUsd?: number } | { ok: false; error: string }): Notice =>
    v.ok
      ? {
          tone: "ok",
          text: `Key works with ${v.model}.${v.estCostUsd !== undefined ? ` Test cost ${formatUsd(v.estCostUsd)}.` : ""}`,
        }
      : { tone: "error", text: v.error }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy("save")
    setNotice(null)
    try {
      const form = new FormData()
      form.set("provider", provider)
      form.set("model", model)
      form.set("apiKey", apiKey)
      const res = await saveAiKey(form)
      if (!res.ok) {
        setNotice({ tone: "error", text: res.error })
        return
      }
      setStatus(res.status)
      setApiKey("")
      setNotice(
        res.verify.ok ? verifyNotice(res.verify) : { tone: "error", text: `Saved, but the check failed: ${res.verify.error}` }
      )
      if (res.verify.ok) onSaved?.()
    } catch {
      setNotice({ tone: "error", text: "Couldn't save. Is the app still running?" })
    } finally {
      setBusy(null)
    }
  }

  const verify = async () => {
    setBusy("verify")
    setNotice(null)
    try {
      setNotice(verifyNotice(await verifySavedAiKey()))
    } catch {
      setNotice({ tone: "error", text: "Couldn't verify. Is the app still running?" })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy("remove")
    setNotice(null)
    try {
      setStatus(await removeAiKey())
      setApiKey("")
      setNotice({ tone: "ok", text: "AI key removed from this computer." })
    } finally {
      setBusy(null)
    }
  }

  const spinner = <LoaderCircleIcon aria-hidden="true" className="animate-spin" />

  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-describedby={`${ids}-privacy`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${ids}-provider`} className="text-sm font-medium">
            Provider
          </label>
          <Select value={provider} onValueChange={(v) => changeProvider(v as AiProvider)}>
            <SelectTrigger id={`${ids}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDER_IDS.map((p) => (
                <SelectItem key={p} value={p}>
                  {AI_PROVIDERS[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${ids}-model`} className="text-sm font-medium">
            Model
          </label>
          <Input
            id={`${ids}-model`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={`${ids}-models`}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${ids}-model-hint`}
          />
          <datalist id={`${ids}-models`}>
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          <p id={`${ids}-model-hint`} className="text-xs text-muted-foreground">
            {modelInfo
              ? formatModelPrice(modelInfo)
              : provider === "openrouter"
                ? "OpenRouter reports the cost of each call."
                : "Price unknown for this model, so cost estimates will show $0."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-key`} className="text-sm font-medium">
          API key
        </label>
        <Input
          id={`${ids}-key`}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={savedForProvider ? `Saved key ${status?.maskedKey}. Paste a new one to replace it.` : "Paste your key"}
          aria-describedby={`${ids}-key-hint`}
        />
        <p id={`${ids}-key-hint`} className="text-xs text-muted-foreground">
          {info.keyHint}{" "}
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
          >
            Get a key
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy !== null || !dirty}>
          {busy === "save" ? spinner : null}
          Save and verify
        </Button>
        {status?.hasKey ? (
          <>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void verify()}>
              {busy === "verify" ? spinner : null}
              Verify saved key
            </Button>
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void remove()}>
              {busy === "remove" ? spinner : null}
              Remove key
            </Button>
          </>
        ) : null}
      </div>

      <p aria-live="polite" className="min-h-5 text-sm">
        {notice ? (
          <span
            className={
              notice.tone === "ok"
                ? "inline-flex items-start gap-1.5 text-foreground"
                : "inline-flex items-start gap-1.5 text-destructive"
            }
          >
            {notice.tone === "ok" ? (
              <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            {notice.text}
          </span>
        ) : status?.hasKey ? (
          <span className="text-muted-foreground">
            Using {status.providerLabel} &middot; {status.model} &middot; key {status.maskedKey}
          </span>
        ) : null}
      </p>

      <p id={`${ids}-privacy`} className="text-xs text-muted-foreground">
        Verifying sends one tiny test prompt with your key (a fraction of a cent). The key is saved only in
        data/secrets.json on this computer and is never shown again in full.
      </p>
    </form>
  )
}
