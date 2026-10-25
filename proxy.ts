import { NextResponse, type NextRequest } from "next/server"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

/*
 * Localhost security (docs/ARCHITECTURE.md section 10). The server listens
 * on 127.0.0.1 only, but web pages can still reach it through the browser:
 *
 * - DNS rebinding: evil.example re-resolves to 127.0.0.1, so its pages could
 *   read ours. The browser still sends `Host: evil.example`, so we only
 *   answer requests addressed to localhost / 127.0.0.1 (on our port when
 *   `xstats start` runs us; it sets XSTATS_PORT).
 * - CSRF: another site submits a form to us. Browsers send `Origin` (or at
 *   least `Sec-Fetch-Site`) with every non-GET request, so changes must come
 *   from our own origin. Requests with neither come from local programs
 *   (curl, scripts), not from a web page.
 *
 * Server Actions also compare Origin with Host themselves; this applies the
 * same rule to everything, route handlers included.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function isLocalHost(host: string | null): boolean {
  const m = host ? /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase()) : null
  if (!m || !LOCAL_HOSTNAMES.has(m[1])) return false
  const expectedPort = process.env.XSTATS_PORT
  return !expectedPort || (m[2] ?? "80") === expectedPort
}

function isSameOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === "http:" && url.host === host.trim().toLowerCase()
  } catch {
    return false // "null" (sandboxed frames, file://) or garbage
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")
  if (!isLocalHost(host)) {
    return new NextResponse("This app only answers on localhost.\n", {
      status: 421,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin")
    const site = request.headers.get("sec-fetch-site")
    const sameOrigin = origin !== null ? isSameOrigin(origin, host!) : site === null || site === "same-origin" || site === "none"
    if (!sameOrigin) {
      return new NextResponse("Cross-origin requests can't change anything here.\n", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }
  }
  return NextResponse.next()
}

export const config = {
  // Everything except immutable build assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
