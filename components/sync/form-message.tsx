import { cn } from "cn"

/** Result line next to a form's submit button. */
export function FormMessage({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null
  return (
    <p role="status" className={cn("text-sm", state.ok ? "text-muted-foreground" : "text-destructive")}>
      {state.message}
    </p>
  )
}
