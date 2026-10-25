/*
 * The X Growth Bot "pack" is the part of the bot users paste into Grok Bot by
 * hand: its instructions and the short skill stubs (docs/grok-bot/). The full
 * skills are not pasted; the bot downloads them from this app's GitHub
 * release on every run, so they update with the app. Only a change to the
 * pasted part needs users to act, and this version tells them when.
 *
 * Bump BOT_PACK_VERSION whenever docs/grok-bot/instructions.md or
 * docs/grok-bot/stubs/ change in a way existing bots must pick up, and raise
 * MIN_BOT_PACK_VERSION when older packs stop working with this app.
 */

/** The pack version these docs describe. */
export const BOT_PACK_VERSION = 2

/** Oldest pack this app works with; older (or unknown) packs get an "update your bot" warning. */
export const MIN_BOT_PACK_VERSION = 2

/** Where users get the current pack. */
export const BOT_PACK_URL = "https://github.com/karthi-98/x-growth/tree/main/docs/grok-bot#update-your-bot"

export type BotPackStatus = {
  /** Highest pack version seen in an import, or null if the bot never sent one (pack 1). */
  seen: number | null
  seenAt: string | null
  required: number
  latest: number
  /** True once a bot has imported with a pack older than required (or with none). */
  outdated: boolean
}

export function botPackStatus(seen: { version: number | null; seenAt: string | null } | null | undefined): BotPackStatus {
  const version = seen?.version ?? null
  const seenAt = seen?.seenAt ?? null
  return {
    seen: version,
    seenAt,
    required: MIN_BOT_PACK_VERSION,
    latest: BOT_PACK_VERSION,
    // Nothing imported from a bot yet: nothing to warn about.
    outdated: seenAt !== null && (version === null || version < MIN_BOT_PACK_VERSION),
  }
}

/** Read `run.bot_pack` from an envelope's run block, if it's a sane positive integer. */
export function parseBotPack(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 10_000 ? value : null
}
