import { describe, expect, test } from "bun:test"

import {
  containsUrl,
  extractUrls,
  formatUsd,
  MAX_POST_LENGTH,
  normalizeForMatch,
  parsePostRef,
  partsCostUsd,
  weightedLength,
} from "./text"

describe("weightedLength (X's twitter-text v3 rules)", () => {
  test.each([
    ["", 0],
    ["hello", 5],
    ["a".repeat(280), 280],
    ["café", 4],
    ["é", 1], // NFC: e + combining acute = é
    ["日本語", 6],
    ["한국어", 6],
    ["Привет", 6], // Cyrillic is in the light range
    ["—", 1], // em dash U+2014 is light
    ["…", 2], // ellipsis U+2026 is not
    ["😀", 2],
    ["👍🏽", 2], // skin tone modifier
    ["👨‍👩‍👧‍👦", 2], // ZWJ family
    ["🇮🇳", 2], // flag
    ["1️⃣", 2], // keycap
    ["❤️", 2], // with variation selector
    ["hi 😀!", 6],
    ["@user hello", 11],
    ["me@example.com", 14], // emails aren't links
  ])("%p → %p", (text, expected) => {
    expect(weightedLength(text)).toBe(expected)
  })

  test("every URL counts 23, whatever its length", () => {
    expect(weightedLength("https://example.com")).toBe(23)
    expect(weightedLength("Check https://example.com/a/very/long/path?with=query&and=more")).toBe(6 + 23)
    expect(weightedLength("visit example.com now")).toBe(6 + 23 + 4)
    expect(weightedLength("a http://x.co b https://y.io/z")).toBe(2 + 23 + 3 + 23)
  })

  test("the limit is 280", () => {
    expect(MAX_POST_LENGTH).toBe(280)
    expect(weightedLength("日".repeat(140))).toBe(280)
    expect(weightedLength("日".repeat(141))).toBe(282)
  })
})

describe("URL detection", () => {
  test("trims trailing punctuation and unbalanced parens", () => {
    expect(extractUrls("see https://x.com/foo.").map((u) => u.url)).toEqual(["https://x.com/foo"])
    expect(extractUrls("(see example.com)").map((u) => u.url)).toEqual(["example.com"])
    expect(extractUrls("wiki https://en.wikipedia.org/wiki/Foo_(bar) ok").map((u) => u.url)).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ])
  })

  test("bare domains need a common TLD; word-like TLDs need a path", () => {
    expect(containsUrl("go to github.com")).toBe(true)
    expect(containsUrl("try notion.so/page")).toBe(true)
    expect(containsUrl("end of it.so then")).toBe(false)
    expect(containsUrl("e.g. this")).toBe(false)
    expect(containsUrl("version 1.2.3")).toBe(false)
    expect(containsUrl("@someone.com")).toBe(false)
  })

  test("prices: $0.20 for a part with a link, $0.015 otherwise", () => {
    const prices = { post: 0.015, postWithUrl: 0.2 }
    expect(partsCostUsd(["hello"], prices)).toBeCloseTo(0.015)
    expect(partsCostUsd(["hello", "link: https://example.com", "bye"], prices)).toBeCloseTo(0.23)
    expect(formatUsd(0.015)).toBe("$0.015")
    expect(formatUsd(0.2)).toBe("$0.20")
    expect(formatUsd(1.25)).toBe("$1.25")
  })
})

describe("parsePostRef", () => {
  test.each([
    ["https://x.com/user/status/1234567890123456789", "1234567890123456789"],
    ["https://x.com/user/status/123?s=20&t=abc", "123"],
    ["twitter.com/user/status/456", "456"],
    ["https://mobile.twitter.com/user/status/456/photo/1", "456"],
    ["https://x.com/i/web/status/789", "789"],
    ["https://x.com/i/status/789", "789"],
    ["  2113972971979288803 ", "2113972971979288803"],
    ["https://x.com/user", null],
    ["https://example.com/user/status/1", null],
    ["hello", null],
  ])("%p → %p", (input, expected) => {
    expect(parsePostRef(input)).toBe(expected)
  })
})

describe("normalizeForMatch", () => {
  test("ignores entities, t.co links, reply mentions and spacing", () => {
    expect(normalizeForMatch("@a @b Fish &amp; chips https://t.co/abc")).toBe(
      normalizeForMatch("Fish & chips   https://example.com/long/path")
    )
    expect(normalizeForMatch("one\n\ntwo")).toBe("one two")
    expect(normalizeForMatch("one")).not.toBe(normalizeForMatch("two"))
  })
})
