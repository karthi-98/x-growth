"use client"

import { ArrowDownWideNarrowIcon, SearchIcon, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useOptimistic, useRef, useState } from "react"

import { useFilterTransition } from "@/components/range-filter/filter-transition"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  parsePostsParams,
  POSTS_RANGE_LABELS,
  postsQuery,
  postsRanges,
  type PostsParams,
  type PostsRange,
  type PostsSort,
  type PostsView,
} from "@/lib/posts-params"

const VIEW_LABELS: Record<PostsView, string> = {
  posts: "Posts",
  replies: "Replies",
  all: "All",
}

const RANGE_LABELS = Object.fromEntries(
  postsRanges.map((r) => [r, POSTS_RANGE_LABELS[r].short])
) as Record<PostsRange, string>

const SORT_LABELS: Record<PostsSort, string> = {
  new: "Newest",
  impressions: "Most impressions",
}

const SEARCH_DEBOUNCE_MS = 300
const CUSTOM = "__custom"

const readParams = (sp: URLSearchParams) =>
  parsePostsParams(Object.fromEntries(sp.entries()))

/** Push a params change inside the shared filter transition. */
function usePostsNavigate() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { startTransition } = useFilterTransition()
  const current = readParams(searchParams)

  const navigate = useCallback(
    (next: Partial<PostsParams>, beforeNavigate?: () => void) => {
      // Any filter change goes back to page 1.
      const href = `${pathname}${postsQuery({ ...readParams(searchParams), page: 1, ...next })}`
      startTransition(() => {
        beforeNavigate?.()
        router.replace(href, { scroll: false })
      })
    },
    [pathname, router, searchParams, startTransition]
  )
  return { current, navigate }
}

/**
 * Segmented control on the shadcn ToggleGroup with the transitions.dev
 * "Tabs sliding" pill: JS writes the active item's offset and width, CSS
 * tweens it (snapped without a transition on first paint and resize).
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  customLabel,
}: {
  /** null: no segment selected (e.g. a custom date range is active). */
  value: T | null
  options: Record<T, string>
  onChange: (next: T) => void
  label: string
  /** Shown as a selected, non-interactive segment while value is null. */
  customLabel?: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const bar = barRef.current
    const pill = pillRef.current
    if (!bar || !pill) return
    const move = (animate: boolean) => {
      const tab = bar.querySelector<HTMLElement>(`[data-value="${value ?? CUSTOM}"]`)
      if (!tab) {
        pill.style.opacity = "0"
        return
      }
      if (!animate) pill.style.transition = "none"
      pill.style.transform = `translateX(${tab.offsetLeft}px)`
      pill.style.width = `${tab.offsetWidth}px`
      pill.style.opacity = "1"
      if (!animate) {
        void pill.offsetWidth
        pill.style.transition = ""
      }
    }
    move(placed.current)
    placed.current = true
    const observer = new ResizeObserver(() => move(false))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [value])

  return (
    <div ref={barRef} className="relative flex w-full rounded-lg bg-muted p-[3px] @lg:w-auto">
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-[3px] left-0 h-[calc(100%-6px)] w-0 rounded-md bg-background opacity-0 shadow-sm ring-1 ring-foreground/5 transition-[transform,width] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none dark:bg-input/60"
      />
      <ToggleGroup
        type="single"
        spacing={1}
        value={value ?? ""}
        onValueChange={(next) => {
          if (next) onChange(next as T)
        }}
        aria-label={label}
        className="relative z-[1] w-full @lg:w-auto"
      >
        {(Object.keys(options) as T[]).map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            data-value={option}
            size="sm"
            className="flex-1 rounded-md px-3 text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground @lg:flex-none"
          >
            {options[option]}
          </ToggleGroupItem>
        ))}
        {value === null && customLabel ? (
          <span
            data-value={CUSTOM}
            className="inline-flex h-7 flex-1 items-center justify-center rounded-md px-3 text-[0.8rem] font-medium text-foreground @lg:flex-none"
          >
            {customLabel}
          </span>
        ) : null}
      </ToggleGroup>
    </div>
  )
}

