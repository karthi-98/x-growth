"use client"

import { createContext, useContext, useTransition, type TransitionStartFunction } from "react"

const FilterTransitionContext = createContext<{
  isPending: boolean
  startTransition: TransitionStartFunction
} | null>(null)

/** Shares one navigation transition between the filter and the content it dims. */
export function FilterTransitionProvider({ children }: { children: React.ReactNode }) {
  const [isPending, startTransition] = useTransition()
  return (
    <FilterTransitionContext.Provider value={{ isPending, startTransition }}>
      {children}
    </FilterTransitionContext.Provider>
  )
}

export function useFilterTransition() {
  const ctx = useContext(FilterTransitionContext)
  if (!ctx) throw new Error("useFilterTransition needs FilterTransitionProvider")
  return ctx
}

/** Dims its children while a filter navigation is in flight. */
export function PendingArea({ children }: { children: React.ReactNode }) {
  const { isPending } = useFilterTransition()
  return (
    <div className="t-pending" data-pending={isPending || undefined} aria-busy={isPending}>
      {children}
    </div>
  )
}
