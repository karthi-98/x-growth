import { createHmac, randomBytes } from "node:crypto"

import type { XKeys } from "../secrets"

/*
 * OAuth 1.0a HMAC-SHA1 request signing (user context), as described in
 * https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
 * JSON bodies are not signed: only the oauth_* values and the URL's query
 * parameters go into the signature base string.
 */

/** RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Scheme, host and path without query or fragment, lowercase scheme and host. */
function baseUrl(url: URL): string {
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}`
}

export function signatureBaseString(method: string, url: string, params: Record<string, string>): string {
  const parameterString = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return [method.toUpperCase(), percentEncode(baseUrl(new URL(url))), percentEncode(parameterString)].join("&")
}

export function hmacSha1Signature(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`
  return createHmac("sha1", key).update(baseString).digest("base64")
}

export type SignOptions = {
  method: string
  /** Full URL; its query parameters are signed. */
  url: string
  keys: XKeys
  /** Extra form or query parameters to sign (not JSON bodies). */
  params?: Record<string, string>
  /** Fixed values for tests; random and current time otherwise. */
  nonce?: string
  timestamp?: string
}

/** The `Authorization: OAuth …` header value for one request. */
export function oauthHeader({ method, url, keys, params = {}, nonce, timestamp }: SignOptions): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  }
  const query = Object.fromEntries(new URL(url).searchParams)
  const base = signatureBaseString(method, url, { ...query, ...params, ...oauth })
  oauth.oauth_signature = hmacSha1Signature(base, keys.apiSecret, keys.accessTokenSecret)
  return (
    "OAuth " +
    Object.entries(oauth)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ")
  )
}
