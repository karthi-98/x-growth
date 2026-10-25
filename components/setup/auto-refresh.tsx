"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

/** Re-render the current page's server data every `seconds` while mounted. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
