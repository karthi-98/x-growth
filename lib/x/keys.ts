import { hasXKeys, maskSecret, readSecrets, writeSecrets, type XKeys } from "../secrets"
import { isXDryRun } from "./client"

/*
 * What the browser may know about the saved X keys: whether they're set and
 * their masked tails. The keys themselves never leave the server.
 */

export const X_KEY_FIELDS = ["apiKey", "apiSecret", "accessToken", "accessTokenSecret"] as const satisfies readonly (keyof XKeys)[]

export type XKeysStatus = {
  saved: boolean
  masked: Record<keyof XKeys, string>
  dryRun: boolean
}

export function xKeysStatus(): XKeysStatus {
  const secrets = readSecrets()
  const x = secrets.x
  return {
    saved: hasXKeys(secrets),
    masked: {
      apiKey: maskSecret(x?.apiKey),
      apiSecret: maskSecret(x?.apiSecret),
      accessToken: maskSecret(x?.accessToken),
      accessTokenSecret: maskSecret(x?.accessTokenSecret),
    },
    dryRun: isXDryRun(),
  }
}

/** Save pasted keys; blank fields keep the saved value. All four must end up set. */
export function saveXKeys(input: Partial<Record<keyof XKeys, string>>): { ok: true } | { ok: false; error: string } {
  const current = readSecrets().x
  const next = {} as XKeys
  for (const field of X_KEY_FIELDS) {
    const pasted = typeof input[field] === "string" ? input[field]!.trim() : ""
    if (pasted && (/\s/.test(pasted) || pasted.length > 200)) {
      return { ok: false, error: "A key contains spaces or is too long. Copy it again from the developer portal." }
    }
    next[field] = pasted || current?.[field] || ""
  }
  if (X_KEY_FIELDS.some((f) => !next[f])) return { ok: false, error: "All four keys are needed." }
  if (!next.accessToken.includes("-")) {
    return { ok: false, error: "That access token doesn't look right: X access tokens start with your numeric user id and a dash." }
  }
  writeSecrets({ x: next })
  return { ok: true }
}

export function removeXKeys() {
  writeSecrets({ x: undefined })
}