/** Debounced search box; the URL `q` is the source of truth. */
function SearchBox({
  urlQ,
  onSearch,
}: {
  urlQ: string
  onSearch: (q: string) => void
}) {
  const [value, setValue] = useState(urlQ)
  const [syncedQ, setSyncedQ] = useState(urlQ)
  const [pushedQ, setPushedQ] = useState(urlQ)

  // Back/forward or another control changed q: adopt it unless we pushed it.
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ)
    if (urlQ !== pushedQ) setValue(urlQ)
  }

  useEffect(() => {
    const q = value.trim()
    if (q === urlQ) return
    const t = setTimeout(() => {
      setPushedQ(q)
      onSearch(q)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, urlQ, onSearch])

  const clear = () => {
    setValue("")
    setPushedQ("")
    onSearch("")
  }

  return (
    <div className="relative w-full min-w-0 @3xl:max-w-64">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault()
            clear()
          }
        }}
        placeholder="Search posts"
        aria-label="Search post text"
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-8 pl-8 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function PostsControls() {
  const { current, navigate } = usePostsNavigate()
  const [view, setOptimisticView] = useOptimistic(current.view)
  // A custom from/to (e.g. from the dashboard link) selects no range segment.
  const [range, setOptimisticRange] = useOptimistic<PostsRange | null>(
    current.custom ? null : current.range
  )
  const [sort, setOptimisticSort] = useOptimistic(current.sort)

  const onSearch = useCallback((q: string) => navigate({ q }), [navigate])

  // Sized by the container (the sidebar inset), not the viewport.
  // Narrow: type, range, then search + sort, each full width.
  // Medium: segments on one row, search (full width) + sort below.
  // Wide (@3xl): one row, segments left, compact search + sort right.
  return (
    <div className="@container">
    <div className="flex flex-col gap-2.5 @lg:flex-row @lg:flex-wrap @lg:items-center @lg:gap-3">
      <Segmented
        label="Post type"
        value={view}
        options={VIEW_LABELS}
        onChange={(next) => navigate({ view: next }, () => setOptimisticView(next))}
      />
      <Segmented
        label="Time range"
        value={range}
        options={RANGE_LABELS}
        customLabel="Custom"
        // Picking a range clears from/to.
        onChange={(next) =>
          navigate({ range: next, custom: null }, () => setOptimisticRange(next))
        }
      />
      <div className="flex w-full items-center gap-2 @lg:w-auto @lg:min-w-64 @lg:flex-1 @3xl:ml-auto @3xl:justify-end">
        <SearchBox urlQ={current.q} onSearch={onSearch} />
        <Select
          value={sort}
          onValueChange={(next) =>
            navigate({ sort: next as PostsSort }, () => setOptimisticSort(next as PostsSort))
          }
        >
          <SelectTrigger aria-label="Sort posts" className="shrink-0">
            <ArrowDownWideNarrowIcon className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {(Object.keys(SORT_LABELS) as PostsSort[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
    </div>
  )
}

/** Subtitle under the page title; follows the URL range. */
export function PostsSubtitle() {
  const searchParams = useSearchParams()
  const { range, custom } = readParams(searchParams)
  return (
    <p className="text-sm text-muted-foreground">
      {custom ? "Custom range" : POSTS_RANGE_LABELS[range].long} &middot; reposts excluded &middot; times in IST
    </p>
  )
}

export function PostsControlsFallback() {
  return (
    <div className="@container">
      <div className="flex flex-col gap-2.5 @lg:flex-row @lg:flex-wrap @lg:items-center @lg:gap-3">
        <div className="h-[34px] w-full rounded-lg bg-muted @lg:w-48" />
        <div className="h-[34px] w-full rounded-lg bg-muted @lg:w-64" />
        <div className="flex w-full gap-2 @lg:min-w-64 @lg:flex-1 @3xl:ml-auto @3xl:justify-end">
          <div className="h-8 w-full rounded-lg bg-muted @3xl:max-w-64" />
          <div className="h-8 w-28 shrink-0 rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  )
}
