"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import { useFilterTransition } from "@/components/range-filter/filter-transition"
import type { DateRangeKeys } from "@/lib/range"

/**
 * Navigate to a date range inside the shared filter transition. Keeps every
 * other search param (e.g. ?impChart=) and only sets or clears from/to.
 */
export function useRangeNavigate() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { startTransition } = useFilterTransition()

  return useCallback(
    (range: DateRangeKeys, { isDefault = false }: { isDefault?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString())
      if (isDefault) {
        params.delete("from")
        params.delete("to")
      } else {
        params.set("from", range.from)
        params.set("to", range.to)
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      startTransition(() => router.push(href, { scroll: false }))
    },
    [pathname, router, searchParams, startTransition]
  )
}
