"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { saveWebhook, type ActionState } from "./actions"
import { FormMessage } from "./form-message"

/**
 * Grok Bot webhook routine for Sync now. The URL goes to settings, the key to
 * data/secrets.json; the page only ever sees the key masked.
 */
export function WebhookForm({ url, maskedKey }: { url: string | null; maskedKey: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveWebhook, null)
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">Webhook URL</span>
          <Input
            name="webhookUrl"
            type="url"
            inputMode="url"
            defaultValue={url ?? ""}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">From the webhook trigger of the X Growth routine in Grok Bot.</span>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">Webhook key</span>
          <Input
            name="webhookKey"
            type="password"
            placeholder={maskedKey || "Paste the key"}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">
            {maskedKey ? `Saved (${maskedKey}). Leave empty to keep it.` : "Stored on this computer only, never shown again."}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {pending ? "Saving…" : "Save webhook"}
        </Button>
        {url || maskedKey ? (
          <Button type="submit" name="intent" value="remove" variant="ghost" disabled={pending}>
            Remove
          </Button>
        ) : null}
        <FormMessage state={state} />
      </div>
    </form>
  )
}
