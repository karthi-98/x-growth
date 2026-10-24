"use client"

// Owner: ai workstream (docs/WORKSTREAMS.md). Replace this stub.

export type AiAssistProps = {
  /** Current editor text (one part of a post or thread). */
  text: string
  /** Replace the editor text with an AI suggestion the user accepted. */
  onApply: (next: string) => void
}

/** AI tools shown next to the compose editor: rewrite, shorter, stronger hook, ideas. */
export function AiAssist(_props: AiAssistProps) {
  return null
}
