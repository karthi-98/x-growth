import { appVersion } from "./layout"
import { archiveExtension, type PlatformId } from "./platform"

/*
 * Published releases on GitHub. Network only, no file access, so the web
 * server can import it (Settings → App → Check for updates) without pulling
 * the installer code (lib/runtime/update.ts) into its file trace.
 */

export const RELEASE_REPO = "karthi-98/x-growth"

export type ReleaseAsset = { name: string; url: string; size: number }

export type RemoteRelease = {
  tag: string
  version: string
  publishedAt: string | null
  htmlUrl: string
  assets: ReleaseAsset[]
}

/** Bundle file name for a version and platform, e.g. x-growth-0.2.0-win-x64.zip. */
export const assetName = (version: string, platform: PlatformId) => `x-growth-${version}-${platform}.${archiveExtension(platform)}`

/** Compare dotted versions with optional -prerelease (a prerelease sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2)
    return { nums: main.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre.localeCompare(y.pre, undefined, { numeric: true })
}

export class NoReleaseError extends Error {}

/** The latest published release, or a specific version. Drafts are never returned. */
export async function fetchRelease(version?: string): Promise<RemoteRelease> {
  const url = version
    ? `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/v${version.replace(/^v/, "")}`
    : `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `x-growth/${appVersion()}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 404) throw new NoReleaseError(version ? `There is no release v${version.replace(/^v/, "")}.` : "No release has been published yet.")
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}.`)
  const json = (await res.json()) as {
    tag_name: string
    published_at: string | null
    html_url: string
    assets: { name: string; browser_download_url: string; size: number }[]
  }
  return {
    tag: json.tag_name,
    version: json.tag_name.replace(/^v/, ""),
    publishedAt: json.published_at,
    htmlUrl: json.html_url,
    assets: json.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  }
}

export type UpdateCheck = {
  current: string
  latest: string | null
  available: boolean
  url: string | null
  publishedAt: string | null
  error: string | null
}

/** `latest` is null with no error when nothing has been published yet. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = appVersion()
  try {
    const r = await fetchRelease().catch((err: unknown) => {
      if (err instanceof NoReleaseError) return null
      throw err
    })
    if (!r) return { current, latest: null, available: false, url: null, publishedAt: null, error: null }
    return { current, latest: r.version, available: compareVersions(r.version, current) > 0, url: r.htmlUrl, publishedAt: r.publishedAt, error: null }
  } catch (err) {
    return { current, latest: null, available: false, url: null, publishedAt: null, error: err instanceof Error ? err.message : String(err) }
  }
}
