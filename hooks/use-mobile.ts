import { useMediaQuery } from "@/hooks/use-media-query"

const MOBILE_BREAKPOINT = 768

/**
 * True below the md breakpoint. Same contract as shadcn's generated hook
 * (false during SSR) but via useSyncExternalStore, so no setState in an effect.
 */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`, false)
}