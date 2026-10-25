import { describe, expect, test } from "bun:test"

import { BOT_PACK_VERSION, botPackStatus, MIN_BOT_PACK_VERSION, parseBotPack } from "./bot-pack"

describe("bot pack status", () => {
  test("no import from a bot yet is not outdated", () => {
    expect(botPackStatus({ version: null, seenAt: null }).outdated).toBe(false)
    expect(botPackStatus(undefined).outdated).toBe(false)
  })

  test("a bot that sends no version (pack 1) or an old one is outdated", () => {
    const seenAt = "2026-10-25T00:00:00Z"
    expect(botPackStatus({ version: null, seenAt }).outdated).toBe(true)
    expect(botPackStatus({ version: MIN_BOT_PACK_VERSION - 1, seenAt }).outdated).toBe(true)
    expect(botPackStatus({ version: MIN_BOT_PACK_VERSION, seenAt }).outdated).toBe(false)
    expect(botPackStatus({ version: BOT_PACK_VERSION, seenAt })).toMatchObject({ latest: BOT_PACK_VERSION, outdated: false })
  })

  test("only sane integers count as a pack version", () => {
    expect(parseBotPack(2)).toBe(2)
    expect(parseBotPack("2")).toBeNull()
    expect(parseBotPack(1.5)).toBeNull()
    expect(parseBotPack(0)).toBeNull()
    expect(parseBotPack(undefined)).toBeNull()
  })
})
